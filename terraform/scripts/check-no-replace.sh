#!/usr/bin/env bash
# check-no-replace.sh — pre-apply guardrail against silent EC2 instance replacement.
#
# Background (daatan#1194): `key_name` on aws_instance.production / aws_instance.staging
# is an IMMUTABLE EC2 attribute (terraform/ec2.tf). terraform/*.tfvars files are
# gitignored — a local-only drift (a stale WIP edit, an abandoned key-rotation attempt,
# a typo) never goes through PR review or CI, and sits silent until someone runs
# `terraform apply` against the affected resource. At that point Terraform plans a full
# destroy-and-recreate of a live instance, silently, with only `lifecycle.prevent_destroy`
# standing between that plan and reality.
#
# This already happened once: a stale `ssh_key_name` value in a local tfvars file caused
# a routine `terraform plan` to come back "2 to add, 0 to change, 2 to destroy" for BOTH
# aws_instance.production and aws_instance.staging. See the full incident writeup in
# https://github.com/Daatan/daatan/issues/1194
#
# Both aws_instance.production and aws_instance.staging are applied from the PROD
# Terraform state (see the comment on aws_instance.staging in terraform/ec2.tf) — this
# script always plans against the prod backend/tfvars, matching the documented Gate-1
# procedure in terraform/README.md. It does not apply anything; it only inspects a plan.
#
# Usage:
#   terraform/scripts/check-no-replace.sh              # run the real guardrail
#   terraform/scripts/check-no-replace.sh --self-test   # run offline unit tests on
#                                                        # canned plan-output fixtures
#                                                        # (no AWS access, no real plan)
#
# Exit codes:
#   0 — safe: no changes, or changes present but none of them replace an instance
#   1 — STOP: either a replace was detected, or `terraform plan`/`init` itself errored
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TF_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# ---------------------------------------------------------------------------
# detect_replace <plan-output-file>
#
# Reads a terraform plan's text output and reports whether it contains an
# instance replacement. Terraform prints two independent markers for a forced
# replacement and either one is sufficient to flag it:
#
#   1. the human-readable comment line above the resource block:
#        "  # aws_instance.production must be replaced"
#   2. the resource action header itself:
#        "-/+ resource \"aws_instance\" \"production\" {"
#
# A pure in-place update uses "~ resource ..." (no leading "-/+") and a
# "will be updated in-place" comment, which this deliberately does NOT match.
#
# Returns 0 (grep found a match) if a replace is detected, 1 if the plan is
# clean of replacements. This mirrors grep's own exit-code convention, which
# is the opposite of "0 = good" — callers must not treat this as a shell
# success/failure check, only as an explicit branch on the return value.
# ---------------------------------------------------------------------------
detect_replace() {
  grep -E -n '(^[[:space:]]*#[[:space:]]+aws_instance\.[A-Za-z_]+[[:space:]]+must be replaced)|(^-/\+[[:space:]]+resource[[:space:]]+"aws_instance")' "$1"
}

# ---------------------------------------------------------------------------
# Self-test: exercise detect_replace() against synthetic terraform plan
# output, without touching AWS or the real backend. This is the test mode
# referenced in the PR — run it with:
#   terraform/scripts/check-no-replace.sh --self-test
# ---------------------------------------------------------------------------
run_self_test() {
  local tmp
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' RETURN

  local failures=0

  # Fixture 1: a genuine replace (this is the daatan#1194 incident shape).
  cat > "$tmp/replace.txt" <<'EOF'
aws_instance.production: Refreshing state... [id=i-04ea44d4243d35624]
aws_instance.staging: Refreshing state... [id=i-0406d237ca5d92cdf]

Terraform used the selected providers to generate the following execution plan. Resource
actions are indicated with the following symbols:
  -/+ destroy and then create replacement

Terraform will perform the following actions:

  # aws_instance.production must be replaced
-/+ resource "aws_instance" "production" {
      ~ id        = "i-04ea44d4243d35624" -> (known after apply)
      ~ key_name  = "daatan-key" -> "daatan-key-new" # forces replacement
        # (25 unchanged attributes hidden)
    }

  # aws_instance.staging must be replaced
-/+ resource "aws_instance" "staging" {
      ~ id        = "i-0406d237ca5d92cdf" -> (known after apply)
      ~ key_name  = "daatan-key" -> "daatan-key-new" # forces replacement
        # (25 unchanged attributes hidden)
    }

Plan: 2 to add, 0 to change, 2 to destroy.
EOF

  # Fixture 2: a benign in-place change — must NOT be flagged.
  cat > "$tmp/inplace.txt" <<'EOF'
aws_instance.production: Refreshing state... [id=i-04ea44d4243d35624]

Terraform used the selected providers to generate the following execution plan. Resource
actions are indicated with the following symbols:
  ~ update in-place

Terraform will perform the following actions:

  # aws_instance.production will be updated in-place
  ~ resource "aws_instance" "production" {
      ~ tags = {
          ~ "Environment" = "prod" -> "production"
        }
        # (26 unchanged attributes hidden)
    }

Plan: 0 to add, 1 to change, 0 to destroy.
EOF

  # Fixture 3: no changes at all — must NOT be flagged.
  cat > "$tmp/nochange.txt" <<'EOF'
aws_instance.production: Refreshing state... [id=i-04ea44d4243d35624]
aws_instance.staging: Refreshing state... [id=i-0406d237ca5d92cdf]

No changes. Your infrastructure matches the configuration.
EOF

  echo "Running self-test against synthetic terraform plan fixtures..."
  echo

  if detect_replace "$tmp/replace.txt" >/dev/null; then
    echo -e "${GREEN}PASS${NC}: replace fixture correctly detected as a replace"
  else
    echo -e "${RED}FAIL${NC}: replace fixture was NOT detected (should have been)"
    failures=$((failures + 1))
  fi

  if detect_replace "$tmp/inplace.txt" >/dev/null; then
    echo -e "${RED}FAIL${NC}: in-place fixture was incorrectly flagged as a replace"
    failures=$((failures + 1))
  else
    echo -e "${GREEN}PASS${NC}: in-place fixture correctly passed as safe"
  fi

  if detect_replace "$tmp/nochange.txt" >/dev/null; then
    echo -e "${RED}FAIL${NC}: no-change fixture was incorrectly flagged as a replace"
    failures=$((failures + 1))
  else
    echo -e "${GREEN}PASS${NC}: no-change fixture correctly passed as safe"
  fi

  echo
  if [ "$failures" -eq 0 ]; then
    echo -e "${GREEN}Self-test passed (3/3).${NC}"
    return 0
  else
    echo -e "${RED}Self-test FAILED ($failures assertion(s) failed).${NC}"
    return 1
  fi
}

