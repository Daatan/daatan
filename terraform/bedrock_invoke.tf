# Bedrock model invocation for the AI panel (docs/LASSO.md).
#
# Separate from `aws_iam_role_policy.bedrock_prompts` on purpose: reading a prompt
# template and invoking a model are different privileges with different blast radii,
# so this grant can be applied, reviewed, or revoked with `-target` without touching
# prompt access.
#
# WHY THIS EXISTS
#   Without a Bedrock member, all panel members run through OpenRouter and the feature
#   is hostage to one third-party credential — which is exactly how it failed on
#   2026-07-10 (a dead key, 401 on every call). Since v1.45.0 the roster's Qwen member
#   runs on Bedrock: `qwen.qwen3-235b-a22b-2507-v1:0` is the same model as OpenRouter's
#   `qwen/qwen3-235b-a22b-2507`, runs on the account's own credentials (i.e. AWS
#   credits), and is the roster's only non-reasoning member — so it carries none of the
#   hidden-token cost risk the other four do.
#
# WHY A DATA SOURCE, NOT `aws_iam_role.ec2_role`
#   Both backends now own their own `aws_iam_role.ec2_role` (confirmed via `terraform
#   state list` 2026-08-09 — staging has owned it since 2026-07-27, closing the
#   "unmanaged staging role" half of #1142). But `aws_iam_role.ec2_role` still only
#   resolves to *whichever state you're currently applying from* — referencing the
#   managed resource here would grant only that one environment, silently skipping the
#   other, since this policy needs to be applied to both. Looking the role up by name
#   grants whichever environment the config is applied for, regardless of which
#   backend's `ec2_role` happens to be in scope.
#
#   NOTE: `var.environment` defaults to "prod". Applying this from the staging state
#   WITHOUT `-var environment=staging` would attach the policy to the *prod* role from
#   the staging state file. Always pass the var explicitly. See the runbook below.
#
# SCOPE
#   Deliberately not `Resource = "*"`. Only models the panel roster actually names may be
#   invoked; adding a Bedrock member means adding its id here — a reviewable diff rather
#   than a silent capability.
#
#   `bedrock:InvokeModel` only, not `InvokeModelWithResponseStream`: the panel client is
#   non-streaming (one integer, `max_tokens: 64`), so streaming is withheld.
#
# MODEL ARN SHAPE
#   Foundation-model ARNs carry no account id.
#   Verified `inferenceTypesSupported = ["ON_DEMAND"]` for this model in eu-central-1,
#   so it is invocable directly and needs no inference-profile ARN.
#
# RUNBOOK (never a blanket apply)
#   Staging first:
#     terraform init -reconfigure -backend-config=backend-staging.hcl
#     terraform plan  -var environment=staging -target=aws_iam_role_policy.bedrock_invoke_panel
#     terraform apply -var environment=staging -target=aws_iam_role_policy.bedrock_invoke_panel
#   Then prod:
#     terraform init -reconfigure -backend-config=backend-prod.hcl
#     terraform plan  -target=aws_iam_role_policy.bedrock_invoke_panel
#     terraform apply -target=aws_iam_role_policy.bedrock_invoke_panel

locals {
  # Bedrock model ids invocable by the AI panel. Keep in sync with the `route: 'bedrock'`
  # entries in src/lib/llm/panel/roster.ts.
  panel_bedrock_model_ids = [
    "qwen.qwen3-235b-a22b-2507-v1:0",
  ]
}

# Read-only lookup. Both roles are Terraform-managed today (each in its own state), but
# this stays a data source rather than a resource reference — see the comment above.
data "aws_iam_role" "app_ec2_role" {
  name = "daatan-ec2-role-${var.environment}"
}

resource "aws_iam_role_policy" "bedrock_invoke_panel" {
  name = "daatan-bedrock-invoke-panel"
  role = data.aws_iam_role.app_ec2_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = ["bedrock:InvokeModel"]
        Resource = [
          for model_id in local.panel_bedrock_model_ids :
          "arn:aws:bedrock:${var.aws_region}::foundation-model/${model_id}"
        ]
      }
    ]
  })
}
