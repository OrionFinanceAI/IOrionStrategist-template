import assert from "node:assert/strict";
import hre from "hardhat";
import type { HardhatEthers } from "@nomicfoundation/hardhat-ethers/types";
import { linkDeployedStrategistsToVault } from "../scripts/lib/linkVault.js";

describe("VAULT_ADDRESS linking", function () {
  this.timeout(120_000);

  async function deployFixture() {
    const connection = (await hre.network.getOrCreate()) as unknown as { ethers: HardhatEthers };
    const { ethers } = connection;
    const [manager, stranger] = await ethers.getSigners();

    const config = await (await ethers.getContractFactory("MockOrionConfig")).deploy();
    const vault = await (await ethers.getContractFactory("MockVault")).deploy(manager.address);
    const strategist = await (
      await ethers.getContractFactory("KBestTvlWeightedAverage")
    ).deploy(manager.address, await config.getAddress(), 10n);

    return { ethers, manager, stranger, vault, strategist };
  }

  it("links the strategist via vault.updateStrategist and rejects deployer setVault", async function () {
    const { ethers, manager, stranger, vault, strategist } = await deployFixture();
    const vaultAddr = await vault.getAddress();
    const strategistAddr = await strategist.getAddress();

    await assert.rejects(
      async () => {
        await strategist.getFunction("setVault")(vaultAddr);
      },
      (err: unknown) => {
        assert.match(String(err), /NotAuthorized/);
        return true;
      },
    );

    await assert.rejects(
      async () => {
        await vault.connect(stranger).getFunction("updateStrategist")(strategistAddr);
      },
      (err: unknown) => {
        assert.match(String(err), /NotAuthorized/);
        return true;
      },
    );

    await linkDeployedStrategistsToVault({
      ethers,
      deployer: manager,
      vaultAddr,
      deployed: [{ label: "KBestTvlWeightedAverage", address: strategistAddr }],
      confirmations: 1,
    });

    assert.equal(await vault.getFunction("strategist")(), strategistAddr);
  });

  it("rejects VAULT_ADDRESS when more than one strategist was deployed", async function () {
    const { ethers, manager, vault, strategist } = await deployFixture();
    const vaultAddr = await vault.getAddress();
    const strategistAddr = await strategist.getAddress();

    await assert.rejects(
      () =>
        linkDeployedStrategistsToVault({
          ethers,
          deployer: manager,
          vaultAddr,
          deployed: [
            { label: "tvl", address: strategistAddr },
            { label: "apy-equal", address: strategistAddr },
          ],
          confirmations: 1,
        }),
      /exactly one deployed strategist/,
    );
  });

  it("rejects linking when the deployer is not the vault manager", async function () {
    const { ethers, stranger, vault, strategist } = await deployFixture();
    const vaultAddr = await vault.getAddress();
    const strategistAddr = await strategist.getAddress();

    await assert.rejects(
      () =>
        linkDeployedStrategistsToVault({
          ethers,
          deployer: stranger,
          vaultAddr,
          deployed: [{ label: "tvl", address: strategistAddr }],
          confirmations: 1,
        }),
      /deployer to be the vault manager/,
    );
  });
});
