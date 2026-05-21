/**
 * For each Orion transparent vault registered in OrionConfig, if the vault's strategist
 * is a contract that reports IOrionStrategist via ERC-165, call submitIntent() on it.
 *
 * The signer must be the owner of each strategist contract (set as owner_ at deploy time).
 *
 * Required env:
 *   PRIVATE_KEY                     — strategist owner private key
 *
 * Optional env:
 *   ORION_CONFIG_ADDRESS            — default: 0xbDe3025d08681a02a1c6cf70375baBe2152DD06f (Sepolia)
 *   ORION_STRATEGIST_INTERFACE_ID   — if set, only this bytes4 is checked (no fallback)
 *   DRY_RUN=1                       — log matches only, no transactions sent
 *
 * ERC-165 interface IDs (both checked by default):
 *   0x2a588280 — type(IOrionStrategist).interfaceId  (IERC165 ^ setVault ^ submitIntent)
 *   0x2ba74b27 — setVault(address) ⊕ submitIntent()  (some on-chain deployments use this)
 *
 * Exit code 1 if any submitIntent() call failed.
 *
 * Usage:
 *   npx hardhat run scripts/update-intents.ts --network sepolia
 */

import type { Provider } from "ethers";
import hre from "hardhat";
import type { HardhatEthers } from "@nomicfoundation/hardhat-ethers/types";

const connection = (await hre.network.getOrCreate()) as unknown as { networkName?: string; ethers: HardhatEthers };
const { ethers } = connection;
const networkName = connection.networkName ?? process.env.HARDHAT_NETWORK ?? "hardhat";

const I_ORION_STRATEGIST_FULL = "0x2a588280";
const I_ORION_STRATEGIST_FUNCTIONS_ONLY = "0x2ba74b27";
const DEFAULT_ORION_CONFIG = "0xbDe3025d08681a02a1c6cf70375baBe2152DD06f";
const VAULT_TYPE_TRANSPARENT = 0;

const ORION_CONFIG_ABI = ["function getAllOrionVaults(uint8 vaultType) view returns (address[])"];
const VAULT_ABI = ["function strategist() view returns (address)"];
const STRATEGIST_ABI = ["function submitIntent()"];
const IERC165_ABI = ["function supportsInterface(bytes4 interfaceId) view returns (bool)"];

// Known OrionConfig addresses per chainId. Used to catch network/config mismatches.
// Add deprecated Sepolia addresses to the `deprecated` array as new ones are deployed.
const KNOWN_CONFIGS: Record<number, { current: string; deprecated: string[]; label: string }> = {
  11155111: {
    label: "Sepolia",
    current: "0xbDe3025d08681a02a1c6cf70375baBe2152DD06f",
    deprecated: [
      "0x80fdF5E20e565E1345DC9eE1dbc36Edb3f292f2E",
    ],
  },
  // 1: { label: "Mainnet", current: "0x<MAINNET_ORION_CONFIG_ADDRESS>", deprecated: [] },
};

// ── ANSI helpers ──────────────────────────────────────────────────────────────
const isTTY = process.stdout.isTTY;
const c = {
  reset:  isTTY ? "\x1b[0m"  : "",
  dim:    isTTY ? "\x1b[2m"  : "",
  bold:   isTTY ? "\x1b[1m"  : "",
  green:  isTTY ? "\x1b[32m" : "",
  red:    isTTY ? "\x1b[31m" : "",
  yellow: isTTY ? "\x1b[33m" : "",
  cyan:   isTTY ? "\x1b[36m" : "",
};
const SEP = `${c.dim}${"─".repeat(60)}${c.reset}`;

const EXPLORER_BASE: Record<string, string> = {
  mainnet:  "https://etherscan.io",
  sepolia:  "https://sepolia.etherscan.io",
  holesky:  "https://holesky.etherscan.io",
  goerli:   "https://goerli.etherscan.io",
};

