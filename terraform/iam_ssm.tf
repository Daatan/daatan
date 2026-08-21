resource "aws_iam_role_policy_attachment" "ssm_policy" {
  role       = aws_iam_role.ec2_role.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

# Allow EC2 to read secrets (Env Vars + Deploy Key)
resource "aws_iam_role_policy" "secrets_access" {
  name = "daatan-secrets-access"
  role = aws_iam_role.ec2_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "secretsmanager:GetSecretValue",
          "secretsmanager:DescribeSecret"
        ]
        # This environment's secrets only. A hardcoded `daatan-env-staging` ARN used to
        # sit here, which let the PROD role read staging's env blob — no caller needs it
        # (fetch-secrets.sh reads `daatan-env-${ENVIRONMENT}`), and it widened prod's
        # blast radius for nothing. Removed 2026-07-10.
        Resource = [
          aws_secretsmanager_secret.env_vars.arn,
          aws_secretsmanager_secret.github_token.arn,
        ]
      }
    ]
  })
}


