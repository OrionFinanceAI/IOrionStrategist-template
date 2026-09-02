import type { HardhatEthers } from "@nomicfoundation/hardhat-ethers/types";
import type { Signer } from "ethers";

const VAULT_ABI = [
  "function updateStrategist(address) external",
  "function manager() view returns (address)",
];

export type DeployedStrategist = { label: string; address: string };

/**
 * Link a newly deployed strategist to an existing vault.
 *
 * `setVault` on IOrionStrategist is only callable by the vault itself. The
 * authorized path is OrionVault.updateStrategist, which requires the signer
 * to be the vault manager.
 */
export async function linkDeployedStrategistsToVault(opts: {
  ethers: HardhatEthers;
  deployer: Signer;
  vaultAddr: string;
  deployed: DeployedStrategist[];
  confirmations: number;
}): Promise<void> {
  const { ethers, deployer, vaultAddr, deployed, confirmations } = opts;
  if (deployed.length !== 1) {
    throw new Error(
      "VAULT_ADDRESS requires exactly one deployed strategist. A vault has a single strategist — set DEPLOY_CONTRACTS to one of: tvl, apy-equal, apy-weighted.",
    );
  }

  const { label, address } = deployed[0];
  const vault = new ethers.Contract(vaultAddr, VAULT_ABI, deployer);
  const manager = await vault.manager();
  const deployerAddr = await deployer.getAddress();
  if (ethers.getAddress(manager) !== ethers.getAddress(deployerAddr)) {
    throw new Error(
      `VAULT_ADDRESS linking requires the deployer to be the vault manager (deployer=${deployerAddr}, manager=${manager})`,
    );
  }

  console.log(`\nLinking ${label} to vault ${vaultAddr} via updateStrategist...`);
  const tx = await vault.updateStrategist(address);
  await tx.wait(confirmations);
  console.log(`  updateStrategist ok: ${label}`);
}
