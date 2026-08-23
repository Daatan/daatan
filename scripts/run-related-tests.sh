#!/bin/bash
# Runs vitest against only the tests related to files changed vs a base ref.
# Used by both .husky/pre-push (base ref: origin/main) and the CI "unit-test"
# job on pull_request events (base ref: the PR's base commit).
set -e

BASE_REF="${1:?usage: run-related-tests.sh <base-ref>}"

# Filter out non-existent files (deleted) and files that are NOT .ts/.tsx,
# and exclude integration tests (they need a real DB, handled separately).
FILES=$(git diff --name-only "$BASE_REF"...HEAD 2>/dev/null | grep -E "\.ts$|\.tsx$" | grep -v "\.integration\.test\.ts" | xargs -I {} sh -c 'if [ -f {} ]; then echo {}; fi' || echo "")

if [ -z "$FILES" ]; then
  echo "(No relevant source file changes found, skipping unit tests)"
else
  npx vitest related --run $FILES
fi
