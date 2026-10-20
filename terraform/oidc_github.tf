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
        # rename), plus an owner-agnostic sub pattern on the repo name — case-proof
        # regardless of the org login's casing.
        #
        # sub is limited to the two contexts that legitimately need AWS (platform#34):
        #  - main: scheduled/dispatched workflows on the default branch, and the
        #    main-branch image build + staging deploy in deploy.yml
        #  - environment:production: deploy.yml's deploy-production job (v* tags
        #    and production dispatches)
        # Feature branches, PRs and other tags get no credentials, so pushing a
        # branch with a modified workflow can no longer reach the servers.
        Condition = {
          StringEquals = {
            "token.actions.githubusercontent.com:aud"           = "sts.amazonaws.com"
            "token.actions.githubusercontent.com:repository_id" = var.github_repository_id
          }
          StringLike = {
            "token.actions.githubusercontent.com:sub" = [
              "repo:*/${split("/", var.github_repository)[1]}:ref:refs/heads/main",
              "repo:*/${split("/", var.github_repository)[1]}:environment:production",
            ]
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
          # rollback.yml lists/checks version tags with describe-images
          "ecr:DescribeImages",
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
        # SendCommand is authorized on both the document and the target instance,
        # so listing them here limits CI to running shell commands on these hosts
        # only (platform#34; it was Resource "*": any instance, any document).
        Sid    = "SendCommandToKnownHosts"
        Effect = "Allow"
        Action = ["ssm:SendCommand"]
        Resource = [
          "arn:aws:ssm:eu-central-1::document/AWS-RunShellScript",
          aws_instance.production.arn,
          aws_instance.staging.arn,
          # oracle-jev-watchdog.yml reads the Oracul box's logs
          "arn:aws:ec2:eu-central-1:${data.aws_caller_identity.current.account_id}:instance/${var.oracle_instance_id}",
        ]
      },
      {
        # No resource-level permissions for these (read-only).
        Effect = "Allow"
        Action = [
          "ssm:ListCommandInvocations",
          "ssm:GetCommandInvocation",
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
      },
      {
        # deploy.yml / rollback.yml wake staging when a run lands inside its
        # scheduled sleep window (staging_schedule.tf, #1526). Start only,
        # staging only — prod is never started/stopped from CI.
        Sid      = "WakeStaging"
        Effect   = "Allow"
        Action   = ["ec2:StartInstances"]
        Resource = aws_instance.staging.arn
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
        # Promotional credit balance, for the runway line in the same report
        # (#1346). Like Cost Explorer, the Billing API has no resource-level
        # permissions. Read-only: GetCredits cannot modify anything.
        #
        # This grant is the whole point of shipping the IAM change alongside the
        # workflow: the role has now twice been found one API call short only
        # after a report shipped and silently measured nothing in CI while
        # passing a local dry-run (ssm:GetCommandInvocation in #1274,
        # ce:GetDimensionValues in #1275). Dispatch and read the output before
        # merging anything that depends on a new action here.
        Effect   = "Allow"
        Action   = ["billing:GetCredits"]
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

# CloudWatch (read-only) — for the weekly model-usage audit
# (.github/workflows/model-audit-weekly.yml, daatan#1429/#1431). Neither
# ListMetrics nor GetMetricStatistics support resource-level ARNs (both
# require Resource="*"), same as ce:GetCostAndUsage below. A cloudwatch:namespace
# condition was tried first for least-privilege scoping — the IAM policy
# simulator confirmed it as "allowed", but live enforcement still returned
# AccessDenied on ListMetrics (caught via a real workflow_dispatch run, not
# the simulator): the service does not actually honor that condition key for
# this action despite AWS's own simulator suggesting otherwise. Dropped —
# same unconditioned Resource="*" as every other CloudWatch/CE grant here.
resource "aws_iam_role_policy" "github_actions_model_audit" {
  name = "daatan-github-model-audit"
  role = aws_iam_role.github_actions.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["cloudwatch:ListMetrics", "cloudwatch:GetMetricStatistics"]
        Resource = "*"
      }
    ]
  })
}

output "github_actions_role_arn" {
  description = "ARN of the IAM role for GitHub Actions OIDC"
  value       = aws_iam_role.github_actions.arn
}
