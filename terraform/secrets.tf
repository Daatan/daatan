# Secrets for Environment Variables (.env)
resource "aws_secretsmanager_secret" "env_vars" {
  name        = "daatan-env-${var.environment}"
  description = "Environment variables for DAATAN ${var.environment} environment"

  # Allow deletion without recovery window for easier cleanup in dev/staging
  recovery_window_in_days = var.environment == "prod" ? 30 : 0

  tags = {
    Name = "daatan-env-${var.environment}"
  }
}

resource "aws_secretsmanager_secret_version" "env_vars" {
  secret_id     = aws_secretsmanager_secret.env_vars.id
  secret_string = "Please update this manually in AWS Console with real .env content"

  lifecycle {
    ignore_changes = [secret_string] # Prevent Terraform from overwriting manual updates
  }
}

# `daatan-deploy-key-<env>` (SSH deploy key) was removed 2026-08-21 (Daatan/docs#122):
# ec2.tf user_data clones over HTTPS with `daatan-github-token`, CI deploys via
# OIDC + SSM, and CloudTrail showed zero GetSecretValue on either key in 90 days.
# The secrets were `state rm`'d and scheduled for deletion with a 30-day window.

# GitHub Token for HTTPS clone (replaces SSH deploy key approach)
# Store a GitHub PAT with repo read access in AWS Console after applying
resource "aws_secretsmanager_secret" "github_token" {
  name        = "daatan-github-token"
  description = "GitHub Personal Access Token for cloning the daatan repo via HTTPS"

  recovery_window_in_days = 0

  tags = {
    Name = "daatan-github-token"
  }
}

resource "aws_secretsmanager_secret_version" "github_token" {
  secret_id     = aws_secretsmanager_secret.github_token.id
  secret_string = "Please update this manually with a GitHub PAT (repo read scope)"

  lifecycle {
    ignore_changes = [secret_string]
  }
}
