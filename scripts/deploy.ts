/**
 * Deploy IOrionStrategist contracts and optionally link them to a vault.
 *
 * Available contracts:
 *   tvl          — KBestTvlWeightedAverage (top-K by TVL, TVL-proportional weights)
 *   apy-equal    — KBestApyStrategist EqualWeighted (top-K by APY, equal weights)
 *   apy-weighted — KBestApyStrategist ApyWeighted (top-K by APY, APY-proportional weights)
 *
 * Required env:
 *   PRIVATE_KEY             — deployer; becomes the strategist owner (calls submitIntent)
 *   RPC_URL                 — JSON-RPC endpoint
 *
 * Optional env:
 *   ORION_CONFIG_ADDRESS    — default: 0xbDe3025d08681a02a1c6cf70375baBe2152DD06f (Sepolia)
 *   VAULT_ADDRESS           — if set, calls setVault() on each deployed contract
 *   STRATEGIST_K            — top-K count, default: 10
 *   DEPLOY_CONTRACTS        — comma-separated subset to deploy, default: "tvl,apy-equal,apy-weighted"
 *                             e.g. DEPLOY_CONTRACTS=tvl  or  DEPLOY_CONTRACTS=apy-equal,apy-weighted
 *   SKIP_VERIFY             — set "1" to skip printing Etherscan verify commands
 *
 * Usage:
 *   npx hardhat run scripts/deploy.ts --network sepolia
 *   DEPLOY_CONTRACTS=tvl npx hardhat run scripts/deploy.ts --network sepolia
 */

import hre from "hardhat";
import type { HardhatEthers } from "@nomicfoundation/hardhat-ethers/types";
import fs from "node:fs";
import path from "node:path";

const DEFAULT_ORION_CONFIG = "0xbDe3025d08681a02a1c6cf70375baBe2152DD06f";
const WEIGHTING_EQUAL = 0n;
const WEIGHTING_APY = 1n;

const VALID_CONTRACTS = ["tvl", "apy-equal", "apy-weighted"] as const;
type ContractKey = (typeof VALID_CONTRACTS)[number];

const connection = (await hre.network.getOrCreate()) as unknown as { networkName?: string; ethers: HardhatEthers };
const { ethers } = connection;
const networkName = connection.networkName ?? process.env.HARDHAT_NETWORK ?? "hardhat";
const isLocal = networkName === "hardhat" || networkName === "localhost";
const confirmations = isLocal ? 1 : 5;

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

function parseDeployContracts(): Set<ContractKey> {
  const raw = process.env.DEPLOY_CONTRACTS ?? "tvl,apy-equal,apy-weighted";
  const keys = raw.split(",").map((s) => s.trim().toLowerCase());
  const invalid = keys.filter((k) => !VALID_CONTRACTS.includes(k as ContractKey));
  if (invalid.length > 0) {
    throw new Error(
      `Unknown DEPLOY_CONTRACTS value(s): ${invalid.join(", ")}. Valid: ${VALID_CONTRACTS.join(", ")}`,
    );
  }
  return new Set(keys as ContractKey[]);
}

function printVerifyCmd(network: string, address: string, constructorArgs: (string | bigint | number)[]): void {
  const argsStr = constructorArgs.map((a) => String(a)).join(" ");
  console.log(`  npx hardhat verify --network ${network} ${address} ${argsStr}`);
}

