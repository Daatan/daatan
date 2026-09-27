# Email Configuration

Daatan's email runs on **AWS SES** in region **`eu-central-1`**, with `daatan.com` as the verified sending/receiving domain. This document is the source of truth for how mail flows and how to set up or fix a sender.

> **No secrets in this file.** SMTP passwords / API keys live in AWS Secrets Manager and the SES/IAM consoles only.

---

## DNS facts (daatan.com)

| Record | Value | Meaning |
|---|---|---|
| `MX` | `inbound-smtp.eu-central-1.amazonaws.com` | Inbound mail is received by **AWS SES** (not Namecheap — that is fully retired). |
| `TXT` (SPF) | `v=spf1 include:amazonses.com include:resend.com ~all` | Both **SES** and **Resend** are authorized to send as `daatan.com`. |
| DKIM | SES CNAME tokens present, status `SUCCESS` | DKIM signing active for SES. |

SES account (eu-central-1): **production access granted** (not sandbox), domain `daatan.com` verified for sending.

---

## Sending — two paths (know which you mean)

### 1. Application transactional email — currently **Resend**
The Next.js app sends via the `resend` SDK:
- `src/lib/services/email.ts` — opt-in notifications (`dispatchEmail`)
- `src/lib/services/auth-email.ts` — mandatory auth mail (verification, password reset)

Controlled by env: `RESEND_API_KEY`, `EMAIL_FROM`. **`EMAIL_FROM` must be on `daatan.com`** (the verified domain). When `EMAIL_FROM` is unset the code (`src/lib/branding.ts`) defaults to `Daatan <noreply@daatan.com>` for the SaaS edition — do **not** use `daatan.app` (it is not a verified sending domain anywhere).

> **Migration note / tech debt:** the *infrastructure* is fully on SES, but the *app code* still uses Resend (SPF authorizes both during transition). Pick one source of truth: either migrate `email.ts` / `auth-email.ts` to `@aws-sdk/client-sesv2` and drop the `resend` dependency, or keep Resend deliberately and document why. Until then, both must stay in SPF.

### 2. Human "Send mail as" (Gmail) — **SES SMTP**
Team members send as their `@daatan.com` address from Gmail via SES SMTP. Each person has a **dedicated IAM user** `ses-smtp-<name>-prod` with the `ses-send-policy` (SES send-only) attached.

Gmail → Settings → Accounts and Import → **Send mail as** settings:

| Field | Value |
|---|---|
| SMTP server | `email-smtp.eu-central-1.amazonaws.com` |
| Port | `587` (STARTTLS / "TLS") — or `465` for SSL |
| Username | the IAM user's **access key id** |
| Password | the **SES-derived SMTP password** (NOT the raw IAM secret) |
| From | `<name>@daatan.com` |

---

## Creating / rotating SES SMTP credentials for a person

The SMTP password is **not** the IAM secret access key — it is derived from it with an SES-specific algorithm. Pick one path:

**Script (recommended):** rotate a named `ses-smtp-<name>-prod` user with [`scripts/rotate-ses-smtp-credentials.sh`](../scripts/rotate-ses-smtp-credentials.sh):
```bash
scripts/rotate-ses-smtp-credentials.sh ses-smtp-andrey-prod
```
It mints a new access key, derives the SMTP password, and writes a `chmod 600`
file (secret never printed to the terminal), then prints the delete-old-key
command to run once the sender confirms it works. Requires awscli + python3.

**Console:** AWS Console → SES (eu-central-1) → **SMTP settings → Create SMTP credentials** — outputs a ready-to-use username + password. (Creates its own IAM user; prefer the script for a named, reusable identity.)

**Manual:** create a new access key for the IAM user (max 2 keys), then convert the secret with AWS's documented algorithm (HMAC-SHA256 chain over `11111111` → region → `ses` → `aws4_request` → `SendRawEmail`, prefixed with version byte `0x04`, base64). See AWS docs: *"Obtaining Amazon SES SMTP credentials by converting existing credentials."*

In all cases: deliver username + SMTP password over a secure channel (not chat/email), have the person paste them into Gmail's Send mail as, and **delete the old access key** after they confirm sending works.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `535 5.7.8 authentication failed` on Send mail as | SMTP username/password wrong, stale, or the raw IAM secret was pasted instead of the derived SMTP password | Regenerate/rotate SES SMTP credentials (above) and re-enter in Gmail |
| Send works but recipient never gets it | recipient on SES suppression list (prior bounce/complaint) | Check SES suppression list; remove if appropriate |
| App email silently not sent | `RESEND_API_KEY` unset (code returns early) or `EMAIL_FROM` on an unverified domain | Set the key; ensure `EMAIL_FROM` is `@daatan.com` |
| Bounce: "sending from a different address using Send mail as … misconfigured" | the alias's SMTP login failed (same as 535) | Rotate that alias's SES SMTP credentials |

---

## Retired / do not use
- **Namecheap Private Email** (`mail.privateemail.com`) — legacy. The MX no longer points there; any `@daatan.com` "Send mail as" alias still pointing at `mail.privateemail.com`, or POP3 import from it, is stale and should be removed.
- **`daatan.app`** as a sending domain — never verified; do not put it in `EMAIL_FROM` or `from` defaults.
