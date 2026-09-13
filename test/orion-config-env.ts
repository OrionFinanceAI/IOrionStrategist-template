import assert from "node:assert/strict";
import { getAddress, ZeroAddress } from "ethers";
import {
  orionConfigEnvName,
  resolveOrionConfigAddress,
} from "../scripts/lib/orion-config-env.js";

const SEPOLIA = "0xbDe3025d08681a02a1c6cf70375baBe2152DD06f";
const OTHER = "0x1111111111111111111111111111111111111111";

describe("orionConfigEnvName", function () {
  it("throws when network is unset", function () {
    assert.throws(() => orionConfigEnvName(undefined), /CHAIN is required/);
    assert.throws(() => orionConfigEnvName("  "), /CHAIN is required/);
  });

  it("maps mainnet vs sepolia forks", function () {
    assert.equal(orionConfigEnvName("mainnet"), "MAINNET_ORION_CONFIG_ADDRESS");
    assert.equal(orionConfigEnvName("sepolia"), "SEPOLIA_ORION_CONFIG_ADDRESS");
    assert.equal(orionConfigEnvName("hardhat"), "SEPOLIA_ORION_CONFIG_ADDRESS");
    assert.equal(orionConfigEnvName("localhost"), "SEPOLIA_ORION_CONFIG_ADDRESS");
  });

  it("rejects the generic hardhat `network` alias", function () {
    assert.throws(() => orionConfigEnvName("network"), /Unsupported CHAIN: network/);
  });
});

describe("resolveOrionConfigAddress", function () {
  it("returns checksummed SEPOLIA_* on sepolia", function () {
    assert.equal(
      resolveOrionConfigAddress("sepolia", { SEPOLIA_ORION_CONFIG_ADDRESS: SEPOLIA.toLowerCase() }),
      getAddress(SEPOLIA),
    );
  });

  it("returns checksummed MAINNET_* on mainnet", function () {
    assert.equal(
      resolveOrionConfigAddress("mainnet", { MAINNET_ORION_CONFIG_ADDRESS: OTHER }),
      getAddress(OTHER),
    );
  });

  it("does not read the other chain var", function () {
    assert.throws(
      () => resolveOrionConfigAddress("sepolia", { MAINNET_ORION_CONFIG_ADDRESS: OTHER }),
      /SEPOLIA_ORION_CONFIG_ADDRESS is required for network sepolia/,
    );
    assert.throws(
      () => resolveOrionConfigAddress("mainnet", { SEPOLIA_ORION_CONFIG_ADDRESS: SEPOLIA }),
      /MAINNET_ORION_CONFIG_ADDRESS is required for network mainnet/,
    );
  });

  it("throws on zero address and Sepolia address on mainnet", function () {
    assert.throws(
      () => resolveOrionConfigAddress("sepolia", { SEPOLIA_ORION_CONFIG_ADDRESS: ZeroAddress }),
      /SEPOLIA_ORION_CONFIG_ADDRESS must not be the zero address/,
    );
    assert.throws(
      () => resolveOrionConfigAddress("mainnet", { MAINNET_ORION_CONFIG_ADDRESS: SEPOLIA }),
      /MAINNET_ORION_CONFIG_ADDRESS must not be the Sepolia OrionConfig/,
    );
  });

  it("ignores ORION_CONFIG_ADDRESS and DEFAULT_ORION_CONFIG", function () {
    assert.throws(
      () => resolveOrionConfigAddress("sepolia", { ORION_CONFIG_ADDRESS: SEPOLIA }),
      /SEPOLIA_ORION_CONFIG_ADDRESS is required for network sepolia/,
    );
  });
});
