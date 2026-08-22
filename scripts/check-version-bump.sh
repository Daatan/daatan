#!/bin/bash

# MONOTONICITY — the version in package.json strictly ADVANCES past the base
# branch. This catches two concurrent branches both bumping X -> Y: each looks
# fine in isolation, and both merge. That happened on 2026-08-05, when #1282
# and #1284 both landed carrying v1.65.37, so that version no longer
# identifies a unique build — which matters because prod deploys are cut from
# a `v*` tag and NEXT_PUBLIC_APP_VERSION bakes at build time.
#
# `src/lib/version.ts` used to carry a hand-maintained `// vX.Y.Z` comment
# checked for consistency here too — dropped (daatan#1522-followup): it was
# never code-read (VERSION comes from the NEXT_PUBLIC_APP_VERSION build arg),
# so it only added a manual edit that collided across concurrent branches
# without catching anything this check doesn't already catch.
#
# This check is skipped when the base ref is unavailable (a fresh clone with
# no `origin/main`, or a detached checkout), so the local hook degrades to a
# no-op instead of blocking work offline. CI fetches the base explicitly and
# therefore always runs it — see .github/workflows/version.yml.
#
# Override the base with VERSION_CHECK_BASE (e.g. for a release branch).

set -uo pipefail

PKG_VERSION=$(node -p "require('./package.json').version")

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
