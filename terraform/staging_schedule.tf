# --------------------------------------------------------------------
# Staging nightly backstop stop (#1526, #2089)
#
# Staging is normally off. Merges wake it through deploy.yml and it stops itself
# 20 minutes after the last deploy; staging-up.yml turns it on for manual use
# (.github/actions/staging-stop-timer sets both timers). This schedule only catches
# a box whose timer never fired: a failed timer, a manual start, a reboot. 03:00 UTC
# is late enough not to cut an evening session short.
#
# The EIP stays attached (and billed) so staging.daatan.com never changes.
#
# Lives in the PROD state next to aws_instance.staging (see ec2.tf). Applying
# it never touches the instance resource itself — the hard rule "never
# terraform apply aws_instance.staging" still holds; target these by name:
#   terraform apply -target=aws_scheduler_schedule.staging_stop \
#                   -target=aws_scheduler_schedule.staging_start \
#                   -target=aws_iam_role.staging_scheduler \
#                   -target=aws_iam_role_policy.staging_scheduler
# (staging_start is listed so that the apply destroys it; drop it afterwards.)
# --------------------------------------------------------------------

resource "aws_iam_role" "staging_scheduler" {
  name        = "daatan-staging-scheduler"
  description = "EventBridge Scheduler role: may only stop the staging EC2 instance"

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
      Action   = ["ec2:StopInstances"]
      Resource = aws_instance.staging.arn
    }]
  })
}

resource "aws_scheduler_schedule" "staging_stop" {
  name        = "daatan-staging-stop"
  description = "Backstop: stop staging at 03:00 UTC if its timer did not (#2089)"
  state       = "ENABLED"

  schedule_expression          = "cron(0 3 * * ? *)"
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
