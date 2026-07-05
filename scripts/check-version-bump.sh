#!/bin/bash

# Check version consistency between package.json and src/lib/version.ts.
# CLAUDE.md's hard rule requires bumping both on every non-main commit; this
# hook only checks that the two files agree when both are staged — it does
# not itself enforce that a bump happened.

PKG_VERSION=$(node -p "require('./package.json').version")
TS_VERSION=$(grep -oP '// v\K[0-9]+\.[0-9]+\.[0-9]+' src/lib/version.ts)

echo "🔍 Checking version consistency..."
echo "   package.json:       v$PKG_VERSION"
echo "   src/lib/version.ts: v${TS_VERSION:-<no comment>}"

# If both files were staged, they must agree
STAGED=$(git diff --cached --name-only)
PKG_STAGED=$(echo "$STAGED" | grep -c "package.json" || true)
TS_STAGED=$(echo "$STAGED" | grep -c "src/lib/version.ts" || true)

if [ -n "$TS_VERSION" ] && [ "$PKG_VERSION" != "$TS_VERSION" ]; then
  echo "❌ ERROR: Version mismatch!"
  echo "   package.json ($PKG_VERSION) does not match src/lib/version.ts ($TS_VERSION)"
  echo "   Align both files before committing."
  exit 1
fi

echo "✅ Version consistency check passed"
exit 0
