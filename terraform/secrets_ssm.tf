# Per-item application secrets as SSM SecureStrings (docs/SECRETS.md).
#
# THE PROBLEM THIS SOLVES
#   `daatan-env-<env>` is a single plaintext Secrets Manager blob holding every credential
#   the app has, including the database password. Consequences:
#     - rotating one key means a read-modify-write of all of them;
#     - anything that needs one value gets GetSecretValue on everything;
#     - shared values (ORACLE_API_KEY, NEWS_INDEXER_SECRET) are COPIED into two or three
#       blobs, so a rotation must be applied in every copy or one side starts 401ing.
#   On 2026-07-10 exactly that happened: a stale OPENROUTER_API_KEY inside the blob made
#   every AI-panel call return 401 for weeks, unnoticed.
#
# WHY SSM AND NOT MORE SECRETS MANAGER
#   Secrets Manager bills ~$0.40/secret/month; splitting the blob into ~25 items would add
#   ~$10/month for nothing. SSM SecureString (standard tier) is free, KMS-encrypted, and
#   IAM-scopable per path. Reserve Secrets Manager for secrets needing managed rotation.
#
# ROTATION (no redeploy — the app's cache TTL is 5 minutes)
#   aws ssm put-parameter --name /daatan/staging/secrets/OPENROUTER_API_KEY \
#     --type SecureString --overwrite --cli-input-json file://value.json
#
# SCOPE
#   Only `var.environment`'s parameters are created here, so each state file owns its own
#   env. (Contrast aws_ssm_parameter.prompts, which creates BOTH envs from whichever state
#   runs — pre-existing dual ownership we are not extending.)

locals {
  # Secrets the app reads at runtime. Keep in sync with AWS_SECRET_NAMES in
  # src/lib/aws/secrets.ts. Migrate one at a time out of the daatan-env-* blob.
  app_secret_names = [
    "OPENROUTER_API_KEY",
  ]
}

resource "aws_ssm_parameter" "app_secrets" {
  for_each = toset(local.app_secret_names)

  name  = "/daatan/${var.environment}/secrets/${each.value}"
  type  = "SecureString"
  value = "PLACEHOLDER"

  description = "App secret ${each.value} (${var.environment}). Rotate with put-parameter --overwrite; the app picks it up within 5 minutes."

  tags = {
    Environment = var.environment
    Secret      = each.value
  }

  lifecycle {
    # Terraform creates the parameter; humans set the value. Never let an apply
    # overwrite a live credential with PLACEHOLDER.
    ignore_changes = [value]
  }
}

# Read + decrypt, scoped to this environment's secret path only. Staging cannot read
# prod's secrets and vice versa — the boundary that actually matters.
#
# Attached via the read-only role lookup (not aws_iam_role.ec2_role): the managed
# resource only resolves to whichever state you're applying from, and this policy needs
# both. See terraform/bedrock_invoke.tf for the same reasoning.
resource "aws_iam_role_policy" "app_secrets_read" {
  name = "daatan-app-secrets-read"
  role = data.aws_iam_role.app_ec2_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["ssm:GetParameter", "ssm:GetParameters"]
        Resource = "arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter/daatan/${var.environment}/secrets/*"
      },
      {
        # SecureString decryption with the AWS-managed aws/ssm key. Scoped to that key,
        # and further constrained to SSM as the calling service, so this grant cannot be
        # used to decrypt anything else in the account.
        Effect   = "Allow"
        Action   = ["kms:Decrypt"]
        Resource = data.aws_kms_key.ssm.arn
        Condition = {
          StringEquals = {
            "kms:ViaService" = "ssm.${var.aws_region}.amazonaws.com"
          }
        }
      }
    ]
  })
}

data "aws_kms_key" "ssm" {
  key_id = "alias/aws/ssm"
}
