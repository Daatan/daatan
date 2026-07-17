# Get latest Ubuntu 24.04 AMI
data "aws_ami" "ubuntu" {
  most_recent = true
  owners      = ["099720109477"] # Canonical

  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-amd64-server-*"]
  }

  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}

# ====================================================================
# PRODUCTION INSTANCE (daatan.com)
# ====================================================================
# t3.medium instance for production workloads (upsized from t3.small, #1133)
# Hosts daatan-app (production) + daatan-postgres (production DB)
# DNS: daatan.com, www.daatan.com
resource "aws_instance" "production" {
  ami                         = data.aws_ami.ubuntu.id
  instance_type               = var.ec2_instance_type_prod
  key_name                    = var.ssh_key_name
  subnet_id                   = aws_subnet.public_a.id
  vpc_security_group_ids      = [aws_security_group.ec2.id]
  iam_instance_profile        = aws_iam_instance_profile.ec2_profile.name
  associate_public_ip_address = true

  root_block_device {
    volume_size           = 40
    volume_type           = "gp3"
    delete_on_termination = true
    encrypted             = true
  }

  user_data = <<-EOF
    #!/bin/bash
    set -e
    exec > >(tee /var/log/user-data.log|logger -t user-data -s 2>/dev/console) 2>&1

    # Update system
    apt-get update
    apt-get upgrade -y
    apt-get install -y ca-certificates curl gnupg unzip jq git

    # Install Docker
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    chmod a+r /etc/apt/keyrings/docker.gpg

    echo \
      "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
      $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
      tee /etc/apt/sources.list.d/docker.list > /dev/null

    apt-get update
    apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

    # Install AWS CLI
    curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
    unzip -q awscliv2.zip
    ./aws/install
    rm -rf aws awscliv2.zip

    # Add ubuntu user to docker group
    usermod -aG docker ubuntu

    # Enable Docker service
    systemctl enable docker
    systemctl start docker

    # --- Zero Touch Setup ---

    # 1. Setup App Directory
    mkdir -p /home/ubuntu/app
    chown ubuntu:ubuntu /home/ubuntu/app
    
    # 2. Retrieve Secrets
    REGION="${var.aws_region}"
    SECRET_ENV_Name="${aws_secretsmanager_secret.env_vars.name}"

    # Get GitHub Token for HTTPS clone
    GITHUB_TOKEN=$(aws secretsmanager get-secret-value --region "$REGION" --secret-id "${aws_secretsmanager_secret.github_token.name}" --query SecretString --output text) || { echo "Failed to retrieve GitHub token"; exit 1; }

    # 3. Clone Repository
    if [ ! -d "/home/ubuntu/app/.git" ]; then
        sudo -u ubuntu git clone "https://x-access-token:$GITHUB_TOKEN@github.com/Daatan/daatan.git" /home/ubuntu/app || echo "Repo clone failed"
    else
        echo "Repo already exists"
    fi

    # 4. Retrieve .env (NOW, after clone)
    if aws secretsmanager get-secret-value --region "$REGION" --secret-id "$SECRET_ENV_Name" --query SecretString --output text > /home/ubuntu/app/.env; then
        chown ubuntu:ubuntu /home/ubuntu/app/.env
        chmod 600 /home/ubuntu/app/.env
    else
        echo "Failed to retrieve .env — aborting setup"
        exit 1
    fi

    # 5. Start Application
    cd /home/ubuntu/app
    # Only start if docker-compose.prod.yml exists (meaning clone was successful)
    if [ -f "docker-compose.prod.yml" ]; then
      docker compose -f docker-compose.prod.yml up -d
      
      # Wait for containers to be ready
      sleep 20
      
      # Run migrations
      if docker ps | grep -q daatan-app-staging; then
        echo "Running staging migrations..."
        docker exec daatan-app-staging node node_modules/prisma/build/index.js migrate deploy || echo "Staging migration failed"
      fi
      
      if docker ps | grep -q daatan-app; then
        echo "Running production migrations..."
        docker exec daatan-app node node_modules/prisma/build/index.js migrate deploy || echo "Production migration failed"
      fi
      
      echo "Application started and migrations applied!"
    else
      echo "docker-compose.prod.yml not found. Is the repo cloned? check /var/log/user-data.log"
    fi

    # 5. Setup Database Backups
    # Write S3 bucket name to config file
    echo "${aws_s3_bucket.backups.bucket}" > /home/ubuntu/.s3_bucket

    # Create backup script
    cat > /home/ubuntu/backup-db.sh << 'BACKUP'
#!/bin/bash
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="/home/ubuntu/backups/daatan_$TIMESTAMP.sql.gz"
S3_BUCKET=$(cat /home/ubuntu/.s3_bucket)

# Dump database
# Only run if container is running
if docker ps | grep -q daatan-postgres; then
  docker exec daatan-postgres pg_dump -U daatan daatan | gzip > "$BACKUP_FILE"
  
  # Upload to S3
  aws s3 cp "$BACKUP_FILE" "s3://$S3_BUCKET/daily/"
  
  # Keep only last 3 local backups
  ls -t /home/ubuntu/backups/*.sql.gz | tail -n +4 | xargs -r rm
  
  echo "Backup completed: $BACKUP_FILE"
else
  echo "Postgres container not running. Skipping backup."
fi
BACKUP

    chmod +x /home/ubuntu/backup-db.sh
    chown ubuntu:ubuntu /home/ubuntu/backup-db.sh
    mkdir -p /home/ubuntu/backups
    chown ubuntu:ubuntu /home/ubuntu/backups

    # Setup daily backup cron (3 AM)
    echo "0 3 * * * ubuntu /home/ubuntu/backup-db.sh >> /home/ubuntu/backups/backup.log 2>&1" > /etc/cron.d/daatan-backup
    chmod 644 /etc/cron.d/daatan-backup

    echo "Setup complete!" > /home/ubuntu/setup-complete.txt
  EOF

  user_data_replace_on_change = false

  tags = {
    Name        = "daatan-backend"
    Environment = "prod"
    Project     = "daatan"
    ManagedBy   = "terraform"
  }

  lifecycle {
    ignore_changes  = [ami, user_data]
    prevent_destroy = true
  }
}

# Elastic IP for production instance
resource "aws_eip" "production" {
  instance = aws_instance.production.id
  domain   = "vpc"

  tags = {
    Name = "daatan-production-eip"
  }

  lifecycle {
    prevent_destroy = true
  }
}

# ====================================================================
# STAGING INSTANCE (staging.daatan.com)
# ====================================================================
# t3.small instance for staging workloads
# Hosts daatan-app-staging (staging) + daatan-postgres-staging (staging DB)
# DNS: staging.daatan.com
resource "aws_instance" "staging" {
  ami                    = data.aws_ami.ubuntu.id
  instance_type          = var.ec2_instance_type
  key_name               = var.ssh_key_name
  subnet_id              = aws_subnet.public_a.id
  vpc_security_group_ids = [aws_security_group.ec2.id]
  # LITERAL, not aws_iam_instance_profile.ec2_profile.name: this instance lives in the
  # PROD state (applied with environment=prod), so the env-interpolated resource renders
  # daatan-ec2-profile-prod here — applying that puts the prod IAM role on the staging
  # box and lets it read prod secrets (the 2026-07-12 incident; #1142). The staging
  # role/profile are managed from the staging state; this box must always wear them.
  iam_instance_profile        = "daatan-ec2-profile-staging"
  associate_public_ip_address = true

  root_block_device {
    volume_size           = 40
    volume_type           = "gp3"
    delete_on_termination = true
    encrypted             = true
  }

  user_data = <<-EOF
    #!/bin/bash
    set -e
    exec > >(tee /var/log/user-data.log|logger -t user-data -s 2>/dev/console) 2>&1

    # Update system
    apt-get update
    apt-get upgrade -y
    apt-get install -y ca-certificates curl gnupg unzip jq git

    # Install Docker
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    chmod a+r /etc/apt/keyrings/docker.gpg

    echo \
      "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
      $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
      tee /etc/apt/sources.list.d/docker.list > /dev/null

    apt-get update
    apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

    # Install AWS CLI
    curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
    unzip -q awscliv2.zip
    ./aws/install
    rm -rf aws awscliv2.zip

    # Add ubuntu user to docker group
    usermod -aG docker ubuntu

    # Enable Docker service
    systemctl enable docker
    systemctl start docker

    # --- Zero Touch Setup ---

    # 1. Setup App Directory
    mkdir -p /home/ubuntu/app
    chown ubuntu:ubuntu /home/ubuntu/app

    # 2. Retrieve Secrets
    REGION="${var.aws_region}"
    SECRET_ENV_Name="${aws_secretsmanager_secret.env_vars.name}"

    # Get GitHub Token for HTTPS clone
    GITHUB_TOKEN=$(aws secretsmanager get-secret-value --region "$REGION" --secret-id "${aws_secretsmanager_secret.github_token.name}" --query SecretString --output text) || { echo "Failed to retrieve GitHub token"; exit 1; }

    # 3. Clone Repository
    if [ ! -d "/home/ubuntu/app/.git" ]; then
        sudo -u ubuntu git clone "https://x-access-token:$GITHUB_TOKEN@github.com/Daatan/daatan.git" /home/ubuntu/app || echo "Repo clone failed"
    else
        echo "Repo already exists"
    fi

    # 4. Retrieve .env (NOW, after clone)
    if aws secretsmanager get-secret-value --region "$REGION" --secret-id "$SECRET_ENV_Name" --query SecretString --output text > /home/ubuntu/app/.env; then
        chown ubuntu:ubuntu /home/ubuntu/app/.env
        chmod 600 /home/ubuntu/app/.env
    else
        echo "Failed to retrieve .env — aborting setup"
        exit 1
    fi

    # 5. Start Application
    cd /home/ubuntu/app
    if [ -f "docker-compose.prod.yml" ]; then
      docker compose -f docker-compose.prod.yml up -d

      # Wait for containers to be ready
      sleep 20

      # Run migrations
      if docker ps | grep -q daatan-app-staging; then
        echo "Running staging migrations..."
        docker exec daatan-app-staging node node_modules/prisma/build/index.js migrate deploy || echo "Staging migration failed"
      fi

      echo "Staging started and migrations applied!"
    else
      echo "docker-compose.prod.yml not found. Is the repo cloned? check /var/log/user-data.log"
    fi

    # 6. Setup Database Backups (for staging DB)
    echo "${aws_s3_bucket.backups_staging.bucket}" > /home/ubuntu/.s3_bucket

    # Create backup script
    cat > /home/ubuntu/backup-db.sh << 'BACKUP'
#!/bin/bash
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="/home/ubuntu/backups/daatan_staging_$TIMESTAMP.sql.gz"
S3_BUCKET=$(cat /home/ubuntu/.s3_bucket)

if docker ps | grep -q daatan-postgres-staging; then
  docker exec daatan-postgres-staging pg_dump -U daatan daatan_staging | gzip > "$BACKUP_FILE"
  aws s3 cp "$BACKUP_FILE" "s3://$S3_BUCKET/daily/"
  ls -t /home/ubuntu/backups/*.sql.gz | tail -n +4 | xargs -r rm
  echo "Backup completed: $BACKUP_FILE"
else
  echo "Postgres staging container not running. Skipping backup."
fi
BACKUP

    chmod +x /home/ubuntu/backup-db.sh
    chown ubuntu:ubuntu /home/ubuntu/backup-db.sh
    mkdir -p /home/ubuntu/backups
    chown ubuntu:ubuntu /home/ubuntu/backups

    # Setup daily backup cron (3 AM)
    echo "0 3 * * * ubuntu /home/ubuntu/backup-db.sh >> /home/ubuntu/backups/backup.log 2>&1" > /etc/cron.d/daatan-backup
    chmod 644 /etc/cron.d/daatan-backup

    echo "Staging setup complete!" > /home/ubuntu/setup-complete.txt
  EOF

  user_data_replace_on_change = false

  tags = {
    Name        = "daatan-backend"
    Environment = "staging"
    Project     = "daatan"
    ManagedBy   = "terraform"
  }

  lifecycle {
    ignore_changes  = [ami, user_data]
    prevent_destroy = true
  }
}

# Elastic IP for staging instance
resource "aws_eip" "staging" {
  instance = aws_instance.staging.id
  domain   = "vpc"

  tags = {
    Name = "daatan-staging-eip"
  }

  lifecycle {
    prevent_destroy = true
  }
}