function txLink(hash: string, network: string): string {
  const base = EXPLORER_BASE[network];
  if (!isTTY || !base) return hash;
  const url = `${base}/tx/${hash}`;
  // OSC 8 hyperlink: \e]8;;URL\e\\ TEXT \e]8;;\e\\
  return `\x1b]8;;${url}\x1b\\${hash}\x1b]8;;\x1b\\`;
}

function row(label: string, value: string): void {
  console.log(`  ${c.dim}${label.padEnd(12)}${c.reset}  ${value}`);
}

async function validateOrionConfig(provider: Provider, configAddr: string, networkName: string): Promise<void> {
  // 1. Confirm there is a contract at the address.
  const code = await provider.getCode(configAddr);
  if (code === "0x") {
    throw new Error(
      `No contract found at ORION_CONFIG_ADDRESS ${configAddr} on ${networkName}.\n` +
      `Check that the address and network in your .env are for the same chain.`,
    );
  }

  // 2. Canary call — if getAllOrionVaults() reverts the address is not an OrionConfig.
  try {
    const contract = new ethers.Contract(configAddr, ORION_CONFIG_ABI, provider);
    await contract.getAllOrionVaults(VAULT_TYPE_TRANSPARENT);
  } catch {
    throw new Error(
      `ORION_CONFIG_ADDRESS ${configAddr} does not respond to getAllOrionVaults() on ${networkName}.\n` +
      `This is likely the wrong contract address or the wrong network.`,
    );
  }

  // 3. Cross-check against known addresses for this chainId.
  const { chainId } = await provider.getNetwork();
  const known = KNOWN_CONFIGS[Number(chainId)];
  if (known) {
    const addr = configAddr.toLowerCase();
    if (known.deprecated.map((a) => a.toLowerCase()).includes(addr)) {
      console.log(
        `\n  ${c.yellow}Warning${c.reset}  ORION_CONFIG_ADDRESS is a previous ${known.label} deployment.\n` +
        `           Current   ${known.current}\n` +
        `           Got       ${configAddr}\n`,
      );
    } else if (known.current.toLowerCase() !== addr) {
      console.log(
        `\n  ${c.yellow}Warning${c.reset}  ORION_CONFIG_ADDRESS does not match the known ${known.label} config.\n` +
        `           Expected  ${known.current}\n` +
        `           Got       ${configAddr}\n`,
      );
    }
  }
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

async function isContract(provider: Provider, address: string): Promise<boolean> {
  const code = await provider.getCode(address);
  return code !== "0x" && code.length > 2;
}

async function supportsInterface(provider: Provider, address: string, id: string): Promise<boolean> {
  try {
    const contract = new ethers.Contract(address, IERC165_ABI, provider);
    return await contract.supportsInterface(id);
  } catch {
    return false;
  }
}

async function isOrionStrategist(provider: Provider, address: string, forcedId: string | undefined): Promise<boolean> {
  if (forcedId) return supportsInterface(provider, address, forcedId);
  return (
    (await supportsInterface(provider, address, I_ORION_STRATEGIST_FULL)) ||
    (await supportsInterface(provider, address, I_ORION_STRATEGIST_FUNCTIONS_ONLY))
  );
}

async function main(): Promise<void> {
  const pk = requireEnv("PRIVATE_KEY");
  const signer = new ethers.Wallet(pk, ethers.provider);
  const configAddr = ethers.getAddress(process.env.ORION_CONFIG_ADDRESS ?? DEFAULT_ORION_CONFIG);
  const rawForcedId = process.env.ORION_STRATEGIST_INTERFACE_ID;
  let forcedId: string | undefined;
  if (rawForcedId) {
    const normalized = rawForcedId.toLowerCase().replace(/^0x/, "");
    if (!/^[0-9a-f]{8}$/.test(normalized)) {
      console.error(`ORION_STRATEGIST_INTERFACE_ID must be a 4-byte hex value (e.g. 0x2a588280), got: ${rawForcedId}`);
      process.exit(1);
    }
    forcedId = `0x${normalized}`;
  }
  const dryRun = process.env.DRY_RUN === "1";

  console.log();
  console.log(SEP);
  row("Network",   `${c.bold}${networkName}${c.reset}${dryRun ? `  ${c.yellow}DRY RUN${c.reset}` : ""}`);
  row("Config",    configAddr);
  row("Signer",    signer.address);
  row("Interface", forcedId ? `${forcedId} ${c.dim}(forced)${c.reset}` : `${I_ORION_STRATEGIST_FULL}  ${c.dim}or${c.reset}  ${I_ORION_STRATEGIST_FUNCTIONS_ONLY}`);
  console.log(SEP);
  console.log();

  await validateOrionConfig(ethers.provider, configAddr, networkName);

  const config = new ethers.Contract(configAddr, ORION_CONFIG_ABI, ethers.provider);
  const vaults: string[] = await config.getAllOrionVaults(VAULT_TYPE_TRANSPARENT);
  console.log(`  ${c.dim}Transparent vaults:${c.reset}  ${c.bold}${vaults.length}${c.reset}\n`);

  let passiveCount = 0;
  let txOk = 0;
  let txFailed = 0;
  let readFailed = 0;
  let skipped = 0;

  for (let i = 0; i < vaults.length; i++) {
    const vaultAddr = ethers.getAddress(vaults[i]!);
    const vault = new ethers.Contract(vaultAddr, VAULT_ABI, ethers.provider);
    const idx = `${c.dim}[${i + 1}/${vaults.length}]${c.reset}`;

    let strategistAddr: string;
    try {
      strategistAddr = ethers.getAddress(await vault.strategist());
    } catch (e) {
      console.log(`${idx}  ${c.red}✗${c.reset}  ${vaultAddr}`);
      console.log(`       ${c.red}strategist() read failed:${c.reset} ${(e as Error).message}\n`);
      readFailed++;
      continue;
    }

    if (!(await isContract(ethers.provider, strategistAddr))) {
      console.log(`${idx}  ${c.dim}–${c.reset}  ${vaultAddr}  ${c.dim}(no contract strategist, skip)${c.reset}\n`);
      skipped++;
      continue;
    }

    if (!(await isOrionStrategist(ethers.provider, strategistAddr, forcedId))) {
      console.log(`${idx}  ${c.dim}–${c.reset}  ${vaultAddr}  ${c.dim}(not IOrionStrategist, skip)${c.reset}\n`);
      skipped++;
      continue;
    }

    passiveCount++;
    console.log(`${idx}  ${c.cyan}◆${c.reset}  ${c.bold}${vaultAddr}${c.reset}`);
    console.log(`       ${c.dim}strategist${c.reset}  ${strategistAddr}`);

    if (dryRun) {
      console.log(`       ${c.yellow}dry run${c.reset}     would call submitIntent()\n`);
      continue;
    }

    try {
      const strategist = new ethers.Contract(strategistAddr, STRATEGIST_ABI, signer);
      const tx = await strategist.submitIntent();
      const receipt = await tx.wait();
      console.log(`       ${c.dim}tx${c.reset}           ${c.green}${txLink(receipt?.hash ?? "", networkName)}${c.reset}\n`);
      txOk++;
    } catch (e) {
      console.log(`       ${c.red}failed${c.reset}       ${(e as Error).message}\n`);
      txFailed++;
    }
  }

  console.log(SEP);
  const failStr     = txFailed > 0   ? `${c.red}${txFailed} failed${c.reset}`       : `${c.dim}0 failed${c.reset}`;
  const okStr       = txOk > 0       ? `${c.green}${txOk} submitted${c.reset}`      : `${c.dim}0 submitted${c.reset}`;
  const skipStr     = `${c.dim}${skipped} skipped${c.reset}`;
  const readErrStr  = readFailed > 0 ? `  ${c.yellow}${readFailed} read error${readFailed > 1 ? "s" : ""}${c.reset}` : "";
  console.log(`  ${c.bold}${vaults.length} vaults${c.reset}  ·  ${okStr}  ·  ${failStr}  ·  ${skipStr}${readErrStr}${dryRun ? `  ${c.yellow}(dry run)${c.reset}` : ""}`);
  console.log(SEP);
  console.log();

  if (txFailed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
