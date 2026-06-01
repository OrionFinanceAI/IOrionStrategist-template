#!/usr/bin/env bash
# Sets up a cron job to run update-intents every 4 hours.
#
# Usage:
#   bash infra/cron/setup.sh           # prints the crontab line to add manually
#   bash infra/cron/setup.sh --install # installs the crontab entry automatically
#
# Prerequisites:
#   - .env file populated (see .env.example)
#   - npm dependencies installed (npm install)
#   - Contracts compiled (npx hardhat compile)
#   - Set NETWORK below to your target network (sepolia | mainnet | localhost)

set -euo pipefail

NETWORK="${NETWORK:-mainnet}"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LOG_FILE="/var/log/iorion-strategist-template.log"

# Validate that .env exists and has PRIVATE_KEY
if [[ ! -f "${REPO_DIR}/.env" ]]; then
  echo "Error: ${REPO_DIR}/.env not found. Copy .env.example and fill in your values." >&2
  exit 1
fi

if ! grep -q "^PRIVATE_KEY=" "${REPO_DIR}/.env" 2>/dev/null; then
  echo "Warning: PRIVATE_KEY not found in .env — the cron job will fail at runtime." >&2
fi

CRON_LINE="0 */4 * * * cd ${REPO_DIR} && set -a && . ${REPO_DIR}/.env && set +a && npx hardhat run scripts/update-intents.ts --network ${NETWORK} >> ${LOG_FILE} 2>&1"

if [[ "${1:-}" == "--install" ]]; then
  if crontab -l 2>/dev/null | grep -Fx "${CRON_LINE}" > /dev/null; then
    echo "Crontab entry already exists — nothing changed."
    exit 0
  fi
  (crontab -l 2>/dev/null; echo "${CRON_LINE}") | crontab -
  echo "Crontab entry installed (every 4 hours, network: ${NETWORK})."
  echo "Logs will be written to ${LOG_FILE}"
  echo
  echo "To view the crontab: crontab -l"
  echo "To remove the entry: crontab -e"
else
  echo "Add the following line to your crontab (run: crontab -e):"
  echo
  echo "  ${CRON_LINE}"
  echo
  echo "Or run with --install to add it automatically:"
  echo "  NETWORK=${NETWORK} bash infra/cron/setup.sh --install"
fi
