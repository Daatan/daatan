variable "aws_region" {
  description = "AWS region for resources"
  type        = string
  default     = "eu-central-1"
}

variable "environment" {
  description = "Environment name (dev, staging, prod)"
  type        = string
  default     = "prod"
}

variable "domain_name" {
  description = "Primary domain name"
  type        = string
  default     = "daatan.com"
}

variable "ssh_key_name" {
  description = "Name of the SSH key pair in AWS (kept for EC2 bootstrap compatibility)"
  type        = string
  default     = "daatan-key"
}

variable "ec2_instance_type" {
  description = "EC2 instance type (staging)"
  type        = string
  default     = "t3.small"
}

# Split from ec2_instance_type so prod can grow without dragging staging along.
# Upsized t3.small -> t3.medium 2026-07-16 (#1133): 2 GB was too thin for
# app + postgres + nginx + certbot — see the 2026-05-05 OOM incident.
variable "ec2_instance_type_prod" {
  description = "EC2 instance type (production)"
  type        = string
  default     = "t3.medium"
}

variable "github_repository" {
  description = "GitHub repository (org/repo) for OIDC federation"
  type        = string
  default     = "Daatan/daatan"
}

# Immutable numeric repo id (stable across renames/owner transfers). The OIDC
# trust keys on this so a future transfer can't silently break CI again.
# Get it with: gh api repos/Daatan/daatan --jq .id
variable "github_repository_id" {
  description = "GitHub repository numeric id for OIDC federation"
  type        = string
  default     = "1134569638"
}
