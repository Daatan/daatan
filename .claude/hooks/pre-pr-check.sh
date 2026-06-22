#!/bin/bash
# Pre-PR hook: blocks `gh pr create` until quality checklist is satisfied.
# Claude Code passes the tool input as JSON on stdin.

COMMAND=$(python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('command',''))" 2>/dev/null)

if echo "$COMMAND" | grep -q "gh pr create"; then
  # Check version bump: package.json version must differ from main
  MAIN_VERSION=$(git show origin/main:package.json 2>/dev/null | python3 -c "import sys,json; print(json.load(sys.stdin).get('version',''))" 2>/dev/null)
  CURRENT_VERSION=$(python3 -c "import json; print(json.load(open('package.json')).get('version',''))" 2>/dev/null)

  if [ "$MAIN_VERSION" = "$CURRENT_VERSION" ]; then
    echo "BLOCKED — version not bumped."
    echo ""
    echo "package.json version is still $CURRENT_VERSION (same as main)."
    echo "Bump both package.json and src/lib/version.ts (the // vX.Y.Z comment)"
    echo "before creating a PR."
    exit 2
  fi

  echo "BLOCKED — pre-PR checklist not satisfied."
  echo ""
  echo "Before creating a PR you must:"
  echo "  1. Improve or add documentation for any changed behaviour"
  echo "  2. Add or update tests for changed code"
  echo "  3. Check translations — any new UI strings must be added to all"
  echo "     four locale files: messages/en.json, messages/he.json,"
  echo "     messages/ru.json, messages/eo.json"
  echo ""
  echo "Steps:"
  echo "  a) Run /simplify to review code quality"
  echo "  b) Add missing tests (unit + integration where applicable)"
  echo "  c) Update relevant docs / comments / prompt files"
  echo "  d) Search changed .tsx files for hardcoded user-visible strings"
  echo "     not wrapped in t() — add them to all four message files"
  echo "  e) Once done, re-run the PR creation command"
  exit 2
fi
