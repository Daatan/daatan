# Infra Alerts → Telegram

CloudWatch infra alarms (`daatan-infra-alerts` SNS topic, `terraform/monitoring.tf`) reached only
a single email inbox until daatan#1726 — a 3+ hour prod outage on 2026-09-04 sat unactioned
because nobody saw the alert in time. This Lambda mirrors `infra/mail-forwarder`'s
SNS-topic-to-Lambda pattern to also post every alarm/OK transition to the Telegram clean channel.

## Architecture

```
CloudWatch alarm → SNS (daatan-infra-alerts, eu-central-1) → email (unchanged)
                                                            → Lambda (daatan-infra-alerts-telegram-<env>)
                                                                    ↓
                                                              Telegram clean channel
```

**Terraform**: `terraform/telegram_alerts.tf`
**Lambda source**: `infra/telegram-alerts/index.mjs`

Scoped to the eu-central-1 `daatan-infra-alerts` topic only — it covers prod/staging EC2 host
alarms, the class this issue is about. `daatan-infra-alerts-us-east-1` (Bedrock/region-locked
alarms) has no Telegram subscriber yet: an SNS→Lambda subscription must live in the topic's own
region, so that needs a second function deployed via the `aws.us_east_1` provider, not a change
here.

## What the Lambda does

1. Reads the CloudWatch alarm JSON out of the SNS message (`AlarmName`, `NewStateValue`,
   `NewStateReason`, `Region`).
2. Fetches `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CLEAN_CHAT_ID` (falling back to `TELEGRAM_CHAT_ID`)
   from the app's own `daatan-env-<environment>` Secrets Manager secret — no separate secret is
   provisioned for this Lambda, and credentials are cached for the life of the warm container.
3. Posts `🔴 ALARM: <name> (<region>)\n<reason>` or `🟢 OK: ...` to
   `https://api.telegram.org/bot<token>/sendMessage`.
4. Rethrows on a non-2xx Telegram response, which counts against the Lambda's own `Errors` metric.

## Monitoring the forwarder itself

`daatan-infra-alerts-telegram-errors` alarms on that `Errors` metric — deliberately routed back
through the existing **email** subscription on `daatan-infra-alerts`, not through Telegram, so a
broken forwarder can't mask its own failure (same rationale as `docs/MAIL_FORWARDER.md`'s
`daatan-mail-forwarder-errors-prod`).

## Deploying changes

```bash
cd terraform
terraform plan  -target=aws_lambda_function.telegram_alerts -target=aws_sns_topic_subscription.infra_alerts_telegram -target=aws_cloudwatch_metric_alarm.telegram_alerts_errors -target=aws_iam_role.lambda_telegram_alerts -target=aws_iam_role_policy.lambda_telegram_alerts -target=aws_lambda_permission.allow_sns_infra_alerts
terraform apply <same -target flags>
```

Run tests with `npm test` (covers `infra/telegram-alerts/index.test.mjs`, same pattern as
`infra/mail-forwarder/index.test.mjs` — the AWS SDK import means the pure helpers are re-declared
in the test file rather than imported from `index.mjs`).
