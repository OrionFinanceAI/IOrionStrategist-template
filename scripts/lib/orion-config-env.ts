import { getAddress, ZeroAddress } from "ethers";

type Env = Record<string, string | undefined>;

const SEPOLIA_ORION_CONFIG = "0xbDe3025d08681a02a1c6cf70375baBe2152DD06f";

export type OrionConfigEnvName = "MAINNET_ORION_CONFIG_ADDRESS" | "SEPOLIA_ORION_CONFIG_ADDRESS";

/**
 * Hardhat `--network mainnet` → MAINNET_*; sepolia / hardhat / localhost → SEPOLIA_*.
 * Unset network throws. No ORION_CONFIG_ADDRESS. No DEFAULT_ORION_CONFIG.
 */
export function orionConfigEnvName(network: string | undefined): OrionConfigEnvName {
  const name = network?.trim() ?? "";
  if (!name) {
    throw new Error("CHAIN is required");
  }
  if (name === "mainnet") return "MAINNET_ORION_CONFIG_ADDRESS";
  if (name === "sepolia" || name === "hardhat" || name === "localhost") {
    return "SEPOLIA_ORION_CONFIG_ADDRESS";
  }
  throw new Error(`Unsupported CHAIN: ${name}`);
}

export function resolveOrionConfigAddress(
  network: string | undefined,
  env: Env = process.env,
): string {
  const name = orionConfigEnvName(network);
  const chain = network!.trim();
  const raw = env[name]?.trim();
  if (!raw) {
    throw new Error(`${name} is required for network ${chain}`);
  }

  let addr: string;
  try {
    addr = getAddress(raw);
  } catch {
    throw new Error(`${name} is not a valid address`);
  }

  if (addr === ZeroAddress) {
    throw new Error(`${name} must not be the zero address`);
  }

  if (chain === "mainnet" && addr === getAddress(SEPOLIA_ORION_CONFIG)) {
    throw new Error(`${name} must not be the Sepolia OrionConfig`);
  }

  return addr;
}
