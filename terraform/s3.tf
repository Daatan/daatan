# Get current AWS account ID
data "aws_caller_identity" "current" {}

# ====================================================================
# PRODUCTION DATABASE BACKUPS
# ====================================================================
# S3 Bucket for production database backups
# Bucket: daatan-db-backups-{account-id}
# Retention: 30 days for daily backups
resource "aws_s3_bucket" "backups" {
  bucket = "daatan-db-backups-${data.aws_caller_identity.current.account_id}"

  tags = {
    Name        = "daatan-db-backups-production"
    Environment = "production"
    Purpose     = "database-backup"
    Retention   = "30-days"
  }

  lifecycle {
    prevent_destroy = true
  }
}

# ====================================================================
# STAGING DATABASE BACKUPS
# ====================================================================
# S3 Bucket for staging database backups
# Bucket: daatan-db-backups-staging-{account-id}
# Retention: 14 days for daily backups
resource "aws_s3_bucket" "backups_staging" {
  bucket = "daatan-db-backups-staging-${data.aws_caller_identity.current.account_id}"

  tags = {
    Name        = "daatan-db-backups-staging"
    Environment = "staging"
    Purpose     = "database-backup"
    Retention   = "14-days"
  }

  lifecycle {
    prevent_destroy = true
  }
}

# Block public access (production)
resource "aws_s3_bucket_public_access_block" "backups" {
  bucket = aws_s3_bucket.backups.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Block public access (staging)
resource "aws_s3_bucket_public_access_block" "backups_staging" {
  bucket = aws_s3_bucket.backups_staging.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Enable versioning for backup history (production)
resource "aws_s3_bucket_versioning" "backups" {
  bucket = aws_s3_bucket.backups.id

  versioning_configuration {
    status = "Enabled"
  }
}

# Enable versioning for backup history (staging)
resource "aws_s3_bucket_versioning" "backups_staging" {
  bucket = aws_s3_bucket.backups_staging.id

  versioning_configuration {
    status = "Enabled"
  }
}

# Lifecycle rule to delete old backups (production)
resource "aws_s3_bucket_lifecycle_configuration" "backups" {
  bucket = aws_s3_bucket.backups.id

  rule {
    id     = "delete-old-backups"
    status = "Enabled"

    filter {
      prefix = "backups/"
    }

    expiration {
      days = 30
    }

    noncurrent_version_expiration {
      noncurrent_days = 7
    }
  }
}

# Lifecycle rule to delete old backups (staging)
resource "aws_s3_bucket_lifecycle_configuration" "backups_staging" {
  bucket = aws_s3_bucket.backups_staging.id

  rule {
    id     = "delete-old-backups"
    status = "Enabled"

    filter {
      prefix = "backups/"
    }

    expiration {
      days = 14
    }

    noncurrent_version_expiration {
      noncurrent_days = 7
    }
  }
}

# Server-side encryption (production)
resource "aws_s3_bucket_server_side_encryption_configuration" "backups" {
  bucket = aws_s3_bucket.backups.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# Server-side encryption (staging)
resource "aws_s3_bucket_server_side_encryption_configuration" "backups_staging" {
  bucket = aws_s3_bucket.backups_staging.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# ==========================================
# User Uploads Bucket (Avatars, etc.)
# Bucket: daatan-uploads-{env}-{account-id}
# ==========================================

resource "aws_s3_bucket" "uploads" {
  bucket = "daatan-uploads-${var.environment}-${data.aws_caller_identity.current.account_id}"

  tags = {
    Name        = "daatan-user-uploads-${var.environment}"
    Environment = var.environment
    Purpose     = "user-avatars-and-uploads"
  }
}

# Allow public read access for avatars
resource "aws_s3_bucket_public_access_block" "uploads" {
  bucket = aws_s3_bucket.uploads.id

  block_public_acls       = false
  block_public_policy     = false
  ignore_public_acls      = false
  restrict_public_buckets = false
}

resource "aws_s3_bucket_policy" "allow_public_read" {
  bucket = aws_s3_bucket.uploads.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "PublicReadGetObject"
        Effect    = "Allow"
        Principal = "*"
        Action    = "s3:GetObject"
        Resource  = "${aws_s3_bucket.uploads.arn}/*"
      }
    ]
  })
  depends_on = [aws_s3_bucket_public_access_block.uploads]
}

# CORS configuration to allow direct browser uploads/reads if needed later
resource "aws_s3_bucket_cors_configuration" "uploads" {
  bucket = aws_s3_bucket.uploads.id

  cors_rule {
    allowed_headers = ["*"]
    allowed_methods = ["GET", "PUT", "POST"]
    allowed_origins = ["https://daatan.com", "https://staging.daatan.com", "http://localhost:3000"]
    expose_headers  = ["ETag"]
    max_age_seconds = 3000
  }
}

# Server-side encryption
resource "aws_s3_bucket_server_side_encryption_configuration" "uploads" {
  bucket = aws_s3_bucket.uploads.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# IAM role for EC2 instances to access S3 backups and uploads
# Used by both production and staging instances
resource "aws_iam_role" "ec2_role" {
  name = "daatan-ec2-role-${var.environment}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "ec2.amazonaws.com"
        }
      }
    ]
  })

  tags = {
    Name        = "daatan-ec2-s3-access-${var.environment}"
    Environment = var.environment
    Purpose     = "s3-backup-access"
  }
}

# IAM policy for S3 access (Backups and Uploads)
resource "aws_iam_role_policy" "ec2_s3_policy" {
  name = "daatan-s3-access-policy"
  role = aws_iam_role.ec2_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "s3:PutObject",
          "s3:GetObject",
          "s3:ListBucket",
          "s3:DeleteObject"
        ]
        Resource = [
          aws_s3_bucket.backups.arn,
          "${aws_s3_bucket.backups.arn}/*",
          aws_s3_bucket.backups_staging.arn,
          "${aws_s3_bucket.backups_staging.arn}/*",
          aws_s3_bucket.uploads.arn,
          "${aws_s3_bucket.uploads.arn}/*"
        ]
      }
    ]
  })
}

# Instance profile to attach role to EC2
resource "aws_iam_instance_profile" "ec2_profile" {
  name = "daatan-ec2-profile-${var.environment}"
  role = aws_iam_role.ec2_role.name
}

