#!/bin/bash

# Two checks on the app version, in increasing order of what they can catch.
#
# 1. CONSISTENCY — package.json and src/lib/version.ts agree. Cheap, local,
#    and all this script used to do. It cannot tell whether a bump happened at
#    all, only that the two files say the same thing.
#
# 2. MONOTONICITY — the version strictly ADVANCES past the base branch. This is
#    the one that catches two concurrent branches both bumping X -> Y: each is
#    self-consistent, each passes (1), and both merge. That happened on
#    2026-08-05, when #1282 and #1284 both landed carrying v1.65.37, so that
#    version no longer identifies a unique build — which matters because prod
#    deploys are cut from a `v*` tag and NEXT_PUBLIC_APP_VERSION bakes at build
#    time.
#
# (2) is skipped when the base ref is unavailable (a fresh clone with no
# `origin/main`, or a detached checkout), so the local hook degrades to the old
# behaviour instead of blocking work offline. CI fetches the base explicitly and
# therefore always runs it — see .github/workflows/version.yml.
#
# Override the base with VERSION_CHECK_BASE (e.g. for a release branch).

set -uo pipefail

PKG_VERSION=$(node -p "require('./package.json').version")
TS_VERSION=$(grep -oP '// v\K[0-9]+\.[0-9]+\.[0-9]+' src/lib/version.ts)

echo "🔍 Checking version consistency..."
echo "   package.json:       v$PKG_VERSION"
echo "   src/lib/version.ts: v${TS_VERSION:-<no comment>}"

if [ -n "$TS_VERSION" ] && [ "$PKG_VERSION" != "$TS_VERSION" ]; then
  echo "❌ ERROR: Version mismatch!"
  echo "   package.json ($PKG_VERSION) does not match src/lib/version.ts ($TS_VERSION)"
  echo "   Align both files before committing."
  exit 1
fi

echo "✅ Version consistency check passed"

BASE_REF="${VERSION_CHECK_BASE:-origin/main}"

# On the base branch itself there is nothing to advance past.
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
if [ "$CURRENT_BRANCH" = "main" ]; then
  echo "ℹ️  On main — skipping the monotonicity check."
  exit 0
fi

if ! git rev-parse -q --verify "$BASE_REF" >/dev/null 2>&1; then
  echo "ℹ️  $BASE_REF not available — skipping the monotonicity check."
  exit 0
fi

BASE_VERSION=$(git show "$BASE_REF:package.json" 2>/dev/null | node -p "JSON.parse(require('fs').readFileSync(0,'utf8')).version" 2>/dev/null)
if [ -z "$BASE_VERSION" ]; then
  echo "ℹ️  Could not read the version from $BASE_REF — skipping the monotonicity check."
  exit 0
fi

echo "🔍 Checking the version advances past $BASE_REF (v$BASE_VERSION)..."

if [ "$PKG_VERSION" = "$BASE_VERSION" ]; then
  echo "❌ ERROR: Version v$PKG_VERSION is already on $BASE_REF."
  echo "   Another branch almost certainly bumped to it while this one was open."
  echo "   Two commits sharing a version make it useless for identifying a build,"
  echo "   and prod deploys are cut from a v* tag. Bump again, past v$BASE_VERSION."
  exit 1
fi

# sort -V puts the lower version first; if that is ours, we are behind.
LOWER=$(printf '%s\n%s\n' "$PKG_VERSION" "$BASE_VERSION" | sort -V | head -1)
if [ "$LOWER" = "$PKG_VERSION" ]; then
  echo "❌ ERROR: Version v$PKG_VERSION is BEHIND $BASE_REF (v$BASE_VERSION)."
  echo "   Rebase onto $BASE_REF and bump past v$BASE_VERSION."
  echo "   Note a rebase silently DROPS a bump when both branches made the same"
  echo "   X -> Y change: the patch becomes a no-op and the branch inherits the"
  echo "   base version. Re-check after every rebase."
  exit 1
fi

echo "✅ Version advances: v$BASE_VERSION → v$PKG_VERSION"
exit 0
