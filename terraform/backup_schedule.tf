# --------------------------------------------------------------------
# Prod DB backup schedule (#1957)
#
# EventBridge Scheduler sends an SSM Run Command (AWS-RunShellScript) to the
# prod instance at 04:00 and 16:00 UTC. The command runs the copies of
# scripts/backup-db.sh and scripts/verify-backup.sh that deploy.yml ships to
# ~/app/scripts on every production deploy, so the box must have had a prod
# deploy that includes them before this schedule is applied.
#
# The GitHub cron in .github/workflows/backup.yml stays on as a fallback for a
# transition period. Both triggers take the same box-side flock
# (/var/lock/daatan-db-backup.lock): whichever comes second exits 0 with
# BACKUP_SKIPPED / VERIFY_SKIPPED. Failure alerts on this path come from the
# scripts themselves (Telegram, credentials from ~/app/.env); the watchdog's
# backup freshness check (watchdog.yml) catches a schedule that never fires.
#
# Lives in the PROD state next to aws_instance.production. Target by name:
#   terraform apply -target=aws_iam_role.backup_scheduler \
#                   -target=aws_iam_role_policy.backup_scheduler \
#                   -target=aws_scheduler_schedule.db_backup \
#                   -target=aws_iam_role_policy.github_actions_backup_freshness
# --------------------------------------------------------------------

resource "aws_iam_role" "backup_scheduler" {
  name        = "daatan-backup-scheduler"
  description = "EventBridge Scheduler role: may only send AWS-RunShellScript to the prod instance (DB backup)"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "scheduler.amazonaws.com" }
      Action    = "sts:AssumeRole"
      Condition = {
        StringEquals = { "aws:SourceAccount" = data.aws_caller_identity.current.account_id }
      }
    }]
  })
}

resource "aws_iam_role_policy" "backup_scheduler" {
  name = "daatan-backup-scheduler"
  role = aws_iam_role.backup_scheduler.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      # SendCommand is authorized on both the document and the target
      # instance; listing exactly these two limits the role to this one box.
      Effect = "Allow"
      Action = ["ssm:SendCommand"]
      Resource = [
        "arn:aws:ssm:eu-central-1::document/AWS-RunShellScript",
        aws_instance.production.arn,
      ]
    }]
  })
}

resource "aws_scheduler_schedule" "db_backup" {
  name        = "daatan-prod-db-backup"
  description = "Prod DB backup + restore verification via SSM at 04:00 and 16:00 UTC (#1957)"
  state       = "ENABLED"

  schedule_expression          = "cron(0 4,16 * * ? *)"
  schedule_expression_timezone = "UTC"

  flexible_time_window {
    mode = "OFF"
  }

  target {
    arn      = "arn:aws:scheduler:::aws-sdk:ssm:sendCommand"
    role_arn = aws_iam_role.backup_scheduler.arn

    input = jsonencode({
      DocumentName = "AWS-RunShellScript"
      InstanceIds  = [aws_instance.production.id]
      Comment      = "Scheduled DB backup (EventBridge, #1957)"
      Parameters = {
        # On-box limit: backup ~10 min + restore verification up to ~20 min.
        executionTimeout = ["2700"]
        commands = [
          "set -e",
          # Same environment as deploy.yml's SSM steps; HOME also lets the
          # scripts read Telegram credentials from ~/app/.env for alerts.
          "export HOME=/home/ubuntu",
          "export PATH=$PATH:/usr/local/bin:/usr/bin",
          "cd /home/ubuntu/app",
          # Run private copies so a deploy rewriting ~/app/scripts mid-run
          # can't change a script bash is still reading.
          "RUN_DIR=$(mktemp -d)",
          "trap 'rm -rf \"$RUN_DIR\"' EXIT",
          "cp scripts/backup-db.sh scripts/verify-backup.sh \"$RUN_DIR\"/",
          "BACKUP_ALERT_ON_FAILURE=1 bash \"$RUN_DIR/backup-db.sh\"",
          "bash \"$RUN_DIR/verify-backup.sh\"",
        ]
      }
    })

    retry_policy {
      # SendCommand either reaches SSM or it doesn't; one retry covers a
      # transient API error without risking a pile-up of backups.
      maximum_retry_attempts       = 1
      maximum_event_age_in_seconds = 3600
    }
  }
}
