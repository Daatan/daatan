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

# The former EstimatedCharges alarms ($50/$150/$200, net of credits) were removed
# 2026-08-21: while credits cover the bill they sat in OK on 0.0 datapoints forever,
# and once credits end (~Dec 2026 at ~$15/day) they would fire on roughly day 3,
# 10 and 13 of EVERY month — noise, not signal. Both questions they tried to ask are
# answered by the budgets below: net_spend_monthly says "credits stopped covering",
# gross_spend_monthly says "burn is above plan".
resource "aws_sns_topic_policy" "billing_alerts" {
  provider = aws.us_east_1
  arn      = aws_sns_topic.billing_alerts.arn
  policy   = data.aws_iam_policy_document.billing_alerts.json
}

# The three EstimatedCharges alarms above are net of promotional credits: while
# credits cover the bill, the metric reads $0.00 and the alarms cannot fire, which
# defeats their own "credits may be expiring" framing. All three have sat in OK
# since 2026-05-19 on 0.0 datapoints.
#
# Two budgets, two questions (Daatan/platform#20, 2026-08-21):
#
# 1. gross_spend_monthly — "is burn where we expect it?" Measures GROSS spend
#    (include_credit = false) so burn is visible while credits are still absorbing
#    it. The limit is set at the post-Translate, post-cleanup target run-rate, i.e.
#    deliberately a bit below today's actuals: it goes quiet only once the planned
#    savings land, and the FORECASTED alert speaks early in the month if they don't.
# 2. net_spend_monthly — "has real cash started flowing, and is it on plan?"
#    Measures NET spend (credits applied). While credits cover the bill it reads $0
#    and stays silent; the 1% ACTUAL threshold fires on the first few dollars of
#    real charges — the day credits stop covering. No AWS budget exposes the credit
#    balance itself, so this is the closest thing to a credit-exhaustion alarm.
#    Once credits are gone net == gross, so the limit matches the gross guard and
#    the 100% ACTUAL alert becomes the "the bill overran the plan" signal. Figures and runway: see the
#    finances audit in the private Daatan/docs repo (this repo is public).
resource "aws_budgets_budget" "gross_spend_monthly" {
  name         = "daatan-gross-spend-monthly"
  budget_type  = "COST"
  limit_amount = "300"
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

  notification {
    comparison_operator       = "GREATER_THAN"
    threshold                 = 100
    threshold_type            = "PERCENTAGE"
    notification_type         = "FORECASTED"
    subscriber_sns_topic_arns = [aws_sns_topic.billing_alerts.arn]
  }
}

