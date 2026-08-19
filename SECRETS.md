# Secrets Management

**If sign-in works on staging but not production (or vice versa):** see [docs/TROUBLESHOOTING-AUTH.md](docs/TROUBLESHOOTING-AUTH.md) for step-by-step checks (server `.env`, Google Console redirect URIs, health checks).

## Current Approach

**Source of truth:** AWS Secrets Manager bundles — `daatan-env-prod` and `daatan-env-staging` — each holding a full `.env` blob.

On every deploy, `scripts/blue-green-deploy.sh` invokes `scripts/fetch-secrets.sh <env>` which pulls the bundle and writes it to `~/app/.env` on the instance. The container is then (re)started with those vars via `docker-compose.{prod,staging}.yml` and the `ENV_ARGS` list in `blue-green-deploy.sh`. On first boot, the EC2 user data (Terraform `ec2.tf`) performs the same pull to seed `~/app/.env`.

> **Deploy-env → secret name mapping.** Inside `fetch-secrets.sh` the deploy environment string `production` is mapped to the Secrets Manager name `daatan-env-prod` (a single historical alias; Terraform and `restore_secrets.sh` both use `prod`). Staging uses its name verbatim: `staging` → `daatan-env-staging`. If you add a new environment you must register it in the case statement.

### What We Use

Full, currently-active list. Vars marked "GitHub secret" are **also** needed at image build time (Next.js public vars baked into the bundle) or by the deploy workflow itself; everything else is server-runtime only.

