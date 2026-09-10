#!/bin/bash
# daatan#1747 verification: confirm the async born-true check fires on staging.
# Signs up a throwaway test user, logs in, creates a forecast whose claim is
# already vacuously true, then checks staging's app logs for the Telegram
# notification (or its absence/error). Cleans up the test user + forecast after.
#
# Why this needs to be run by you, not the agent: it authenticates with a
# password (even a throwaway one) — Claude Code's safety rules never enter
# credentials, no exceptions, so this step is yours to run.
#
# Usage: bash scripts/verify-1747-born-true-staging.sh
set -euo pipefail

BASE=https://staging.daatan.com
JAR=$(mktemp)
trap 'rm -f "$JAR"' EXIT

EMAIL="claude-test-1747-$(date +%s)@test.daatan.com"
# Random per run, not hardcoded — this is a throwaway signup deleted at the end
# of the script, but a literal password string in a committed file is still a
# GitGuardian false-positive magnet, so generate one instead.
PASSWORD="Tp$(openssl rand -hex 8)!Aa"

echo "=== Signing up $EMAIL ==="
curl -sS -c "$JAR" -b "$JAR" -X POST "$BASE/api/auth/signup" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"Claude Test 1747\",\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}"
echo

echo "=== Logging in ==="
CSRF=$(curl -sS -c "$JAR" -b "$JAR" "$BASE/api/auth/csrf" | python3 -c "import sys,json; print(json.load(sys.stdin)['csrfToken'])")
curl -sS -c "$JAR" -b "$JAR" -X POST "$BASE/api/auth/callback/credentials" \
  --data-urlencode "csrfToken=$CSRF" \
  --data-urlencode "email=$EMAIL" \
  --data-urlencode "password=$PASSWORD" \
  --data-urlencode "json=true" -o /dev/null -w "login HTTP:%{http_code}\n"

echo "=== Creating a vacuously-true-at-creation forecast ==="
RESOLVE_BY=$(python3 -c "from datetime import datetime,timezone; print(datetime(2030,1,1,tzinfo=timezone.utc).isoformat().replace('+00:00','Z'))")
RESP=$(curl -sS -c "$JAR" -b "$JAR" -X POST "$BASE/api/forecasts" \
  -H "Content-Type: application/json" \
  -d "{\"claimText\":\"Chess.com will have more than 100 registered users by 2030\",\"outcomeType\":\"BINARY\",\"resolutionRules\":\"Resolves YES if Chess.com reports more than 100 registered users.\",\"resolveByDatetime\":\"$RESOLVE_BY\"}")
echo "$RESP"
PRED_ID=$(echo "$RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))")
echo "prediction id: $PRED_ID"

echo "=== Waiting 25s for the async research leg ==="
sleep 25

echo "=== App logs (born-true) ==="
~/.claude/skills/ssm-exec/ssm-run.sh staging "docker logs daatan-app-staging --since 2m 2>&1 | grep -iE 'born-?true|resolutionResearch|Telegram notification sent|Telegram sendMessage failed'" 30 || true

echo "=== Cleanup ==="
if [ -n "$PRED_ID" ]; then
  ~/.claude/skills/ssm-exec/ssm-run.sh staging "docker exec daatan-postgres-staging psql -U daatan -d daatan_staging -c \"DELETE FROM predictions WHERE id = '$PRED_ID';\"" 20 || true
fi
~/.claude/skills/ssm-exec/ssm-run.sh staging "docker exec daatan-postgres-staging psql -U daatan -d daatan_staging -c \"DELETE FROM users WHERE email = '$EMAIL';\"" 20 || true

echo "=== Done. Check the staging Telegram test chat (-1003759282672) for the 🍼 'Forecast may already be resolved at creation' message. ==="
