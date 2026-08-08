# ====================================================================
# BILLING ALERTS (us-east-1 — required by AWS)
# ====================================================================

resource "aws_sns_topic" "billing_alerts" {
  provider = aws.us_east_1
  name     = "daatan-billing-alerts"
}

resource "aws_sns_topic_subscription" "billing_alerts_email" {
  provider  = aws.us_east_1
  topic_arn = aws_sns_topic.billing_alerts.arn
  protocol  = "email"
  endpoint  = "komapc@gmail.com"
}

resource "aws_cloudwatch_metric_alarm" "billing_50usd" {
  provider            = aws.us_east_1
  alarm_name          = "billing-alert-50usd"
  alarm_description   = "AWS spend exceeded $50 — credits may be expiring"
  metric_name         = "EstimatedCharges"
  namespace           = "AWS/Billing"
  statistic           = "Maximum"
  period              = 86400
  evaluation_periods  = 1
  threshold           = 50
  comparison_operator = "GreaterThanOrEqualToThreshold"
  alarm_actions       = [aws_sns_topic.billing_alerts.arn]

  dimensions = {
    Currency = "USD"
  }
}

resource "aws_cloudwatch_metric_alarm" "billing_150usd" {
  provider            = aws.us_east_1
  alarm_name          = "billing-alert-150usd"
  alarm_description   = "AWS spend exceeded $150 — action required"
  metric_name         = "EstimatedCharges"
  namespace           = "AWS/Billing"
  statistic           = "Maximum"
  period              = 86400
  evaluation_periods  = 1
  threshold           = 150
  comparison_operator = "GreaterThanOrEqualToThreshold"
  alarm_actions       = [aws_sns_topic.billing_alerts.arn]

  dimensions = {
    Currency = "USD"
  }
}

resource "aws_cloudwatch_metric_alarm" "billing_200usd" {
  provider            = aws.us_east_1
  alarm_name          = "billing-alert-200usd"
  alarm_description   = "AWS spend exceeded $200 — credits exhausted or nearly gone"
  metric_name         = "EstimatedCharges"
  namespace           = "AWS/Billing"
  statistic           = "Maximum"
  period              = 86400
  evaluation_periods  = 1
  threshold           = 200
  comparison_operator = "GreaterThanOrEqualToThreshold"
  alarm_actions       = [aws_sns_topic.billing_alerts.arn]

  dimensions = {
    Currency = "USD"
  }
}

# AWS Budgets publishes as the SERVICE principal budgets.amazonaws.com, which the
# topic's AWS-generated default policy does NOT match — that statement grants
# Principal {"AWS": "*"} (IAM principals only), so a budget attached to this topic
# would have its notifications silently dropped, or fail validation outright.
# `terraform plan` cannot catch this: it never checks SNS publish permission.
#
# This resource REPLACES the whole topic policy (aws_sns_topic_policy is not
# additive), so the default statement is restated verbatim below to keep the
# existing CloudWatch-alarm publishing working.
data "aws_iam_policy_document" "billing_alerts" {
  statement {
    sid    = "__default_statement_ID"
    effect = "Allow"

    principals {
      type        = "AWS"
      identifiers = ["*"]
    }

    actions = [
      "SNS:GetTopicAttributes",
      "SNS:SetTopicAttributes",
      "SNS:AddPermission",
      "SNS:RemovePermission",
      "SNS:DeleteTopic",
      "SNS:Subscribe",
      "SNS:ListSubscriptionsByTopic",
      "SNS:Publish",
    ]

    resources = [aws_sns_topic.billing_alerts.arn]

    condition {
      test     = "StringEquals"
      variable = "AWS:SourceOwner"
      values   = [data.aws_caller_identity.current.account_id]
    }
  }

  statement {
    sid    = "AWSBudgetsSNSPublishingPermissions"
    effect = "Allow"

    principals {
      type        = "Service"
      identifiers = ["budgets.amazonaws.com"]
    }

    actions   = ["SNS:Publish"]
    resources = [aws_sns_topic.billing_alerts.arn]

    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [data.aws_caller_identity.current.account_id]
    }

    condition {
      test     = "ArnLike"
      variable = "aws:SourceArn"
      values   = ["arn:aws:budgets::${data.aws_caller_identity.current.account_id}:*"]
    }
  }
}

resource "aws_sns_topic_policy" "billing_alerts" {
  provider = aws.us_east_1
  arn      = aws_sns_topic.billing_alerts.arn
  policy   = data.aws_iam_policy_document.billing_alerts.json
}

