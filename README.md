# IOrionStrategist Template

A self-contained template for deploying and automating [`IOrionStrategist`](https://github.com/OrionFinanceAI/protocol) contracts against the [Orion Finance protocol](https://github.com/OrionFinanceAI/protocol).

Clone this repo, fill in a `.env`, and you're ready to deploy or run automated rebalancing.

## Strategist contracts

This template deploys the following strategists from the Orion Finance protocol (sourced directly via npm — no local copies):

| Key | Contract | Strategy |
|---|---|---|
| `tvl` | `KBestTvlWeightedAverage` | Top-K assets by TVL, weighted proportionally to TVL |
| `apy-equal` | `KBestApyStrategist` (EqualWeighted) | Top-K assets by APY, equal weights |
| `apy-weighted` | `KBestApyStrategist` (ApyWeighted) | Top-K assets by APY, weights ∝ APY |

---

## Prerequisites

- Node.js ≥ 22
- npm

---

## Quick start

```bash
git clone https://github.com/OrionFinanceAI/IOrionStrategist-template.git
cd IOrionStrategist-template
npm install
cp .env.example .env
# Edit .env with your RPC_URL, PRIVATE_KEY, and ORION_CONFIG_ADDRESS
npm run compile
```

---

## Deploy contracts

```bash
# Deploy all three strategist variants
npx hardhat run scripts/deploy.ts --network sepolia

# Or via npm (pass network after --)
npm run deploy -- --network sepolia

# Deploy a single contract
DEPLOY_CONTRACTS=tvl npx hardhat run scripts/deploy.ts --network sepolia

# Deploy a subset
DEPLOY_CONTRACTS=apy-equal,apy-weighted npx hardhat run scripts/deploy.ts --network sepolia
```

A deployment summary is written to `deployments/<network>-<timestamp>.json` (gitignored).

### Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `PRIVATE_KEY` | Yes | — | Deployer key; becomes strategist owner |
| `RPC_URL_SEPOLIA` | For Sepolia | — | Sepolia JSON-RPC endpoint |
| `RPC_URL_MAINNET` | For mainnet | — | Mainnet JSON-RPC endpoint |
| `RPC_URL` | For `--network network` | — | Generic/fallback RPC endpoint |
| `ORION_CONFIG_ADDRESS` | No | `0xbDe3025d...` (Sepolia) | OrionConfig contract |
| `VAULT_ADDRESS` | No | — | If set, calls `setVault()` on each deployed contract |
| `STRATEGIST_K` | No | `10` | Top-K assets to select (1–65535) |
| `DEPLOY_CONTRACTS` | No | `tvl,apy-equal,apy-weighted` | Comma-separated contracts to deploy |
| `SKIP_VERIFY` | No | — | Set `1` to skip printing verify commands |
| `ETHERSCAN_API_KEY` | No | — | Needed to run `hardhat verify` after deployment |

### Deployment output

```json
{
  "network": "sepolia",
  "timestamp": "2026-05-21T12:00:00.000Z",
  "deployer": "0x...",
  "orionConfig": "0x...",
  "k": 10,
  "vault": null,
  "tvl": "0x...",
  "apy-equal": "0x...",
  "apy-weighted": "0x..."
}
```

---

## Link a strategist to a vault

Each strategist must be linked to exactly one transparent vault via `setVault()`. This is a one-time, irreversible call.

**Automatic** — set `VAULT_ADDRESS` in `.env` before running `deploy.ts`. The script calls `setVault()` on each deployed contract after deployment.

**Manual** — call `setVault()` on a deployed strategist:

```ts
const strategist = await ethers.getContractAt("KBestTvlWeightedAverage", "0x<STRATEGIST_ADDR>");
await strategist.setVault("0x<VAULT_ADDR>");
```

---

## Verify on Etherscan

After deployment, the script prints the exact commands to verify each contract:

```text
To verify on Etherscan, run:
  npx hardhat verify --network sepolia 0x<TVL_ADDR> <owner> <config> <k>
  ...
```

Verification publishes the source code to Etherscan so anyone can audit the logic and interact with the contract directly via the Etherscan UI. Requires `ETHERSCAN_API_KEY` in `.env`.

---

## Run rebalancing manually

Provide one vault address or a comma-separated list. The script reads the `strategist()` on each vault, verifies it implements `IOrionStrategist` (ERC-165), and calls `submitIntent()` as the `PRIVATE_KEY` signer (the strategist owner).

```bash
# Single vault
VAULT_ADDRESS=0xAAA... npx hardhat run scripts/update-intents.ts --network sepolia

# Multiple vaults
VAULT_ADDRESS=0xAAA...,0xBBB...,0xCCC... npx hardhat run scripts/update-intents.ts --network sepolia

# Or via npm
npm run update-intents -- --network sepolia
```

Dry-run (no transactions, all vaults still resolved and checked):

```bash
DRY_RUN=1 VAULT_ADDRESS=0xAAA...,0xBBB... npx hardhat run scripts/update-intents.ts --network sepolia
```

Exit code is `1` if any `submitIntent()` call failed — useful for cron/ECS alerting.

### Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `PRIVATE_KEY` | Yes | — | Strategist owner key |
| `VAULT_ADDRESS` | Yes | — | Vault address or comma-separated list of vault addresses |
| `ORION_STRATEGIST_INTERFACE_ID` | No | — | Override ERC-165 check to a specific bytes4 |
| `DRY_RUN` | No | — | Set `1` to log only — no transactions sent |

---

## Automated rebalancing

### Option A — Cron job

```bash
# Preview the crontab line
bash infra/cron/setup.sh

# Or install it automatically (runs every 4 hours)
NETWORK=mainnet bash infra/cron/setup.sh --install
```

Logs are written to `/var/log/orion-update-intents.log`.

### Option B — AWS ECS (Fargate + EventBridge)

1. **Build and push the image**

   ```bash
   docker build -f infra/ecs/Dockerfile -t <ECR_REPO_URI>:latest .
   docker push <ECR_REPO_URI>:latest
   ```

2. **Store secrets in AWS Secrets Manager**

   ```bash
   aws secretsmanager create-secret --name orion/PRIVATE_KEY --secret-string '0x...'
   aws secretsmanager create-secret --name orion/RPC_URL     --secret-string 'https://...'
   ```

3. **Register the task** — fill in the `<PLACEHOLDERS>` in `infra/ecs/task-definition.json`, then:

   ```bash
   aws ecs register-task-definition --cli-input-json file://infra/ecs/task-definition.json
   ```

4. **Schedule with EventBridge** — see the `_comment` block in `infra/ecs/task-definition.json` for the full `aws events put-rule` command. The default schedule is every 4 hours (`cron(0 */4 * * ? *)`).

---

## Keeping contracts up to date

Contract source lives in the public [OrionFinanceAI/protocol](https://github.com/OrionFinanceAI/protocol) repo. To pull the latest version:

```bash
npm update @orion-finance/protocol
npm run compile
```

---

## Writing a custom strategist

To deploy your own strategist, implement `IOrionStrategist`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import "@orion-finance/protocol/contracts/interfaces/IOrionStrategist.sol";
import "@orion-finance/protocol/contracts/interfaces/IOrionTransparentVault.sol";
import "@openzeppelin/contracts/utils/introspection/ERC165.sol";

contract MyStrategist is IOrionStrategist, ERC165 {
    address private _vault;

    function setVault(address vault_) external {
        require(_vault == address(0), "already linked");
        _vault = vault_;
    }

    function submitIntent() external {
        IOrionTransparentVault.IntentPosition[] memory intent = _buildIntent();
        IOrionTransparentVault(_vault).submitIntent(intent);
    }

    function supportsInterface(bytes4 id) public view override(ERC165, IERC165) returns (bool) {
        return id == type(IOrionStrategist).interfaceId || super.supportsInterface(id);
    }

    function _buildIntent() internal view returns (IOrionTransparentVault.IntentPosition[] memory) {
        // your allocation logic here
    }
}
```

1. Place the contract under `contracts/` in this repo.
2. Add `contracts/` as a source in `hardhat.config.ts`:

   ```ts
   paths: { sources: "./contracts" }
   ```

3. Add a deploy step in `scripts/deploy.ts`.
