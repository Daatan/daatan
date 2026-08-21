# --------------------------------------------------------------------
# Staging off-hours sleep (#1526)
#
# Staging idles at ~2% CPU 24/7. Two EventBridge Scheduler schedules stop it
# at 20:00 UTC and start it at 06:00 UTC on weekdays; the Friday stop and the
# Monday start cover the weekend. ~60% of staging compute (~$9–10/mo).
#
# The EIP stays attached (and billed) so staging.daatan.com never changes.
# deploy.yml / rollback.yml wake the box before sending SSM commands, so a
# merge outside the window still deploys, just ~90 s slower. watchdog.yml
# skips staging probes during the sleep window.
#
# Lives in the PROD state next to aws_instance.staging (see ec2.tf). Applying
# it never touches the instance resource itself — the hard rule "never
# terraform apply aws_instance.staging" still holds; target these by name:
#   terraform apply -target=aws_scheduler_schedule.staging_stop \
#                   -target=aws_scheduler_schedule.staging_start \
#                   -target=aws_iam_role.staging_scheduler \
#                   -target=aws_iam_role_policy.staging_scheduler
# --------------------------------------------------------------------

resource "aws_iam_role" "staging_scheduler" {
  name        = "daatan-staging-scheduler"
  description = "EventBridge Scheduler role: may only start/stop the staging EC2 instance"

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

resource "aws_iam_role_policy" "staging_scheduler" {
  name = "daatan-staging-scheduler"
  role = aws_iam_role.staging_scheduler.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["ec2:StartInstances", "ec2:StopInstances"]
      Resource = aws_instance.staging.arn
    }]
  })
}

resource "aws_scheduler_schedule" "staging_stop" {
  name        = "daatan-staging-stop"
  description = "Stop staging at 20:00 UTC on weekdays (#1526)"
  state       = "ENABLED"

  schedule_expression          = "cron(0 20 ? * MON-FRI *)"
  schedule_expression_timezone = "UTC"

  flexible_time_window {
    mode = "OFF"
  }

  target {
    arn      = "arn:aws:scheduler:::aws-sdk:ec2:stopInstances"
    role_arn = aws_iam_role.staging_scheduler.arn
    input    = jsonencode({ InstanceIds = [aws_instance.staging.id] })
  }
}

resource "aws_scheduler_schedule" "staging_start" {
  name        = "daatan-staging-start"
  description = "Start staging at 06:00 UTC on weekdays (#1526)"
  state       = "ENABLED"

  schedule_expression          = "cron(0 6 ? * MON-FRI *)"
  schedule_expression_timezone = "UTC"

  flexible_time_window {
    mode = "OFF"
  }

  target {
    arn      = "arn:aws:scheduler:::aws-sdk:ec2:startInstances"
    role_arn = aws_iam_role.staging_scheduler.arn
    input    = jsonencode({ InstanceIds = [aws_instance.staging.id] })
  }
}