resource "aws_budgets_budget" "net_spend_monthly" {
  name         = "daatan-net-spend-monthly"
  budget_type  = "COST"
  limit_amount = "300"
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  cost_types {
    include_credit = true
  }

  notification {
    comparison_operator       = "GREATER_THAN"
    threshold                 = 1
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

  # No FORECASTED alert here on purpose: AWS forecasts a net budget from gross
  # usage (observed 2026-08-21: $0 actual, ~$220 forecast), so it would sit in
  # ALARM every month while credits still cover everything.
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

# ====================================================================
# INFRASTRUCTURE ALERTS (us-east-1)
# ====================================================================
# A CloudWatch alarm can only publish to an SNS topic in its OWN region, and
# AWS/Bedrock metrics exist only in us-east-1 — so any alarm on Bedrock needs a
# us-east-1 topic to talk to. The eu-central-1 topic above cannot serve them:
# PutMetricAlarm rejects a cross-region ARN outright ("Invalid region
# eu-central-1 specified. Only us-east-1 is supported").
#
# That is why retro's two Bedrock alarms have never existed despite being merged
# since 2026-07-21 — they point at the eu-central-1 topic and every apply of them
# fails. `terraform plan` cannot catch it: the plan renders clean and the region
# mismatch only surfaces at apply. See Daatan/retro#669.
#
# Deliberately a second topic rather than reusing daatan-billing-alerts (which is
# already in us-east-1): that one is for Budgets, and routing a stalled-pipeline
# page through a topic named for billing costs nothing today, when everything
# lands in one inbox, but misroutes the moment alerts are dispatched by topic.
#
# No aws_sns_topic_policy here, unlike billing_alerts above: that one needs an
# explicit grant because Budgets publishes as a SERVICE principal. CloudWatch
# alarms publish on behalf of the account owner, which the AWS-generated default
# policy already covers — verified against daatan-infra-alerts, which carries only
# the default statement and whose EC2 alarms deliver fine.
resource "aws_sns_topic" "infra_alerts_us_east_1" {
  provider = aws.us_east_1
  name     = "daatan-infra-alerts-us-east-1"
}

resource "aws_sns_topic_subscription" "infra_alerts_us_east_1_email" {
  provider  = aws.us_east_1
  topic_arn = aws_sns_topic.infra_alerts_us_east_1.arn
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
  # notBreaching (prod/oracle use breaching): staging is stopped on a schedule
  # every night and weekend (staging_schedule.tf, #1526), and a stopped
  # instance publishes no StatusCheckFailed datapoints — "breaching" would
  # page at every scheduled stop and clear at every start.
  treat_missing_data = "notBreaching"
  alarm_actions      = [aws_sns_topic.infra_alerts.arn]
  ok_actions         = [aws_sns_topic.infra_alerts.arn]

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
# Auto-reboot — prod only, on the INSTANCE status check (guest OS/network
# hangs, as opposed to ec2_autorecover's host-hardware SYSTEM check above).
# daatan#1726 (2026-09-04): the guest lost its network while the kernel and
# Postgres stayed alive, so StatusCheckFailed_System never left OK and
# ec2:recover never fired; the box sat unreachable for 3 h until a manual
# reboot. ec2:reboot is an ACPI soft reboot, so Postgres shuts down cleanly
# if the OS is still alive, as it was here — this doesn't replace
# ec2_autorecover, it covers the other half of the failure space.
# treat_missing_data = "missing" (not "breaching"): unlike the status-check
# alarm above, a gap in this metric isn't itself evidence of a failed guest.
# --------------------------------------------------------------------
resource "aws_cloudwatch_metric_alarm" "prod_ec2_autoreboot" {
  alarm_name          = "prod-ec2-autoreboot"
  alarm_description   = "Production EC2 instance status check failed — auto-rebooting instance"
  metric_name         = "StatusCheckFailed_Instance"
  namespace           = "AWS/EC2"
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 3
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "missing"
  alarm_actions = [
    "arn:aws:automate:${var.aws_region}:ec2:reboot",
    aws_sns_topic.infra_alerts.arn,
  ]
  ok_actions = [aws_sns_topic.infra_alerts.arn]

  dimensions = {
    InstanceId = aws_instance.production.id
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
# CWAgent silence — prod only. daatan#1726: during the 2026-09-04 page-cache
# thrash, the agent was starved and daatan-prod-memory-high went
# OK -> INSUFFICIENT_DATA (treat_missing_data = "missing" there is correct
# for that alarm's own purpose — it shouldn't cry wolf on routine agent
# restarts), so the exact moment memory pressure was worst produced no
# alarm at all. This is a dedicated alarm on the agent itself falling
# silent, kept separate from mem/disk/swap-high (an agent outage would
# otherwise trip all three at once, which is noise, and conflates "no
# data" with "bad data").
# --------------------------------------------------------------------
resource "aws_cloudwatch_metric_alarm" "prod_cwagent_silent" {
  alarm_name          = "prod-cwagent-silent"
  alarm_description   = "Production CloudWatch agent has stopped reporting mem_used_percent"
  metric_name         = "mem_used_percent"
  namespace           = "CWAgent"
  statistic           = "SampleCount"
  period              = 300
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = "breaching"
  alarm_actions       = [aws_sns_topic.infra_alerts.arn]
  ok_actions          = [aws_sns_topic.infra_alerts.arn]

  dimensions = {
    InstanceId = aws_instance.production.id
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
