/**
 * Submit an intent for one or more Orion transparent vaults whose strategist implements
 * IOrionStrategist. The signer must be the owner of each strategist contract.
 *
 * Required env:
 *   PRIVATE_KEY     — strategist owner private key
 *   VAULT_ADDRESS   — vault address, or comma-separated list of vault addresses
 *
 * Optional env:
 *   ORION_STRATEGIST_INTERFACE_ID   — if set, only this bytes4 is checked (no fallback)
 *   DRY_RUN=1                       — log only, no transactions sent
 *
 * ERC-165 interface IDs (both checked by default):
 *   0x2a588280 — type(IOrionStrategist).interfaceId  (IERC165 ^ setVault ^ submitIntent)
 *   0x2ba74b27 — setVault(address) ⊕ submitIntent()  (some on-chain deployments use this)
 *
 * Exit code 1 if any submitIntent() call failed.
 *
 * Failures emit a single JSON line on stderr for CloudWatch metric filters, e.g.:
 *   { "event": "submit_intent_failed", "reason": "submit_intent_tx_failed", ... }
 *
 * Usage:
 *   npx hardhat run scripts/update-intents.ts --network sepolia
 *   VAULT_ADDRESS=0xAAA...,0xBBB... npx hardhat run scripts/update-intents.ts --network sepolia
 */

import type { Provider } from "ethers";
import hre from "hardhat";
import type { HardhatEthers } from "@nomicfoundation/hardhat-ethers/types";

const connection = (await hre.network.getOrCreate()) as unknown as { networkName?: string; ethers: HardhatEthers };
const { ethers } = connection;
const networkName = connection.networkName ?? process.env.HARDHAT_NETWORK ?? "hardhat";

const I_ORION_STRATEGIST_FULL           = "0x2a588280";
const I_ORION_STRATEGIST_FUNCTIONS_ONLY = "0x2ba74b27";

const VAULT_ABI      = ["function strategist() view returns (address)"];
const STRATEGIST_ABI = ["function submitIntent()"];
const IERC165_ABI    = ["function supportsInterface(bytes4 interfaceId) view returns (bool)"];

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
  mainnet: "https://etherscan.io",
  sepolia: "https://sepolia.etherscan.io",
  holesky: "https://holesky.etherscan.io",
  goerli:  "https://goerli.etherscan.io",
};

function txLink(hash: string, network: string): string {
  const base = EXPLORER_BASE[network];
  if (!isTTY || !base) return hash;
  const url = `${base}/tx/${hash}`;
  return `\x1b]8;;${url}\x1b\\${hash}\x1b]8;;\x1b\\`;
}

