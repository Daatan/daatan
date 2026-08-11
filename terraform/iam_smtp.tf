# ====================================================================
# IAM USERS FOR SES SMTP (Gmail Sending)
# ====================================================================

# 1. IAM User for Mark
resource "aws_iam_user" "smtp_mark" {
  name = "ses-smtp-mark-${var.environment}"
}

resource "aws_iam_access_key" "smtp_mark" {
  user = aws_iam_user.smtp_mark.name
}

resource "aws_iam_user_policy" "smtp_mark" {
  name = "ses-send-policy"
  user = aws_iam_user.smtp_mark.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = "ses:SendRawEmail"
        Resource = "*"
      }
    ]
  })
}

# 2. IAM User for Andrey
# No aws_iam_access_key resource here (deliberately): the SMTP key is rotated
# out-of-band via scripts/rotate-ses-smtp-credentials.sh (docs/EMAIL.md), so a
# Terraform-managed key drifts out of state on every rotation and can never be
# re-imported (AWS only returns the secret once, at creation) — daatan#1428.
resource "aws_iam_user" "smtp_andrey" {
  name = "ses-smtp-andrey-${var.environment}"
}

resource "aws_iam_user_policy" "smtp_andrey" {
  name = "ses-send-policy"
  user = aws_iam_user.smtp_andrey.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = "ses:SendRawEmail"
        Resource = "*"
      }
    ]
  })
}

# ====================================================================
# OUTPUTS FOR GMAIL SETUP
# ====================================================================

output "smtp_endpoint" {
  value = "email-smtp.${var.aws_region}.amazonaws.com"
}

output "smtp_username_mark" {
  value = aws_iam_access_key.smtp_mark.id
}

output "smtp_password_mark" {
  value     = aws_iam_access_key.smtp_mark.ses_smtp_password_v4
  sensitive = true
}

