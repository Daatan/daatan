#!/usr/bin/env bash
# Self-hosted edition smoke test (Layer 1 of docs/SELF_HOST_TEST_PLAN.md).
# Verifies a running self-host stack is healthy. Exits non-zero on any failure,
# so it's usable in CI or a deploy gate.
#
# Usage: ./scripts/selfhost-smoke.sh [base-url]   (default http://localhost:3000)
set -euo pipefail

BASE="${1:-http://localhost:3000}"
fail() { echo "❌ $1"; exit 1; }
ok()   { echo "✅ $1"; }

echo "🔎 Smoke-testing self-host at $BASE"

# 1. App + DB health
HEALTH="$(curl -fsS --max-time 10 "$BASE/api/health" 2>/dev/null)" || fail "/api/health not reachable"
echo "$HEALTH" | grep -q '"status":"ok"' || fail "/api/health not ok: $HEALTH"
ok "/api/health ok"

# 2. Auth config health (should be green even with no Google, via OIDC/credentials)
curl -fsS --max-time 10 "$BASE/api/health/auth" >/dev/null 2>&1 || fail "/api/health/auth not reachable"
ok "/api/health/auth reachable"

# 3. Homepage renders
CODE="$(curl -fsS -o /dev/null -w '%{http_code}' --max-time 15 "$BASE/")" || fail "homepage request failed"
[ "$CODE" = "200" ] || fail "homepage returned HTTP $CODE"
ok "homepage 200"

# 4. Self-host must be noindex (robots disallows all)
ROBOTS="$(curl -fsS --max-time 10 "$BASE/robots.txt" 2>/dev/null)" || fail "/robots.txt not reachable"
echo "$ROBOTS" | grep -qi 'Disallow: /' || fail "robots.txt is not disallow-all (expected for self-host): $ROBOTS"
ok "robots.txt disallows all (noindex)"

echo "🎉 Smoke test passed."