# The three EstimatedCharges alarms above are net of promotional credits: while
# credits cover the bill, the metric reads $0.00 and the alarms cannot fire, which
# defeats their own "credits may be expiring" framing. All three have sat in OK
# since 2026-05-19 on 0.0 datapoints. This budget measures GROSS spend instead
# (include_credit = false) so burn is visible while credits are still absorbing it.
#
# This is a recurring monthly signal, not an exception one: the limit sits below
# current run-rate, so it is expected to notify every month. Treat it as a "here is
# the burn" ping. It does NOT warn about credit exhaustion — that needs the credit
# balance itself, which no AWS budget exposes. Figures and runway: see the finances
# audit in the private Daatan/docs repo (this repo is public).
resource "aws_budgets_budget" "gross_spend_monthly" {
  name         = "daatan-gross-spend-monthly"
  budget_type  = "COST"
  limit_amount = "500"
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  cost_types {
    include_credit = false
  }

  notification {
    comparison_operator       = "GREATER_THAN"
    threshold                 = 80
    threshold_type            = "PERCENTAGE"
    notification_type         = "ACTUAL"
    subscriber_sns_topic_arns = [aws_sns_topic.billing_alerts.arn]
  }

  notification {
    comparison_operator       = "GREATER_THAN"
    threshold                 = 100
    threshold_type            = "PERCENTAGE"
    notification_type         = "ACTUAL"
    subscriber_sns_topic_arns = [aws_sns_topic.billing_alerts.arn]
  }
}

# ====================================================================
# INFRASTRUCTURE ALERTS (eu-central-1)
# ====================================================================

resource "aws_sns_topic" "infra_alerts" {
  name = "daatan-infra-alerts"
}

resource "aws_sns_topic_subscription" "infra_alerts_email" {
  topic_arn = aws_sns_topic.infra_alerts.arn
  protocol  = "email"
  endpoint  = "komapc@gmail.com"
}

# Production EC2 — fires if instance fails host or reachability checks for 2 consecutive minutes
resource "aws_cloudwatch_metric_alarm" "prod_ec2_status_check" {
  alarm_name          = "prod-ec2-status-check-failed"
  alarm_description   = "Production EC2 instance status check failed — instance may be unreachable"
  metric_name         = "StatusCheckFailed"
  namespace           = "AWS/EC2"
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 2
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "breaching"
  alarm_actions       = [aws_sns_topic.infra_alerts.arn]
  ok_actions          = [aws_sns_topic.infra_alerts.arn]

  dimensions = {
    InstanceId = aws_instance.production.id
  }
}

# --------------------------------------------------------------------
# Instance sets reused by the alarm families below
# --------------------------------------------------------------------
locals {
  # retro/TruthMachine Oracle box — not managed by this terraform, but
  # monitored here so all infra alerting lives in one place.
  #
  # Facts (verified 2026-06-09):
  #   - Instance i-00ac444b94c5ff9b2, name "truthmachine-pipeline"
  #   - Type t4g.small (ARM/Graviton), AZ eu-central-1c, public IP 3.120.185.111
  #   - Provisioned out-of-band; operated via retro/infra/*.sh over SSM (no IaC).
  #     If this terraform is destroyed/recreated the box is untouched, and
  #     terraform cannot rebuild it if lost — see retro repo for provisioning.
  #   - Live and in active use: serves oracle.daatan.com (oracle-api.service,
  #     FastAPI) + bayes.daatan.com (BayesOracle) + the truthmachine.service
  #     batch pipeline. daatan calls it via ORACLE_URL in the forecast path
  #     (oracleSearch / getOracleForecast), so it is a load-bearing dependency.
  #   - No CloudWatch agent installed (see cwagent_instances below).
  oracle_instance_id = "i-00ac444b94c5ff9b2"

  # All instances that get default-EC2-metric alarms (CPU, status check).
  monitored_instances = {
    prod    = aws_instance.production.id
    staging = aws_instance.staging.id
    oracle  = local.oracle_instance_id
  }

  # Only these run the CloudWatch agent, so only these publish
  # disk_used_percent / mem_used_percent / swap_used_percent. The Oracle
  # box has no agent — give it one before adding disk/mem/swap alarms for it.
  cwagent_instances = {
    prod    = aws_instance.production.id
    staging = aws_instance.staging.id
  }
}

# --------------------------------------------------------------------
# EC2 status checks — staging + oracle (prod has its own block above)
# --------------------------------------------------------------------
resource "aws_cloudwatch_metric_alarm" "staging_ec2_status_check" {
  alarm_name          = "staging-ec2-status-check-failed"
  alarm_description   = "Staging EC2 instance status check failed — instance may be unreachable"
  metric_name         = "StatusCheckFailed"
  namespace           = "AWS/EC2"
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 2
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "breaching"
  alarm_actions       = [aws_sns_topic.infra_alerts.arn]
  ok_actions          = [aws_sns_topic.infra_alerts.arn]

  dimensions = {
    InstanceId = aws_instance.staging.id
  }
}

resource "aws_cloudwatch_metric_alarm" "oracle_ec2_status_check" {
  alarm_name          = "oracle-ec2-status-check-failed"
  alarm_description   = "Oracle (retro/TruthMachine) EC2 status check failed — instance may be unreachable"
  metric_name         = "StatusCheckFailed"
  namespace           = "AWS/EC2"
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 2
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "breaching"
  alarm_actions       = [aws_sns_topic.infra_alerts.arn]
  ok_actions          = [aws_sns_topic.infra_alerts.arn]

  dimensions = {
    InstanceId = local.oracle_instance_id
  }
}