| Variable | Secrets Manager bundle | GitHub secret? | Purpose |
|----------|------------------------|----------------|---------|
| `POSTGRES_PASSWORD` | ✅ | — | Postgres authentication |
| `DATABASE_URL` | ✅ | — | Prisma connection string |
| `NEXTAUTH_SECRET` | ✅ | — | NextAuth.js session encryption |
| `NEXTAUTH_URL` | ✅ | — | Canonical site URL for NextAuth |
| `GOOGLE_CLIENT_ID` | ✅ | — | Google OAuth |
| `GOOGLE_CLIENT_SECRET` | ✅ | — | Google OAuth |
| `GEMINI_API_KEY` | — | — | **Removed from both bundles (#1472).** Gemini Developer API key. Production runs Google through the Vertex rows below; the key remains a *self-host* option only, so nothing supplies it to daatan.com |
| `GOOGLE_VERTEX_PROJECT_ID` | ✅ | — | Primary LLM provider: Gemini via Vertex AI (#1472). GCP project that owns the Vertex quota |
| `GOOGLE_VERTEX_LOCATION` | ✅ | — | Vertex location; omit to default to `global` |
| `GOOGLE_VERTEX_CLIENT_EMAIL` | ✅ | — | Vertex service-account email (needs the `Vertex AI User` role) |
| `GOOGLE_VERTEX_PRIVATE_KEY` | ✅ | — | Vertex service-account private key (PEM; `\n`-escaped newlines are un-escaped at load) |
| `OPENROUTER_API_KEY` | ✅ | — | LLM provider used by bots |
| `SERPER_API_KEY` | ✅ | — | Serper.dev — Express Forecast web search |
| `NIMBLEWAY_API_KEY` | ✅ | — | Nimble web scraping |
| `SERPAPI_API_KEY` | ✅ | — | SerpAPI (fallback search) |
| `SCRAPINGBEE_API_KEY` | ✅ | — | ScrapingBee (fallback fetch) |
| `ORACLE_URL` | ✅ | — | TruthMachine Oracle base URL (typically `https://oracle.daatan.com`) |
| `ORACLE_API_KEY` | ✅ | — | Shared `x-api-key` for the Oracle; canonical copy at `openclaw/oracle-api-key` (legacy naming — OpenClaw is decommissioned, prefix retained for back-compat) |
| `NEWS_INDEXER_SECRET` | ✅ | — | Inbound: shared secret validating the news-indexer → Daatan freshness push (`x-news-indexer-secret`) |
| `NEWS_INDEXER_URL` | ✅ | — | Outbound: news-indexer base URL (e.g. `https://scrapper.daatan.com`) for the admin **Sources** panel + article matching |
| `NEWS_INDEXER_API_KEY` | ✅ | — | Outbound: `x-api-key` Daatan sends to the news-indexer service |
| `GA_MEASUREMENT_ID_PROD` | ✅ | — | Google Analytics 4 — production |
| `GA_MEASUREMENT_ID_STAGING` | ✅ | — | Google Analytics 4 — staging |
| `TELEGRAM_BOT_TOKEN` | ✅ | ✅ | @DaatanClawBot token |
| `TELEGRAM_CHAT_ID` | ✅ | ✅ | "Daatan Updates" channel ID |
| `BOT_RUNNER_SECRET` | ✅ | ✅ | Shared secret for `POST /api/bots/run` |
| `CRON_SECRET` | ✅ | ✅ | Shared secret for `/api/cron/cleanup` |
| `RESEND_API_KEY` | ✅ | — | Email delivery |
| `EMAIL_FROM` | ✅ | — | Default From: address |
| `VAPID_PRIVATE_KEY` | ✅ | — | Web Push signing key (runtime-only) |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | — | ✅ | Web Push subscription key. **GitHub secret only** — `NEXT_PUBLIC_*` is substituted into the bundle at build, so a copy in the Secrets Manager bundle would be silently ignored at runtime (see the VAPID section below) |
| `AWS_ROLE_ARN` | — | ✅ | OIDC role the `deploy.yml` workflow assumes to reach ECR + SSM |

The three mandatory `GOOGLE_VERTEX_*` vars are **all-or-nothing**: set all three or none. A partial set registers a Vertex leg that fails every call and burns a retry before the chain falls through to the Developer-API key. See [docs/LLM_ARCHITECTURE.md](docs/LLM_ARCHITECTURE.md).

If this table drifts from reality, the canonical cross-check is `scripts/blue-green-deploy.sh` (`ENV_ARGS`) and `docker-compose.{prod,staging}.yml`, which are gated by CI via `scripts/check-env-parity.sh`.

### Location on the server

**File:** `/home/ubuntu/app/.env` (owner `ubuntu`, mode `600`).

**Access:** **AWS SSM only** — port 22 is closed on both instances (see [INFRASTRUCTURE_SPLIT.md](./INFRASTRUCTURE_SPLIT.md)).

```bash
# Production
aws ssm start-session --target i-04ea44d4243d35624

# Staging
aws ssm start-session --target i-0406d237ca5d92cdf
```

Once inside a session, `sudo -u ubuntu -i` and `cat ~/app/.env`. Do **not** attempt `ssh -i …` — the key files referenced in historical runbooks are no longer active and port 22 is blocked at the security group.

---

## Best Practices (Current)

### 1. File Permissions

```bash
# Ensure .env is not readable by others
chmod 600 ~/app/.env

# Verify permissions
ls -la ~/app/.env
# Should show: -rw------- (600)
```

### 2. Never Commit Secrets

```bash
# .gitignore already includes:
.env
.env.local
.env.production
```

### 3. Rotate Secrets Regularly

**Recommended schedule:**
- `NEXTAUTH_SECRET`: Every 90 days
- `GOOGLE_CLIENT_SECRET`: When compromised or annually
- `POSTGRES_PASSWORD`: Every 180 days
- `GOOGLE_VERTEX_PRIVATE_KEY`: When compromised or annually (mint a new service-account key, then delete the old one in IAM)

**Rotation process:**
1. Generate new secret
2. Update `.env` on server
3. Restart affected containers
4. Verify services work
5. Update backup/documentation

### 4. Backup Secrets Securely

**DO:**
- Store encrypted backup in password manager (1Password, Bitwarden)
- Keep offline backup in secure location
- Document secret purpose and rotation date

**DON'T:**
- Email secrets
- Store in Slack/Discord
- Commit to git
- Share via unencrypted channels

---

## Updating a Secret

The canonical flow is: update the Secrets Manager bundle → redeploy → on-disk `.env` is refreshed by `fetch-secrets.sh`. Do **not** edit `~/app/.env` on the instance as the primary source: it will be overwritten on the next deploy.

```bash
aws secretsmanager get-secret-value \
  --secret-id daatan-env-prod --region eu-central-1 \
  --query SecretString --output text > /tmp/daatan-env-prod.env

# Edit /tmp/daatan-env-prod.env

aws secretsmanager put-secret-value \
  --secret-id daatan-env-prod --region eu-central-1 \
  --secret-string file:///tmp/daatan-env-prod.env

rm /tmp/daatan-env-prod.env
```

Then redeploy (tag `v*` for prod, push to `main` for staging) — or, if you need the new value live without a redeploy, SSM in and `docker restart daatan-app` (prod) / `daatan-app-staging` (staging) after manually running `./scripts/fetch-secrets.sh production` (or `staging`) from `~/app/`.

For the shared `ORACLE_API_KEY` specifically, also update the canonical copy at `openclaw/oracle-api-key` in the retro account (legacy prefix — see note above) so the retro EC2 (`oracle-api.service`) stays in sync.

---

## VAPID Keys (Browser Push Notifications)

VAPID keys authenticate our server when sending Web Push notifications. Two keys are required:

| Key | Where set | Notes |
|-----|-----------|-------|
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | **GitHub Actions secret only** | `NEXT_PUBLIC_*` is substituted into the bundle by `next build`. Setting it in the container's environment does nothing |
| `VAPID_PRIVATE_KEY` | Secrets Manager bundle only | Read from the environment at runtime; never exposed to the client |

There is also a `VAPID_PUBLIC_KEY` GitHub secret. **Nothing reads it** — no workflow, script or
source file references it. It is a leftover from an earlier rotation; the key the build actually
uses is `NEXT_PUBLIC_VAPID_PUBLIC_KEY`. Do not treat `VAPID_PUBLIC_KEY` as authoritative.

> ⚠️ **The two keys reach the app through different channels, so they drift silently.**
> The public key is frozen into the image at **build** time; the private key is read from
> the environment at **run** time. Rotate one without the other and both stay individually
> valid but mutually useless — the server signs with a key no browser ever subscribed
> against, and **every** push send fails VAPID auth (401/403). Nothing else surfaces this.
>
> Two consequences:
> - **A `docker restart` can never change the public key.** Only a rebuild can. Any rotation
>   procedure that ends in "refresh `.env` and restart" will leave push silently broken.
> - **Do not put `NEXT_PUBLIC_VAPID_PUBLIC_KEY` in the Secrets Manager bundle.** A copy there
>   is inert, but it looks authoritative and is the reason the 2026-03-05 rotation broke push
>   for four months without anyone noticing.
>
> The app guards against this: `src/instrumentation.ts` derives the public key from
> `VAPID_PRIVATE_KEY` at boot and logs an error if it does not match the compiled-in public
> key. **If you see that error in the app logs, push is completely broken — do not ignore it.**

**Generating new keys:**
```bash
npx web-push generate-vapid-keys
# Outputs:
# Public Key:  Bxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
# Private Key: xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

**After generating — do all three, in order. Skipping any one of them breaks push:**
1. Update `NEXT_PUBLIC_VAPID_PUBLIC_KEY` in GitHub Actions secrets (Settings → Secrets → `NEXT_PUBLIC_VAPID_PUBLIC_KEY`) so new image builds pick up the new **public** key.
2. Update `VAPID_PRIVATE_KEY` — and **only** the private key — in `daatan-env-prod` and `daatan-env-staging` in AWS Secrets Manager (see "Updating a Secret" above).
3. **Rebuild and redeploy.** A restart is not sufficient: the public key is compiled into the image, so it only changes when a new image is built.

**Verify the rotation actually landed** (this is the step whose absence let the 2026-03-05
rotation break push undetected). After the deploy, confirm the boot-time keypair check is
silent — any output here means push is broken:

```bash
aws ssm send-command --instance-ids i-04ea44d4243d35624 \
  --document-name AWS-RunShellScript \
  --parameters 'commands=["docker logs daatan-app 2>&1 | grep -i \"not a matching keypair\""]'
```

**Key rotation (if push subscriptions break):**
- All existing push subscriptions become invalid after key rotation — users must re-subscribe
- The client re-subscribes automatically on next page load (service worker checks the public key)
- Rotate only when the private key is compromised; otherwise leave keys unchanged

---

## VAPID Key Rotation Runbook

### When to Rotate VAPID Keys

**Planned rotation:** Annually (as preventative security measure)
**Emergency rotation:** If private key is compromised

### Grace Period Strategy (Zero Subscription Loss)

VAPID keys are public-private keypairs. Unlike session tokens, rotating them requires clients to re-subscribe — but we can minimize disruption:

1. **Stage 1: Deploy new keys (no impact yet)**
   - Generate new keypair
   - Update `.env` with both old and new private keys (as `VAPID_PRIVATE_KEY_OLD`)
   - Update GitHub secret and deploy without restarting app
   - No client impact yet — app still uses old key to accept subscriptions

2. **Stage 2: Accept both old and new subscriptions (72-hour grace period)**
   - Modify service worker to accept subscriptions for BOTH public keys
   - Update frontend to prompt users to re-enable notifications if they have old subscription
   - Log which subscriptions use which key for monitoring
   - Duration: 72 hours (gives users time to update)

3. **Stage 3: Send push with new key only (after grace period)**
   - After 72 hours, delete `VAPID_PRIVATE_KEY_OLD` from `.env`
   - Restart app to use only new key
   - Delete old subscriptions from database (optional cleanup)
   - Monitor for subscription failures

### Step-by-Step Runbook

**Prerequisites:**
- Notify team via Slack that VAPID rotation is happening
- Schedule rotation during low-traffic period (e.g., Friday evening UTC)

**Stage 1: Generate and Deploy New Keys (Day 0)**

```bash
# Generate new keypair
npx web-push generate-vapid-keys

# Copy the Public and Private keys from output
# Public Key:  <NEW_PUBLIC>
# Private Key: <NEW_PRIVATE>
```

Update the Secrets Manager bundle (prod example — repeat for staging):
```bash
# Pull, edit, push back (see "Updating a Secret" above for full flow)
aws secretsmanager get-secret-value --secret-id daatan-env-prod \
  --region eu-central-1 --query SecretString --output text > /tmp/env.prod

# Edit /tmp/env.prod — set the new VAPID_PRIVATE_KEY and keep
# VAPID_PRIVATE_KEY_OLD=<OLD_PRIVATE> for the grace period.
#
# Do NOT add NEXT_PUBLIC_VAPID_PUBLIC_KEY here — it is a build-time value and a
# copy in this bundle is inert. It belongs in GitHub Secrets only (see below).

aws secretsmanager put-secret-value --secret-id daatan-env-prod \
  --region eu-central-1 --secret-string file:///tmp/env.prod
rm /tmp/env.prod
```

Update GitHub Secrets:
- Go to repo Settings → Secrets and variables → Actions
- Edit `NEXT_PUBLIC_VAPID_PUBLIC_KEY` with `<NEW_PUBLIC>`
- Commit a no-op change to trigger CI/CD (e.g., update ROTATION_DATE in `.env.example`)
- Verify build succeeds but **do not restart containers yet**

**Stage 2: Accept Both Keys (72-hour grace period)**

Update `src/app/layout.tsx` (or wherever service worker registers):
```tsx
// Register service worker to accept both old and new public keys
const register = async () => {
  if ('serviceWorker' in navigator) {
    const registration = await navigator.serviceWorker.register('/sw.js')
    // Check which public key was used for existing subscriptions
    const subscription = await registration.pushManager.getSubscription()
    if (subscription && !subscription.endpoint.includes('<NEW_PUBLIC>')) {
      // Prompt user to re-enable notifications
      console.warn('Old VAPID key detected — re-subscribing')
      await subscription.unsubscribe()
      await registration.pushManager.subscribe({...}) // re-subscribe with new key
    }
  }
}
```

Redeploy (tag `v*` for prod, push to `main` for staging) so the new image is built with the new public key and the runtime reloads the new private key. To force without a full deploy:
```bash
aws ssm start-session --target i-04ea44d4243d35624   # prod; staging: i-0406d237ca5d92cdf
sudo -u ubuntu -i
cd ~/app && ./scripts/fetch-secrets.sh production    # or staging
docker restart daatan-app                            # or daatan-app-staging
```

Verify notifications still work:
- Test push notification from admin panel
- Check server logs for subscription errors
- Monitor Sentry for WebPush failures

Document grace period end date:
- Add to Slack reminder: "VAPID grace period ends on [DATE]"
- Update calendar with Phase 3 date

**Stage 3: Cleanup (After 72 hours)**

Remove old key from the Secrets Manager bundle, then redeploy:

```bash
# Pull, delete VAPID_PRIVATE_KEY_OLD line, push back
aws secretsmanager get-secret-value --secret-id daatan-env-prod \
  --region eu-central-1 --query SecretString --output text > /tmp/env.prod
sed -i '/^VAPID_PRIVATE_KEY_OLD=/d' /tmp/env.prod
aws secretsmanager put-secret-value --secret-id daatan-env-prod \
  --region eu-central-1 --secret-string file:///tmp/env.prod
rm /tmp/env.prod
```

Redeploy. (**Not** `fetch-secrets.sh` + `docker restart` — that cannot change the compiled-in
`NEXT_PUBLIC_VAPID_PUBLIC_KEY`, and will leave push silently broken.) Verify no WebPush failures:

```bash
aws ssm start-session --target i-04ea44d4243d35624
sudo -u ubuntu -i
docker logs daatan-app 2>&1 | grep -iE "webpush|subscription"
```

Clean up database (optional):
```sql
-- Delete expired subscriptions (older than grace period)
DELETE FROM "push_subscriptions"
WHERE "createdAt" < NOW() - INTERVAL '72 hours'
  AND "endpoint" NOT LIKE '%new_key_endpoint%';
```

Backup new keys:
```bash
# Add to password manager with rotation date
VAPID_PUBLIC_KEY: <NEW_PUBLIC>
VAPID_PRIVATE_KEY: <NEW_PRIVATE>
Rotated: [DATE]
```

Notify team:
- Post in Slack: "✅ VAPID key rotation complete — no user action required"
- Update SECRETS.md last rotation date

### Monitoring During Grace Period

Check for failed subscriptions:
```bash
docker logs daatan-app | grep -E "PushSubscriptionChangeEvent|failed.*subscription" | tail -20
```

Monitor push notification success rate:
- Check app metrics dashboard for push delivery success %
- Alert if success rate drops below 95%

### Rollback Procedure (if issues occur)

If push notifications fail during grace period, swap the old and new keys back in the Secrets Manager bundle (`VAPID_PRIVATE_KEY = <OLD_PRIVATE>`, drop the `_OLD` line) and redeploy or force-refresh via SSM as above. Notify the team.

### Timeline Reference

| Phase | Duration | Action | Impact |
|-------|----------|--------|--------|
| **Stage 1** | 1 hour | Generate keys, deploy to GitHub/server | None — app still uses old key |
| **Stage 2** | 72 hours | Accept both keys, grace period | Users see re-enable prompt, transparent to most |
| **Stage 3** | 1 hour | Delete old key, cleanup | No impact — grace period complete |

### FAQ

**Q: Why do we need a grace period?**
A: VAPID subscriptions are client-side objects that store the public key used to subscribe. Rotating the key invalidates all existing subscriptions. Without a grace period, users would lose notifications until they manually re-enable. With grace period, the service worker detects stale subscriptions and re-subscribes automatically in the background.

**Q: Will users see a re-enable prompt?**
A: Only if their browser permission state is "default" (not explicitly granted). Most users grant permission once and forget, so they won't see anything. If they see a re-enable prompt, a single click fixes it.

**Q: Can we rotate without disrupting subscriptions?**
A: No — VAPID keys are cryptographically linked to subscription payloads. Once rotated, all old subscriptions are cryptographically invalid. The grace period just minimizes perceived disruption.

**Q: What if we forget to update GitHub Secret?**
A: The next CI build will fail at `next build` step (NEXT_PUBLIC_VAPID_PUBLIC_KEY will be undefined). App won't build. Update the secret and re-trigger CI.

**Q: How often should we rotate?**
A: Annually as preventative measure. Emergency rotation only if private key is leaked.

### Google Client Secret Rotation
**When:** if `invalid_client` errors appear in logs or the Google Cloud Console client integrity is compromised.
1. **Generate new secret** in Google Cloud Console → Credentials → OAuth 2.0 Client IDs → Reset Secret.
2. **Update both Secrets Manager bundles** (`daatan-env-prod`, `daatan-env-staging`) following "Updating a Secret" above.
3. **Redeploy** both environments (or SSM + `fetch-secrets.sh` + `docker restart` for a fast-path).

---

## Remaining gaps

- The app still reads env vars from the in-container process environment (originally sourced from `~/app/.env`), not directly from Secrets Manager at runtime. Rotations require a redeploy or SSM + `fetch-secrets.sh` + `docker restart` to take effect.
- No automated rotation (e.g. Lambda-driven password rotation for Postgres). Done manually on the schedule above.
- The `production` → `daatan-env-prod` alias inside `fetch-secrets.sh` is load-bearing — if you ever add a new deploy env, extend the `case` statement in that script.

---

## Emergency Procedures

### If Secrets Are Compromised

**Immediate actions (within 1 hour):**
1. Rotate all affected secrets
2. Review access logs for unauthorized access
3. Check for data exfiltration
4. Notify team

**Follow-up actions (within 24 hours):**
1. Conduct security audit
2. Update all documentation
3. Review and improve security practices
4. Consider migrating to Secrets Manager

### If Server Is Compromised

**Immediate actions:**
1. Isolate server (security group rules)
2. Rotate ALL secrets
3. Take snapshot for forensics
4. Deploy new clean server
5. Restore from known-good backup

---

## Secrets Checklists

### Adding a new secret

1. Add to `.env.example` with a placeholder value and a short comment.
2. Document it in the "What We Use" table above.
3. Reference it in `docker-compose.prod.yml` + `docker-compose.staging.yml` and in `ENV_ARGS` of `scripts/blue-green-deploy.sh` (the `scripts/check-env-parity.sh` CI step will shout if one is missing).
4. Also add it to `src/env.ts` if the app code needs to read it.
5. Append it to both `daatan-env-prod` and `daatan-env-staging` Secrets Manager bundles (see "Updating a Secret").
6. Deploy to staging first, verify in logs, then tag a release for production.

### Rotating a secret

1. Generate the new value at its source of truth (provider dashboard, `openssl rand -hex 32`, etc.).
2. Update both `daatan-env-prod` and `daatan-env-staging` bundles.
3. Deploy (preferred) or force-refresh via SSM + `fetch-secrets.sh` + `docker restart`.
4. Verify `/api/health` returns `200`; spot-check the affected feature.
5. Record the rotation date in your password manager.

---

## FAQ

**Q: Why not use GitHub Secrets for everything?**
A: GitHub Secrets are visible to Actions workflows and shouldn't carry runtime API keys. We use them only for values needed during the deploy workflow itself (`AWS_ROLE_ARN`, Telegram notifications) or baked into the build image (`NEXT_PUBLIC_VAPID_PUBLIC_KEY`).

**Q: How do I add a new secret?**
A: See the checklist above — short version: `.env.example` + compose + blue-green + `src/env.ts` + both Secrets Manager bundles, then deploy.

**Q: What if I accidentally commit a secret?**
A:
1. Rotate it immediately.
2. Remove from git history (`git filter-repo` or BFG Repo-Cleaner). Coordinate with the team — force-push is required.
3. Update both Secrets Manager bundles with the new value.
4. Redeploy.
5. Notify the team.

---

## Resources

- [AWS Secrets Manager Pricing](https://aws.amazon.com/secrets-manager/pricing/)
- [OWASP Secrets Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html)
- [12-Factor App: Config](https://12factor.net/config)
- [HashiCorp Vault](https://www.vaultproject.io/)

---

Last updated: June 24, 2026
