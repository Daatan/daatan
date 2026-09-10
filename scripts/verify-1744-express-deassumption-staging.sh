#!/bin/bash
# daatan#1744 verification: spot-check the express-prediction prompt's new
# rule 1a (strip hidden assumptions, PR#1745) against a real assumption-laden
# input, via the actual deployed POST /api/forecasts/express/generate route
# on staging. Audit-only endpoint — it never persists a real forecast, only
# a forecastCreationAttempt row, which this script deletes afterward along
# with the throwaway test user.
#
# Why this needs to be run by you, not the agent: same as #1747's script —
# it authenticates with a password, and Claude Code's safety rules never
# enter credentials, no exceptions.
#
# Usage: bash scripts/verify-1744-express-deassumption-staging.sh
set -euo pipefail

BASE=https://staging.daatan.com
JAR=$(mktemp)
trap 'rm -f "$JAR"' EXIT

EMAIL="claude-test-1744-$(date +%s)@test.daatan.com"
# Random per run, not hardcoded — this is a throwaway signup deleted at the end
# of the script, but a literal password string in a committed file is still a
# GitGuardian false-positive magnet, so generate one instead.
PASSWORD="Tp$(openssl rand -hex 8)!Aa"

echo "=== Signing up $EMAIL ==="
curl -sS -c "$JAR" -b "$JAR" -X POST "$BASE/api/auth/signup" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"Claude Test 1744\",\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}"
echo

echo "=== Logging in ==="
CSRF=$(curl -sS -c "$JAR" -b "$JAR" "$BASE/api/auth/csrf" | python3 -c "import sys,json; print(json.load(sys.stdin)['csrfToken'])")
curl -sS -c "$JAR" -b "$JAR" -X POST "$BASE/api/auth/callback/credentials" \
  --data-urlencode "csrfToken=$CSRF" \
  --data-urlencode "email=$EMAIL" \
  --data-urlencode "password=$PASSWORD" \
  --data-urlencode "json=true" -o /dev/null -w "login HTTP:%{http_code}\n"

echo "=== Calling express-prediction generate with the issue's own worked example ==="
INPUT="The next Prime Minister of Israel elected in the October 27, 2026 Knesset elections will serve for less than a full four-year term."
curl -sS -c "$JAR" -b "$JAR" -X POST "$BASE/api/forecasts/express/generate" \
  -H "Content-Type: application/json" \
  -d "$(python3 -c "import json,sys; print(json.dumps({'userInput': sys.argv[1], 'skipSources': True}))" "$INPUT")" \
  | tee /tmp/express_1744_output.ndjson
echo
echo "=== Generated claimText / resolutionRules (eyeball for the 6 hidden assumptions from the issue) ==="
python3 -c "
import json
for line in open('/tmp/express_1744_output.ndjson'):
    line = line.strip()
    if not line: continue
    try:
        obj = json.loads(line)
    except json.JSONDecodeError:
        continue
    if obj.get('stage') == 'complete':
        data = obj.get('data', {})
        print('claimText:', data.get('claimText'))
        print()
        print('resolutionRules:', data.get('resolutionRules'))
"

echo "=== Cleanup ==="
~/.claude/skills/ssm-exec/ssm-run.sh staging "docker exec daatan-postgres-staging psql -U daatan -d daatan_staging -c \"DELETE FROM forecast_creation_attempts WHERE \\\"userId\\\" IN (SELECT id FROM users WHERE email = '$EMAIL');\"" 20 || true
~/.claude/skills/ssm-exec/ssm-run.sh staging "docker exec daatan-postgres-staging psql -U daatan -d daatan_staging -c \"DELETE FROM users WHERE email = '$EMAIL';\"" 20 || true

echo "=== Done. Compare claimText/resolutionRules above against the issue's 6 hidden-assumption list (daatan#1744). ==="
