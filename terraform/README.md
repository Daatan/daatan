# Terraform

Flat, single-environment layout: one set of `.tf` files, two backends (`backend-prod.hcl`,
`backend-staging.hcl`), variable overrides via `-var="environment=..."`. See `TECH.md` for
the full directory listing and the standard init/plan/apply commands.

## Before any `apply` touching `aws_instance.production` or `aws_instance.staging` — run the guardrail first

```bash
terraform/scripts/check-no-replace.sh
```

**Why:** `terraform/*.tfvars` (`prod.tfvars`, `staging.tfvars`, `terraform.tfvars`) are
gitignored — local-only, never seen in PR review, never checked by CI. `key_name` on both
EC2 instances (`terraform/ec2.tf`) is an **immutable** AWS attribute: if a local tfvars
value for `ssh_key_name` drifts from what the live instance actually has, the next
`terraform apply` that touches that resource silently plans a full **destroy + recreate**
of a live instance instead of an in-place update.

This already happened (daatan#1194): an abandoned local key-rotation attempt left
`ssh_key_name = "daatan-key-new"` in a local tfvars file while both live instances still
carried `daatan-key`. A routine `plan` came back `2 to add, 0 to change, 2 to destroy` for
**both** production and staging. Only `lifecycle.prevent_destroy` (already set on both
instances) stood between that plan and an outage — do not rely on catching this by eye.

`check-no-replace.sh` runs `terraform plan -target=aws_instance.production
-target=aws_instance.staging` against the prod backend (both instances are applied from
the prod state — see the comment on `aws_instance.staging` in `ec2.tf`) and fails loudly,
naming the affected instance(s), if the plan would replace either one. A pure in-place
change (e.g. a tag update) still passes. No changes still passes. It does not run `apply`
and does not touch any other resource.

```bash
# Self-test (no AWS access needed — exercises the parser against canned fixtures):
terraform/scripts/check-no-replace.sh --self-test
```

This is a manual pre-apply step, not a git hook: the files it protects against
(`*.tfvars`) are gitignored, so a commit-time hook would never see the drift that causes
the problem — the check only makes sense run immediately before `apply`, against whatever
tfvars happen to be on disk at that moment.

## Manual apply procedure (from `TECH.md`)

```bash
cd terraform

# Staging
terraform init -backend-config=backend-staging.hcl
terraform plan  -var="environment=staging"
terraform apply -var="environment=staging"

# Production — and ANY apply that could touch aws_instance.production/aws_instance.staging
terraform/scripts/check-no-replace.sh   # <-- run this first
terraform init -backend-config=backend-prod.hcl
terraform plan  -var="environment=prod"
terraform apply -var="environment=prod"
```