# --------------------------------------------------------------------
# Auto-recover — on the SYSTEM status check (AWS host hardware faults).
# The ec2:recover action reboots the instance on new hardware for free;
# supported on t3/t4g. Also notifies so we know it happened.
# --------------------------------------------------------------------
resource "aws_cloudwatch_metric_alarm" "ec2_autorecover" {
  for_each = local.monitored_instances

  alarm_name          = "${each.key}-ec2-autorecover"
  alarm_description   = "${each.key} EC2 system status check failed — auto-recovering instance"
  metric_name         = "StatusCheckFailed_System"
  namespace           = "AWS/EC2"
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 2
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  alarm_actions = [
    "arn:aws:automate:${var.aws_region}:ec2:recover",
    aws_sns_topic.infra_alerts.arn,
  ]

  dimensions = {
    InstanceId = each.value
  }
}

# --------------------------------------------------------------------
# CPU high — all monitored instances (default EC2 metric)
# --------------------------------------------------------------------
resource "aws_cloudwatch_metric_alarm" "ec2_cpu_high" {
  for_each = local.monitored_instances

  alarm_name          = "${each.key}-ec2-cpu-high"
  alarm_description   = "${each.key} EC2 CPU >= 85% for 15 minutes"
  metric_name         = "CPUUtilization"
  namespace           = "AWS/EC2"
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 3
  threshold           = 85
  comparison_operator = "GreaterThanOrEqualToThreshold"
  alarm_actions       = [aws_sns_topic.infra_alerts.arn]
  ok_actions          = [aws_sns_topic.infra_alerts.arn]

  dimensions = {
    InstanceId = each.value
  }
}

# --------------------------------------------------------------------
# Memory high — codifies the two pre-existing live alarms (import these).
# Live config: Average / period 60 / 5 evals / > 85 / no action.
# We additionally wire them to infra_alerts (the live ones notify nothing).
# --------------------------------------------------------------------
resource "aws_cloudwatch_metric_alarm" "prod_memory_high" {
  alarm_name          = "daatan-prod-memory-high"
  alarm_description   = "Production memory usage > 85%"
  metric_name         = "mem_used_percent"
  namespace           = "CWAgent"
  statistic           = "Average"
  period              = 60
  evaluation_periods  = 5
  datapoints_to_alarm = 3
  threshold           = 85
  comparison_operator = "GreaterThanThreshold"
  alarm_actions       = [aws_sns_topic.infra_alerts.arn]

  dimensions = {
    InstanceId = aws_instance.production.id
  }
}

resource "aws_cloudwatch_metric_alarm" "staging_memory_high" {
  alarm_name          = "daatan-staging-memory-high"
  alarm_description   = "Staging memory usage > 85%"
  metric_name         = "mem_used_percent"
  namespace           = "CWAgent"
  statistic           = "Average"
  period              = 60
  evaluation_periods  = 5
  datapoints_to_alarm = 3
  threshold           = 85
  comparison_operator = "GreaterThanThreshold"
  alarm_actions       = [aws_sns_topic.infra_alerts.arn]

  dimensions = {
    InstanceId = aws_instance.staging.id
  }
}

# --------------------------------------------------------------------
# Disk high — prod + staging only (CWAgent). Root volume usage >= 85%.
# Dimensions must match exactly what the agent publishes, or the alarm
# sits in INSUFFICIENT_DATA forever: path=/, device=nvme0n1p1, fstype=ext4.
# --------------------------------------------------------------------
resource "aws_cloudwatch_metric_alarm" "ec2_disk_high" {
  for_each = local.cwagent_instances

  alarm_name          = "${each.key}-ec2-disk-high"
  alarm_description   = "${each.key} root disk usage >= 85%"
  metric_name         = "disk_used_percent"
  namespace           = "CWAgent"
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 1
  threshold           = 85
  comparison_operator = "GreaterThanOrEqualToThreshold"
  alarm_actions       = [aws_sns_topic.infra_alerts.arn]
  ok_actions          = [aws_sns_topic.infra_alerts.arn]

  dimensions = {
    InstanceId = each.value
    path       = "/"
    device     = "nvme0n1p1"
    fstype     = "ext4"
  }
}

# --------------------------------------------------------------------
# Swap high — prod + staging (CWAgent). Sustained swap on a 2 GB box is
# an early memory-pressure / pre-OOM signal.
# --------------------------------------------------------------------
resource "aws_cloudwatch_metric_alarm" "ec2_swap_high" {
  for_each = local.cwagent_instances

  alarm_name          = "${each.key}-ec2-swap-high"
  alarm_description   = "${each.key} swap usage >= 25% — memory pressure"
  metric_name         = "swap_used_percent"
  namespace           = "CWAgent"
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 3
  threshold           = 25
  comparison_operator = "GreaterThanOrEqualToThreshold"
  alarm_actions       = [aws_sns_topic.infra_alerts.arn]
  ok_actions          = [aws_sns_topic.infra_alerts.arn]

  dimensions = {
    InstanceId = each.value
  }
}