if [ "${1:-}" = "--self-test" ]; then
  run_self_test
  exit $?
fi

if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
  cat <<'EOF'
check-no-replace.sh — pre-apply guardrail against silent EC2 instance replacement
(daatan#1194). Plans aws_instance.production + aws_instance.staging against the
prod backend and fails loudly if either would be replaced (destroyed + recreated)
rather than updated in place.

Usage:
  terraform/scripts/check-no-replace.sh              run the real guardrail
  terraform/scripts/check-no-replace.sh --self-test   run offline fixture tests
EOF
  exit 0
fi

# ---------------------------------------------------------------------------
# Real run: plan against the prod backend (both instances live in that state,
# see terraform/ec2.tf), targeted at just the two EC2 resources, and inspect
# the output before anyone is allowed to apply it.
# ---------------------------------------------------------------------------
command -v terraform >/dev/null 2>&1 || {
  echo -e "${RED}ERROR${NC}: terraform is not on PATH." >&2
  exit 1
}

cd "$TF_DIR"

PLAN_OUT="$(mktemp)"
trap 'rm -f "$PLAN_OUT"' EXIT

echo "Initializing prod backend..."
if ! terraform init -input=false -no-color -backend-config=backend-prod.hcl > "$PLAN_OUT" 2>&1; then
  echo -e "${RED}terraform init failed:${NC}"
  cat "$PLAN_OUT"
  exit 1
fi

echo "Planning aws_instance.production + aws_instance.staging against the prod backend..."
set +e
terraform plan \
  -input=false \
  -no-color \
  -var="environment=prod" \
  -target=aws_instance.production \
  -target=aws_instance.staging \
  -detailed-exitcode \
  > "$PLAN_OUT" 2>&1
PLAN_EXIT=$?
set -e

case "$PLAN_EXIT" in
  0)
    echo -e "${GREEN}No changes.${NC} Safe to apply."
    exit 0
    ;;
  1)
    echo -e "${RED}terraform plan errored:${NC}"
    cat "$PLAN_OUT"
    exit 1
    ;;
  2)
    if detect_replace "$PLAN_OUT" > "$PLAN_OUT.matches"; then
      echo -e "${RED}BLOCKED${NC}: this plan would REPLACE (destroy + recreate) one or both EC2 instances."
      echo "This is exactly the daatan#1194 failure mode — a locally-drifted tfvars value"
      echo "(most likely ssh_key_name, which is immutable on aws_instance) forcing a replace."
      echo
      echo "Matching lines:"
      cat "$PLAN_OUT.matches"
      echo
      echo "Full plan output: $PLAN_OUT"
      echo
      echo "Do NOT apply. Diff your local terraform.tfvars / prod.tfvars against"
      echo "terraform/terraform.tfvars.example and the live instance before proceeding."
      rm -f "$PLAN_OUT.matches"
      exit 1
    else
      echo -e "${YELLOW}Changes present, but no instance replacement detected.${NC} Safe to apply — review the plan below."
      echo
      cat "$PLAN_OUT"
      rm -f "$PLAN_OUT.matches" 2>/dev/null || true
      exit 0
    fi
    ;;
  *)
    echo -e "${RED}ERROR${NC}: unexpected terraform exit code $PLAN_EXIT"
    cat "$PLAN_OUT"
    exit 1
    ;;
esac
