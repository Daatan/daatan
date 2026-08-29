# Secret management

One AWS account (`272007598366`, `eu-central-1`), one Secrets Manager, one Parameter
Store — shared by `daatan`, `retro`, `news-indexer` and `elections`. **Isolation comes
from IAM, not from separate stores.** That is the right call: four stores would buy
isolation you already have, and would make the genuinely-shared values worse.

## The model

| Kind | Where | Why |
|---|---|---|
| App secrets, rotated independently | **SSM SecureString** `/daatan/<env>/secrets/<NAME>` | free, KMS-encrypted, IAM-scopable per path, rotates without a redeploy |
| Bootstrap secrets (DB password, GitHub token for the clone) | Secrets Manager `daatan-env-<env>`, `daatan-github-token` | needed before the app runs, injected at container start |
| Shared across services | **SSM SecureString** `/daatan/shared/secrets/<NAME>`, one parameter, **referenced** — never copied | one rotation, one place |
| Prompt ARNs | SSM String `/daatan/<env>/prompts/<name>` | not secret — **unread since #1658**, pending teardown; prompts live in git ([PROMPTS.md](PROMPTS.md)) |

## Rotating an app secret

No redeploy. The app caches for 5 minutes, and the AI-panel cron refreshes before each
sweep.

```bash
# Put the raw value in a file so it never appears in argv, `ps`, or shell history.
umask 077
printf '%s' "$(cat ~/.openrouter-key)" > /dev/shm/v
python3 - <<'PY' > /dev/shm/put.json
import json, pathlib
json.dump({
  "Name": "/daatan/staging/secrets/OPENROUTER_API_KEY",
  "Value": pathlib.Path("/dev/shm/v").read_text().strip(),
  "Type": "SecureString",
  "Overwrite": True,
}, open("/dev/stdout", "w"))
PY
aws ssm put-parameter --region eu-central-1 --cli-input-json file:///dev/shm/put.json
shred -u /dev/shm/v /dev/shm/put.json
```

CloudTrail records the `PutParameter` call but not a `SecureString`'s value.

Verify without printing it:

```bash
aws ssm get-parameter --name /daatan/staging/secrets/OPENROUTER_API_KEY \
  --with-decryption --region eu-central-1 --query 'length(Parameter.Value)'
```

## Why not keep everything in `daatan-env-<env>`

That blob is a single plaintext Secrets Manager value holding **every** credential the app
has, including the database password. So:

- rotating one key is a read-modify-write of all of them — you must materialise the DB
  password to change an API key;
- anything needing one value gets `GetSecretValue` on everything;
- values shared with other services get **copied** into two or three blobs, and a
  rotation that misses a copy fails silently.

On **2026-07-10** all three bit at once: a stale `OPENROUTER_API_KEY` inside the blob made
every AI-panel call return `401 "User not found."`, and the cron reported success while
doing so. See `docs/LASSO.md`.

New app secrets go in SSM. Existing ones migrate out of the blob one at a time; the code
falls back to the env var, so a parameter that does not exist yet changes nothing.

## Adding a secret

1. Add the name to `local.app_secret_names` in `terraform/secrets_ssm.tf`.
2. Add it to `AWS_SECRET_NAMES` in `src/lib/aws/secrets.ts`.
3. Apply, **staging first**, targeted — never a blanket apply:
   ```bash
   cd terraform
   terraform init -reconfigure -backend-config=backend-staging.hcl
   terraform plan  -var environment=staging -target='aws_ssm_parameter.app_secrets["NAME"]'
   terraform apply -var environment=staging -target='aws_ssm_parameter.app_secrets["NAME"]'
   ```
   `var.environment` defaults to `"prod"` and there are no tfvars — **omitting
   `-var environment=staging` writes prod resources from the staging state file.**
4. Set the value with the rotation recipe above. Terraform creates it at `PLACEHOLDER`,
   which the app reads as "not configured" (`ignore_changes = [value]` means an apply will
   never overwrite a live credential).

## Precedence

`getOpenRouterKey()` resolves: **admin setting (DB) → SSM SecureString → env var**.

The DB setting stays first so a self-host operator's admin panel works. `env` stays last
for local dev, CI and self-host. An unwarmed or unreachable SSM reads as `''` and falls
through — SSM being down must never take the app down.

## Who can read what

| Role | Scope |
|---|---|
| `daatan-ec2-role-<env>` | `daatan-env-<env>`, `daatan-github-token`, and `/daatan/<env>/secrets/*` |
| `truthmachine-ec2-role` (retro) | `daatan/*`, `openclaw/*` — **wildcards, wider than it needs** |
| `news-indexer-ec2-role` | `news-indexer-env`, `daatan-github-token*` |
| `openclaw-ec2-role` | `openclaw/*` |

Staging cannot read prod. That is the boundary that matters and it holds. (Until
2026-07-10 the **prod** role could read `daatan-env-staging` via a hardcoded ARN in
`terraform/iam_ssm.tf`; removed.)

## Known problems, not yet fixed

- **Shared secrets are copied, not referenced** — except `ORACLE_API_KEY` (docs#122
  group 3, fixed): it was "shared between oracle-api.service and the daatan app", but
  daatan's role couldn't read `openclaw/*`, so daatan held a copy that could drift from
  retro's. Now one parameter, `/daatan/shared/secrets/ORACLE_API_KEY`, read by both
  retro (`pipeline/src/tm/duel_report.py`) and daatan (`src/lib/aws/secrets.ts` via
  `getOracleApiKey()`) — see the IAM read grant in `terraform/secrets_ssm.tf`. Still
  copied, not fixed by this pass: `daatan/news-indexer-secret`'s own description says
  to set the same value in `daatan-env-prod`, `daatan-env-staging` *and*
  `news-indexer-env`; and `openclaw/telegram-bot-token-daatan`'s human-facing copy now
  lives at `/daatan/shared/secrets/TELEGRAM_BOT_TOKEN_DAATAN` (docs#122 group 1) but the
  app still reads it as a plain env var baked into the `daatan-env-*`/`news-indexer-env`
  blobs at deploy time — refill those blobs from the new SSM parameters, not from
  Secrets Manager, going forward, or migrate the read path the same way `ORACLE_API_KEY`
  was.
- **`truthmachine-ec2-role` has `daatan/*` and `openclaw/*` wildcards.** It can read
  `openclaw/github-pat` and `openclaw/gcp-service-account-key`, which the Oracle does not
  use. Narrow to the paths it reads. Its role is not managed by Terraform at all.
- **Five `openclaw/*` secrets are duplicated into `us-east-1`** and are free to diverge.
  Pick an authoritative region and delete the rest.
- **`openclaw/*` is a legacy namespace.** The code/docs rename to `daatan` deliberately
  left live secrets alone. Target layout is `/<service>/<env>/<name>`.
- **`daatan` repo has an unused `OPENROUTER_API_KEY` GitHub Actions secret** — referenced
  by no workflow. Delete it; an orphaned credential is a leak surface with no upside.
