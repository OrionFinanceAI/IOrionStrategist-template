import * as dotenv from "dotenv";
import { defineConfig } from "hardhat/config";
import hardhatEthers from "@nomicfoundation/hardhat-ethers";
import hardhatVerify from "@nomicfoundation/hardhat-verify";

dotenv.config({ quiet: true });

const config = defineConfig({
  plugins: [hardhatEthers, hardhatVerify],

  solidity: {
    // Compile the strategist implementations from the installed plugins package.
    // Run `npm update @orion-finance/plugins` to pick up upstream contract changes.
    npmFilesToBuild: [
      "@orion-finance/plugins/contracts/strategies/KBestApyStrategist.sol",
      "@orion-finance/plugins/contracts/strategies/KBestTvlWeightedAverage.sol",
    ],
    compilers: [
      {
        version: "0.8.34",
        settings: {
          optimizer: {
            enabled: true,
            runs: 10,
          },
          viaIR: true,
          evmVersion: "cancun",
        },
      },
    ],
  },

  networks: {
    hardhat: {
      type: "edr-simulated",
      chainType: "l1",
      chainId: 31337,
      initialBaseFeePerGas: 0,
    },
    localhost: {
      type: "http",
      chainType: "l1",
      url: "http://127.0.0.1:8545",
    },
    ...((): object => {
      const pk = process.env.PRIVATE_KEY ?? "";
      if (!/^0x[0-9a-fA-F]{64}$/.test(pk)) return {};
      const accounts = [pk];
      const networks: Record<string, object> = {};
      const sepoliaRpc = process.env.RPC_URL_SEPOLIA ?? "";
      const mainnetRpc = process.env.RPC_URL_MAINNET ?? "";
      const genericRpc = process.env.RPC_URL ?? "";
      if (sepoliaRpc) networks["sepolia"] = { type: "http", chainType: "l1", url: sepoliaRpc, accounts, chainId: 11155111 };
      if (mainnetRpc) networks["mainnet"] = { type: "http", chainType: "l1", url: mainnetRpc, accounts, chainId: 1 };
      if (genericRpc) networks["network"]  = { type: "http", chainType: "l1", url: genericRpc, accounts };
      return networks;
    })(),
  },

  verify: {
    etherscan: {
      apiKey: process.env.ETHERSCAN_API_KEY ?? "",
    },
  },
});

export default config;
