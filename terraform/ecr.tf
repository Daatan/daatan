resource "aws_ecr_repository" "daatan_app" {
  name                 = "daatan-app"
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "AES256"
  }

  tags = {
    Name = "daatan-app"
  }
}

# Lifecycle policy to keep only recent images.
# NOTE: CI pushes version tags WITHOUT a "v" prefix (e.g. 1.65.199, 1.65.199-migrations,
# sha-<short>, staging-latest, pr-<n>). A previous "tagPrefixList = [\"v\"]" rule therefore
# matched nothing and the repo grew to 4,384 images / 1.3 TB (2026-08-20). Buildx pushes an
# image index whose untagged child manifests are never expired while the index lives, so the
# only rule that actually bounds storage is the tagStatus = "any" count rule below.
resource "aws_ecr_lifecycle_policy" "daatan_app_policy" {
  repository = aws_ecr_repository.daatan_app.name

  # An image belongs to the first rule (by priority) whose tag selection it
  # matches; lower-priority rules can't expire it. Every main merge pushes an
  # X.Y.Z image, so "last N version images" is only a day or two of history
  # (daatan#1959). deploy.yml adds release-X.Y.Z[-migrations] to what actually
  # shipped to prod; those are the rollback window. One pattern per rule:
  # entries within one tagPatternList are ANDed.
  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Keep the last 60 prod-released images (30 releases x app+migrations)"
        selection = {
          tagStatus      = "tagged"
          tagPatternList = ["release-*"]
          countType      = "imageCountMoreThan"
          countNumber    = 60
        }
        action = { type = "expire" }
      },
      {
        rulePriority = 2
        description  = "Expire PR preview images after 14 days"
        selection = {
          tagStatus     = "tagged"
          tagPrefixList = ["pr-"]
          countType     = "sinceImagePushed"
          countUnit     = "days"
          countNumber   = 14
        }
        action = { type = "expire" }
      },
      {
        rulePriority = 3
        description  = "Keep unreleased version images 7 days (tag-to-prod candidates)"
        selection = {
          tagStatus      = "tagged"
          tagPatternList = ["*.*.*"]
          countType      = "sinceImagePushed"
          countUnit      = "days"
          countNumber    = 7
        }
        action = { type = "expire" }
      },
      {
        rulePriority = 4
        description  = "Remove untagged images after 1 day"
        selection = {
          tagStatus   = "untagged"
          countType   = "sinceImagePushed"
          countUnit   = "days"
          countNumber = 1
        }
        action = { type = "expire" }
      },
      {
        rulePriority = 5
        description  = "Anything else (sha-only staging dispatch builds) after 14 days"
        selection = {
          tagStatus   = "any"
          countType   = "sinceImagePushed"
          countUnit   = "days"
          countNumber = 14
        }
        action = { type = "expire" }
      }
    ]
  })
}

# Output ECR repository URL
output "ecr_repository_url" {
  value       = aws_ecr_repository.daatan_app.repository_url
  description = "ECR repository URL for daatan-app"
}

output "ecr_registry" {
  value       = split("/", aws_ecr_repository.daatan_app.repository_url)[0]
  description = "ECR registry domain"
}
