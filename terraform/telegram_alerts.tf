# ====================================================================
# INFRA ALERTS -> TELEGRAM (daatan#1726 proposal 3)
# ====================================================================
# Forwards every daatan-infra-alerts SNS message (CloudWatch alarm ALARM/OK
# state changes) to the Telegram clean channel, in addition to the existing
# email subscription (infra_alerts_email, monitoring.tf) -- email alone is
# how a 3h outage on 2026-09-04 sat unactioned. Reuses the SNS-topic ->
# Lambda pattern from infra/mail-forwarder (see ses.tf) rather than
# introducing a new one.
#
# Scoped to the eu-central-1 topic (aws_sns_topic.infra_alerts) only, which
# covers prod/staging EC2 host alarms -- the class this issue is about.
# daatan-infra-alerts-us-east-1 (Bedrock/region-locked alarms, monitoring.tf)
# is a deliberate follow-up: an SNS-to-Lambda subscription must live in the
# same region as its topic (see the region-mismatch comment above that
# resource), so covering it means a second function deployed via the
# aws.us_east_1 provider, not a config tweak to this one.
#
# Reads TELEGRAM_BOT_TOKEN / TELEGRAM_CLEAN_CHAT_ID from the app's own
# daatan-env-<environment> secret (secrets.tf) instead of provisioning a new
# one -- the app already sends its own Telegram notifications from the same
# values, so this Lambda just reads the same source of truth.

data "archive_file" "telegram_alerts" {
  type        = "zip"
  source_file = "${path.module}/../infra/telegram-alerts/index.mjs"
  output_path = "${path.module}/../infra/telegram-alerts/lambda.zip"
}

resource "aws_iam_role" "lambda_telegram_alerts" {
  name = "daatan-infra-alerts-telegram-role-${var.environment}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "lambda.amazonaws.com"
        }
      }
    ]
  })
}

resource "aws_iam_role_policy" "lambda_telegram_alerts" {
  name = "daatan-infra-alerts-telegram-policy"
  role = aws_iam_role.lambda_telegram_alerts.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["secretsmanager:GetSecretValue"]
        Resource = aws_secretsmanager_secret.env_vars.arn
      },
      {
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents"
        ]
        Resource = "arn:aws:logs:*:*:*"
      }
    ]
  })
}

resource "aws_lambda_function" "telegram_alerts" {
  filename         = data.archive_file.telegram_alerts.output_path
  function_name    = "daatan-infra-alerts-telegram-${var.environment}"
  role             = aws_iam_role.lambda_telegram_alerts.arn
  handler          = "index.handler"
  source_code_hash = data.archive_file.telegram_alerts.output_base64sha256
  runtime          = "nodejs22.x"
  timeout          = 10

  environment {
    variables = {
      ENV_SECRET_ID = aws_secretsmanager_secret.env_vars.name
    }
  }
}

resource "aws_lambda_permission" "allow_sns_infra_alerts" {
  statement_id  = "AllowExecutionFromInfraAlertsSNS"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.telegram_alerts.function_name
  principal     = "sns.amazonaws.com"
  source_arn    = aws_sns_topic.infra_alerts.arn
}

resource "aws_sns_topic_subscription" "infra_alerts_telegram" {
  topic_arn = aws_sns_topic.infra_alerts.arn
  protocol  = "lambda"
  endpoint  = aws_lambda_function.telegram_alerts.arn
}

# An alarm about a broken Telegram forwarder must not depend on the Telegram
# forwarder to deliver (same rationale as docs/MAIL_FORWARDER.md's
# mail-forwarder-errors alarm). This one fires through the pre-existing
# email subscription on the same topic (infra_alerts_email, monitoring.tf),
# which is independent of both this Lambda and Telegram.
resource "aws_cloudwatch_metric_alarm" "telegram_alerts_errors" {
  alarm_name          = "daatan-infra-alerts-telegram-errors"
  alarm_description   = "The infra-alerts Telegram forwarder Lambda is failing -- alerts are only reaching email."
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  dimensions          = { FunctionName = aws_lambda_function.telegram_alerts.function_name }
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.infra_alerts.arn]
  ok_actions          = [aws_sns_topic.infra_alerts.arn]
}
