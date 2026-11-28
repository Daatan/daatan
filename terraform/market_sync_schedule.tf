# --------------------------------------------------------------------
# Hourly linked-market price sync (daatan#2325)
#
# EventBridge Scheduler sends an SSM Run Command (AWS-RunShellScript) to the
# prod instance every hour at :47 UTC. The command calls the box's own public
# /api/cron/external-market-sync with the x-cron-secret it reads from
# ~/app/.env, so the secret never enters Terraform or its state. It reuses
# aws_iam_role.backup_scheduler (backup_schedule.tf), whose policy already
# allows exactly ssm:SendCommand of AWS-RunShellScript on this instance.
#
# Why not GitHub cron: external-market-sync.yml's hourly schedule ran 2–3
# times a day (2026-11-16 → 11-26), so linked prices and the
# Commitment.polymarketPrice snapshot could be ~8–12 h old. The DB backups
# left GitHub cron for the same reason (#1957). The workflow's cron stays on
# as a fallback until this schedule has a run of on-time Success invocations.
# Overlapping runs are harmless: an unchanged price writes no snapshot, and
# the divergence alert claims its row atomically. :47 keeps this off the
# workflow's nominal :17.
#
# A failed run shows as Failed in SSM's command history, with nothing else to
# alert on it. Find the runs by their Comment.
#
# Lives in the PROD state. Target by name:
#   terraform apply -target=aws_scheduler_schedule.external_market_sync
# --------------------------------------------------------------------

resource "aws_scheduler_schedule" "external_market_sync" {
  name        = "daatan-prod-external-market-sync"
  description = "Hourly linked Polymarket/Kalshi price sync via SSM curl to /api/cron/external-market-sync (#2325)"
  state       = "ENABLED"

  schedule_expression          = "cron(47 * * * ? *)"
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
      Comment      = "Hourly external-market-sync (EventBridge, #2325)"
      Parameters = {
        executionTimeout = ["180"]
        commands = [
          "set -e",
          "SECRET=$(grep -m1 '^BOT_RUNNER_SECRET=' /home/ubuntu/app/.env | cut -d= -f2-)",
          "[ -n \"$SECRET\" ] || { echo 'BOT_RUNNER_SECRET missing from /home/ubuntu/app/.env'; exit 1; }",
          # The header goes in on stdin (-H @-), so the secret is not in curl's argv.
          "OUT=$(printf 'x-cron-secret: %s\\n' \"$SECRET\" | curl -sS --max-time 120 -H @- -w '\\n%%{http_code}' https://daatan.com/api/cron/external-market-sync)",
          "HTTP=$(printf '%s\\n' \"$OUT\" | tail -n 1)",
          "echo \"HTTP $HTTP\"",
          "printf '%s\\n' \"$OUT\" | sed '$d' | head -c 2000; echo",
          "[ \"$HTTP\" = 200 ]",
        ]
      }
    })

    retry_policy {
      # The next hour's run is the real retry; one retry covers a transient
      # SendCommand error without piling up.
      maximum_retry_attempts       = 1
      maximum_event_age_in_seconds = 900
    }
  }
}
