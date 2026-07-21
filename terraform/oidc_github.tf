# GitHub Actions OIDC Federation
# Eliminates long-lived AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY in GitHub Secrets.
# GitHub Actions obtains short-lived credentials via AssumeRoleWithWebIdentity.

# The OIDC provider is an account-wide singleton (one per URL per account), now
# owned by the platform/foundation stack. Look it up rather than declaring it here
# — news-indexer does the same. See Daatan/platform foundation/oidc.tf.
data "aws_iam_openid_connect_provider" "github_actions" {
  url = "https://token.actions.githubusercontent.com"
}

# IAM Role assumed by GitHub Actions via OIDC
resource "aws_iam_role" "github_actions" {
  name = "daatan-github-actions-${var.environment}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Federated = data.aws_iam_openid_connect_provider.github_actions.arn
        }
        Action = "sts:AssumeRoleWithWebIdentity"
        # Pin trust to the immutable repository_id (survives org transfer /
        # rename). AWS still requires a sub condition, so we add an
        # owner-agnostic sub pattern on the repo name — case-proof regardless of
        # the org login's casing.
        Condition = {
          StringEquals = {
            "token.actions.githubusercontent.com:aud"           = "sts.amazonaws.com"
            "token.actions.githubusercontent.com:repository_id" = var.github_repository_id
          }
          StringLike = {
            "token.actions.githubusercontent.com:sub" = "repo:*/${split("/", var.github_repository)[1]}:*"
          }
        }
      }
    ]
  })

  tags = {
    Name = "daatan-github-actions-${var.environment}"
  }
}

# ECR permissions: push/pull images
resource "aws_iam_role_policy" "github_actions_ecr" {
  name = "daatan-github-ecr"
  role = aws_iam_role.github_actions.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "ecr:GetAuthorizationToken"
        ]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "ecr:BatchCheckLayerAvailability",
          "ecr:GetDownloadUrlForLayer",
          "ecr:BatchGetImage",
          "ecr:PutImage",
          "ecr:InitiateLayerUpload",
          "ecr:UploadLayerPart",
          "ecr:CompleteLayerUpload"
        ]
        Resource = aws_ecr_repository.daatan_app.arn
      }
    ]
  })
}

# SSM permissions: deploy via SendCommand
resource "aws_iam_role_policy" "github_actions_ssm" {
  name = "daatan-github-ssm"
  role = aws_iam_role.github_actions.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "ssm:SendCommand",
          "ssm:ListCommandInvocations",
          "ssm:DescribeInstanceInformation"
        ]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "ec2:DescribeInstances"
        ]
        Resource = "*"
      }
    ]
  })
}

# Cost Explorer (read-only) + the one SSM parameter it needs — for the daily
# AWS + OpenRouter spend report (.github/workflows/cost-report.yml). Cost Explorer
# has no resource-level permissions (Resource must be "*"); the SSM grant is scoped
# to exactly the one parameter the report reads, matching the narrow-scoping
# convention used elsewhere in this file and in iam_ssm.tf.
resource "aws_iam_role_policy" "github_actions_cost_report" {
  name = "daatan-github-cost-report"
  role = aws_iam_role.github_actions.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["ce:GetCostAndUsage"]
        Resource = "*"
      },
      {
        Effect   = "Allow"
        Action   = ["ssm:GetParameter"]
        Resource = "arn:aws:ssm:eu-central-1:${data.aws_caller_identity.current.account_id}:parameter/daatan/prod/secrets/OPENROUTER_API_KEY"
      },
      {
        # SecureString decryption with the AWS-managed aws/ssm key — same scoped
        # pattern as aws_iam_role_policy.app_secrets_read in secrets_ssm.tf.
        Effect   = "Allow"
        Action   = ["kms:Decrypt"]
        Resource = data.aws_kms_key.ssm.arn
        Condition = {
          StringEquals = {
            "kms:ViaService" = "ssm.eu-central-1.amazonaws.com"
          }
        }
      }
    ]
  })
}

output "github_actions_role_arn" {
  description = "ARN of the IAM role for GitHub Actions OIDC"
  value       = aws_iam_role.github_actions.arn
}