async function main(): Promise<void> {
  const pk = requireEnv("PRIVATE_KEY");
  const deployer = new ethers.Wallet(pk, ethers.provider);
  const configAddr = ethers.getAddress(process.env.ORION_CONFIG_ADDRESS ?? DEFAULT_ORION_CONFIG);
  const vaultAddr = process.env.VAULT_ADDRESS ? ethers.getAddress(process.env.VAULT_ADDRESS) : null;
  const k = BigInt(process.env.STRATEGIST_K ?? "10");
  const skipVerify = process.env.SKIP_VERIFY === "1";
  const deploy = parseDeployContracts();

  if (k === 0n || k > 65535n) throw new Error("STRATEGIST_K must be in range 1–65535");

  console.log(`Network:         ${networkName}`);
  console.log(`Deployer:        ${deployer.address}`);
  console.log(`OrionConfig:     ${configAddr}`);
  console.log(`K:               ${k}`);
  console.log(`Deploying:       ${[...deploy].join(", ")}`);
  if (vaultAddr) console.log(`Vault (setVault): ${vaultAddr}`);
  console.log();

  const deployed: { key: ContractKey; label: string; address: string; constructorArgs: (string | bigint | number)[] }[] =
    [];

  // ── KBestTvlWeightedAverage ───────────────────────────────────────────────
  if (deploy.has("tvl")) {
    console.log("Deploying KBestTvlWeightedAverage...");
    const Factory = await ethers.getContractFactory("KBestTvlWeightedAverage", deployer);
    const contract = await Factory.deploy(deployer.address, configAddr, k);
    await contract.deploymentTransaction()?.wait(confirmations);
    const address = await contract.getAddress();
    console.log(`  KBestTvlWeightedAverage:          ${address}`);
    deployed.push({ key: "tvl", label: "KBestTvlWeightedAverage", address, constructorArgs: [deployer.address, configAddr, k] });
  }

  // ── KBestApyStrategist — EqualWeighted ───────────────────────────────────
  if (deploy.has("apy-equal")) {
    console.log("Deploying KBestApyStrategist (EqualWeighted)...");
    const Factory = await ethers.getContractFactory("KBestApyStrategist", deployer);
    const contract = await Factory.deploy(deployer.address, configAddr, k, WEIGHTING_EQUAL);
    await contract.deploymentTransaction()?.wait(confirmations);
    const address = await contract.getAddress();
    console.log(`  KBestApyStrategist (Equal):        ${address}`);
    deployed.push({ key: "apy-equal", label: "KBestApyStrategist (EqualWeighted)", address, constructorArgs: [deployer.address, configAddr, k, WEIGHTING_EQUAL] });
  }

  // ── KBestApyStrategist — ApyWeighted ─────────────────────────────────────
  if (deploy.has("apy-weighted")) {
    console.log("Deploying KBestApyStrategist (ApyWeighted)...");
    const Factory = await ethers.getContractFactory("KBestApyStrategist", deployer);
    const contract = await Factory.deploy(deployer.address, configAddr, k, WEIGHTING_APY);
    await contract.deploymentTransaction()?.wait(confirmations);
    const address = await contract.getAddress();
    console.log(`  KBestApyStrategist (APY):          ${address}`);
    deployed.push({ key: "apy-weighted", label: "KBestApyStrategist (ApyWeighted)", address, constructorArgs: [deployer.address, configAddr, k, WEIGHTING_APY] });
  }

  if (deployed.length === 0) {
    throw new Error("DEPLOY_CONTRACTS matched nothing — check the value.");
  }

  // ── setVault (optional) ───────────────────────────────────────────────────
  if (vaultAddr) {
    console.log(`\nLinking strategists to vault ${vaultAddr}...`);
    const VAULT_ABI = ["function setVault(address) external"];
    for (const { label, address } of deployed) {
      const contract = new ethers.Contract(address, VAULT_ABI, deployer);
      const tx = await contract.setVault(vaultAddr);
      await tx.wait(confirmations);
      console.log(`  setVault ok: ${label}`);
    }
  }

  // ── Etherscan verify commands (live networks only) ────────────────────────
  if (!isLocal && !skipVerify) {
    console.log("\nTo verify on Etherscan, run:");
    for (const { address, constructorArgs } of deployed) {
      printVerifyCmd(networkName, address, constructorArgs);
    }
  }

  // ── Deployment summary ────────────────────────────────────────────────────
  const output: Record<string, unknown> = {
    network: networkName,
    timestamp: new Date().toISOString(),
    deployer: deployer.address,
    orionConfig: configAddr,
    k: Number(k),
    vault: vaultAddr ?? null,
  };
  for (const { key, address } of deployed) {
    output[key] = address;
  }

  const deploymentsDir = path.join(import.meta.dirname, "..", "deployments");
  fs.mkdirSync(deploymentsDir, { recursive: true });
  const filename = `${networkName}-${Date.now()}.json`;
  fs.writeFileSync(path.join(deploymentsDir, filename), JSON.stringify(output, null, 2));

  console.log(`\nDeployment saved to deployments/${filename}`);
  console.log(JSON.stringify(output, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
