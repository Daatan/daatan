# Mail Forwarder

Incoming email for `@daatan.com` is received by AWS SES and forwarded to personal Gmail addresses via a Lambda function.

## Architecture

```
Sender → SES inbound (eu-central-1) → S3 (raw email stored)
                                     → Lambda (daatan-mail-forwarder-prod)
                                           ↓
                                     SES outbound → Gmail
```

**Terraform**: `terraform/ses.tf`  
**Lambda source**: `infra/mail-forwarder/index.mjs`

## Routing

| Recipient | Forwarded to |
|-----------|-------------|
| `mark@daatan.com` | `komapc@gmail.com`, `andrey1bar@gmail.com` |
| `andrey@daatan.com` | `andrey1bar@gmail.com` |
| anything else (`office@`, etc.) | `komapc@gmail.com`, `andrey1bar@gmail.com` (catch-all) |

**Invariant:** every incoming `@daatan.com` mail must reach at least `andrey1bar@gmail.com`. Any new mapping added to `FORWARD_MAPPING` must include it.

Configured via Lambda env var `FORWARD_MAPPING` (JSON) and `CATCH_ALL_DESTINATIONS` (comma-separated). Managed in `terraform/ses.tf`.

## What the Lambda does

1. Reads the raw email from S3 (SES stores it there before invoking Lambda).
2. Drops any message addressed to `forwarder@daatan.com` (bounce/DSN loop guard).
3. Rewrites headers:
   - `From:` → `{Original Name} via Daatan <forwarder@daatan.com>`
   - `Reply-To:` → original sender address
   - `To:` → forwarding destination(s)
   - `Return-Path:` → removed (SES adds its own)
4. Sends via SES `SendRawEmail`.

**Important**: The raw email stored in S3 has SES-prepended headers (`Received:`, `X-SES-*`, etc.) in the same header block as the original headers. Do **not** strip everything before the first blank line — that would discard all headers and cause Gmail to reject the email with "From header is missing". Strip only specific unwanted headers by name if needed.

## Sending from daatan.com addresses (Gmail SMTP)

Both Mark and Andrey can send outbound email from their `@daatan.com` addresses using Gmail's "Send mail as" feature via SES SMTP.

**SMTP settings**:

| Setting | Value |
|---------|-------|
| SMTP Server | `email-smtp.eu-central-1.amazonaws.com` |
| Port | `587` (STARTTLS) |
| Username / Password (Mark) | `terraform output smtp_username_mark` / `terraform output smtp_password_mark` |
| Username / Password (Andrey) | not in Terraform outputs — key is rotated out-of-band via `scripts/rotate-ses-smtp-credentials.sh` (see [`docs/EMAIL.md`](./EMAIL.md#creating--rotating-ses-smtp-credentials-for-a-person)); the script writes credentials to a local file, deliver over a secure channel |

**IAM users**: `terraform/iam_smtp.tf` — `ses-smtp-mark-*` and `ses-smtp-andrey-*`, both have `ses:SendRawEmail` on `*`. Only `smtp_mark`'s access key is Terraform-managed (daatan#1428).

**Setup steps** (Gmail):
1. Gmail Settings → Accounts and Import → Send mail as → Add another email address
2. Enter the `@daatan.com` address, uncheck "Treat as alias"
3. Enter SMTP settings above
4. Click through the verification email that arrives in your inbox

## Known issues / history

| Date | Issue | Fix |
|------|-------|-----|
| 2026-04-07 | PR #601 stripped all headers by slicing at first `\r\n\r\n`, causing "From header is missing" Gmail rejection | PR #605: removed the strip block entirely |
| 2026-04-07 | Bounce loop: DSNs sent to `forwarder@daatan.com` were re-forwarded, causing cascades | PR #605: drop messages whose destination == `VERIFIED_FROM` |
| 2026-04-07 | `Return-Path:` replaced with `""` left a leading blank line, causing all headers to appear as email body in Gmail | Commit on `infra/sync-terraform-drift`: regex now includes `\r?\n` to remove the entire line |
| 2026-04-15 | Folded `From:` / `Reply-To:` headers (common in Google Groups, mailing lists, Apple Mail) left their continuation line as an orphan after the single-line rewrite. SES saw two address-like tokens and rejected with `MessageRejected: The following identities failed the check`. `Sender:`/`Resent-*` headers with unverified addresses had the same effect. Dropped ~10–15 mails between Apr 7 and Apr 17 before the alarm made it visible. | Folded-header-aware regex helpers (`replaceHeader`/`removeHeader`); `Sender`/`Resent-From`/`Resent-Sender`/`Resent-Return-Path` stripped from outbound. Unit test in `infra/mail-forwarder/index.test.mjs`. |

Run the unit tests locally with:

```bash
node --test infra/mail-forwarder/index.test.mjs
```

## Deploying changes

The Lambda is managed by Terraform. After editing `infra/mail-forwarder/index.mjs`:

```bash
cd terraform
terraform apply -target=aws_lambda_function.forwarder
```

For urgent hotfixes, deploy directly then sync Terraform state:
```bash
cd infra/mail-forwarder
zip -j lambda.zip index.mjs
aws lambda update-function-code --function-name daatan-mail-forwarder-prod --zip-file fileb://lambda.zip
# Then run terraform apply to sync state hash
```

## Monitoring & alerting

**CloudWatch log group**: `/aws/lambda/daatan-mail-forwarder-prod`

Useful filter patterns:

- `"Processing message"` — all invocations with recipient
- `"Email forwarded"` — successful forwards
- `"Failed to forward"` — errors
- `"Dropping bounce"` — suppressed DSN loops

**Alarm**: `daatan-mail-forwarder-errors-prod` fires on any `AWS/Lambda Errors > 0` in a 5-minute window, publishing to SNS topic `daatan-mail-forwarder-alerts-prod`. The topic is subscribed **directly to `andrey1bar@gmail.com` and `komapc@gmail.com`** — not to `ops@daatan.com` — because an alarm about a broken forwarder must not depend on the forwarder to deliver. The first `terraform apply` that creates these resources will send each Gmail a confirmation link; both must be clicked for alerts to arrive.

## Retention & archive

- **Durable archive**: the Gmail inboxes — that's where mail lives long-term.
- **S3 staging bucket** (`daatan-mail-inbound-prod-*`): **14-day retention**, transitioned to Glacier Instant Retrieval at day 7. This exists only as a recovery window if the Lambda breaks silently; in normal operation every message has already been forwarded to Gmail by the time SES writes it to S3.
- **No versioning** on the bucket — once lifecycle expires an object, it is gone.

To recover a message that failed to forward within the 14-day window:

```bash
aws s3 cp s3://daatan-mail-inbound-prod-272007598366/<messageId> /tmp/mail.eml
# Inspect, fix the Lambda, re-invoke if needed.
```