function row(label: string, value: string): void {
  console.log(`  ${c.dim}${label.padEnd(12)}${c.reset}  ${value}`);
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

async function processVault(
  vaultAddr: string,
  idx: string,
  signer: ReturnType<(typeof ethers)["Wallet"]["prototype"]["connect"]>,
  forcedId: string | undefined,
  dryRun: boolean,
): Promise<"ok" | "failed"> {
  const vault = new ethers.Contract(vaultAddr, VAULT_ABI, ethers.provider);

  let strategistAddr: string;
  try {
    strategistAddr = ethers.getAddress(await vault.strategist());
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(JSON.stringify({ event: "submit_intent_failed", reason: "strategist_read_failed", network: networkName, vault: vaultAddr, message }));
    console.log(`${idx}  ${c.red}✗${c.reset}  ${vaultAddr}`);
    console.log(`       ${c.red}strategist() read failed:${c.reset} ${message}\n`);
    return "failed";
  }

  console.log(`${idx}  ${c.cyan}◆${c.reset}  ${c.bold}${vaultAddr}${c.reset}`);
  console.log(`       ${c.dim}strategist${c.reset}  ${strategistAddr}`);

  if (!(await isContract(ethers.provider, strategistAddr))) {
    console.error(JSON.stringify({ event: "submit_intent_failed", reason: "strategist_not_contract", network: networkName, vault: vaultAddr, strategist: strategistAddr }));
    console.log(`       ${c.red}✗${c.reset}  not a contract\n`);
    return "failed";
  }

  if (!(await isOrionStrategist(ethers.provider, strategistAddr, forcedId))) {
    console.error(JSON.stringify({ event: "submit_intent_failed", reason: "strategist_interface_mismatch", network: networkName, vault: vaultAddr, strategist: strategistAddr }));
    console.log(`       ${c.red}✗${c.reset}  does not support IOrionStrategist (ERC-165 check failed)\n`);
    return "failed";
  }

  if (dryRun) {
    console.log(`       ${c.yellow}dry run${c.reset}     would call submitIntent()\n`);
    return "ok";
  }

  try {
    const strategist = new ethers.Contract(strategistAddr, STRATEGIST_ABI, signer);
    const tx      = await strategist.submitIntent();
    const receipt = await tx.wait();
    console.log(`       ${c.dim}tx${c.reset}           ${c.green}${txLink(receipt?.hash ?? "", networkName)}${c.reset}\n`);
    return "ok";
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(JSON.stringify({ event: "submit_intent_failed", reason: "submit_intent_tx_failed", network: networkName, vault: vaultAddr, strategist: strategistAddr, message }));
    console.log(`       ${c.red}failed${c.reset}       ${message}\n`);
    return "failed";
  }
}

async function main(): Promise<void> {
  const pk     = requireEnv("PRIVATE_KEY");
  const signer = new ethers.Wallet(pk, ethers.provider);
  const dryRun = process.env.DRY_RUN === "1";

  const rawAddresses = requireEnv("VAULT_ADDRESS");
  const vaultAddresses = [
    ...new Set(
      rawAddresses
        .split(",")
        .map((a) => a.trim())
        .filter(Boolean)
        .map((a) => ethers.getAddress(a)),
    ),
  ];

  if (vaultAddresses.length === 0) {
    console.error("VAULT_ADDRESS must contain at least one address.");
    process.exit(1);
  }

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

  console.log();
  console.log(SEP);
  row("Network",   `${c.bold}${networkName}${c.reset}${dryRun ? `  ${c.yellow}DRY RUN${c.reset}` : ""}`);
  row("Vaults",    `${c.bold}${vaultAddresses.length}${c.reset}`);
  row("Signer",    signer.address);
  row("Interface", forcedId ? `${forcedId} ${c.dim}(forced)${c.reset}` : `${I_ORION_STRATEGIST_FULL}  ${c.dim}or${c.reset}  ${I_ORION_STRATEGIST_FUNCTIONS_ONLY}`);
  console.log(SEP);
  console.log();

  let txOk     = 0;
  let txFailed = 0;

  for (let i = 0; i < vaultAddresses.length; i++) {
    const idx    = `${c.dim}[${i + 1}/${vaultAddresses.length}]${c.reset}`;
    const result = await processVault(vaultAddresses[i]!, idx, signer as never, forcedId, dryRun);
    if (result === "ok") txOk++; else txFailed++;
  }

  console.log(SEP);
  const okStr   = txOk     > 0 ? `${c.green}${txOk} submitted${c.reset}`     : `${c.dim}0 submitted${c.reset}`;
  const failStr = txFailed > 0 ? `${c.red}${txFailed} failed${c.reset}`       : `${c.dim}0 failed${c.reset}`;
  console.log(`  ${c.bold}${vaultAddresses.length} vault${vaultAddresses.length !== 1 ? "s" : ""}${c.reset}  ·  ${okStr}  ·  ${failStr}${dryRun ? `  ${c.yellow}(dry run)${c.reset}` : ""}`);
  console.log(SEP);
  console.log();

  if (txFailed > 0) process.exit(1);
}

main().catch((e) => {
  const message = e instanceof Error ? e.message : String(e);
  console.error(JSON.stringify({ event: "submit_intent_failed", reason: "fatal", network: networkName, message }));
  console.error(e);
  process.exit(1);
});
