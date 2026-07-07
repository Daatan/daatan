#!/bin/bash
# check-env-parity.sh — Verify that blue-green-deploy.sh and the compose files
# pass the same set of environment variables to the app containers.
#
# Run in CI on every PR to catch env var drift before it reaches production.
# Usage: ./scripts/check-env-parity.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$SCRIPT_DIR/.."

BLUE_GREEN="$ROOT/scripts/blue-green-deploy.sh"
COMPOSE_PROD="$ROOT/docker-compose.prod.yml"
COMPOSE_STAGING="$ROOT/docker-compose.staging.yml"

# Extract env keys from blue-green-deploy.sh for a given environment branch.
# Matches lines of the form: ENV_ARGS+=(-e "KEY=...") or ENV_ARGS+=(-e KEY)
# (ENV_ARGS is a bash array — see the word-splitting bug this fixed, 2026-07-07:
# a plain string ENV_ARGS with unquoted expansion broke on any value containing
# a space, e.g. a PEM key's "-----BEGIN PRIVATE KEY-----" header.)
blue_green_keys_common() {
  # Keys set unconditionally (before the if/else branch)
  awk '/ENV_ARGS\+=\(-e /,/if \[ "\$ENVIRONMENT"/' "$BLUE_GREEN" \
    | grep -oP '(?<=-e )"?[A-Z_]+' | tr -d '"' | sort -u
}

blue_green_keys_prod() {
  # Keys set in the production (else) branch
  awk '/else$/,/^fi$/' "$BLUE_GREEN" \
    | grep -oP '(?<=-e )"?[A-Z_]+' | tr -d '"' | sort -u
}

blue_green_keys_staging() {
  # Keys set in the staging branch
  awk '/if \[ "\$ENVIRONMENT" = "staging" \]/,/else$/' "$BLUE_GREEN" \
    | grep -oP '(?<=-e )"?[A-Z_]+' | tr -d '"' | sort -u
}

# Extract env keys from a compose file's named service block.
# Reads from "  <service>:" until the next top-level service or end of file.
compose_service_keys() {
  local file="$1"
  local service="$2"
  # Use a state-machine awk: once we find the service line, start collecting.
  # Stop when we hit another top-level service (2-space indent + lowercase letter).
  # This avoids the awk range bug where the end pattern also matches the start line.
  awk "
    /^  ${service}:\$/ { found=1; next }
    found && /^  [a-z]/ { exit }
    found { print }
  " "$file" \
    | grep -oP '(?<=- )[A-Z_]+(?==)' \
    | sort -u
}

FAIL=0

check_parity() {
  local label="$1"
  local bg_keys="$2"
  local compose_keys="$3"

  only_bg=$(comm -23 <(echo "$bg_keys") <(echo "$compose_keys"))
  only_cp=$(comm -13 <(echo "$bg_keys") <(echo "$compose_keys"))

  if [[ -n "$only_bg" ]]; then
    echo "FAIL [$label]: in blue-green-deploy.sh but NOT in compose:"
    echo "$only_bg" | sed 's/^/  - /'
    FAIL=1
  fi
  if [[ -n "$only_cp" ]]; then
    echo "FAIL [$label]: in compose but NOT in blue-green-deploy.sh:"
    echo "$only_cp" | sed 's/^/  - /'
    FAIL=1
  fi
  if [[ -z "$only_bg" && -z "$only_cp" ]]; then
    COUNT=$(echo "$bg_keys" | wc -l | tr -d ' ')
    echo "OK [$label]: $COUNT vars in sync"
  fi
}

# Combine common + env-specific keys for each environment
BG_PROD=$(sort -u <(blue_green_keys_common) <(blue_green_keys_prod))
BG_STAGING=$(sort -u <(blue_green_keys_common) <(blue_green_keys_staging))

CP_PROD=$(compose_service_keys "$COMPOSE_PROD" "app")
CP_STAGING=$(compose_service_keys "$COMPOSE_STAGING" "app-staging")

check_parity "production" "$BG_PROD" "$CP_PROD"
check_parity "staging"    "$BG_STAGING" "$CP_STAGING"

exit $FAIL
