# Rollback Runbook

How to quickly restore a working version of Daatan when a bad deploy goes out.

---

## When to roll back

Roll back immediately if you observe any of the following:

- **Redirect loop** — browser shows "too many redirects" or nginx returns HTTP 307/308 in a loop
- **Health check failure** — `/api/health` returns non-200, or the watchdog fires repeatedly
- **Broken auth** — users cannot sign in; `/api/auth/providers` returns empty or errors
- **Crash loop** — container restarts repeatedly; `docker logs daatan-app --tail 50` shows startup exceptions
- **Blank / 500 pages** — key pages are broken for all users, not a data issue
- **Version drift alert** — Telegram reports staging is ahead of production for several hours and the gap is causing user-visible issues

A rollback does **not** fix the underlying bug. It only restores a known-good version while you prepare a proper fix.

---

## Finding the right version to roll back to

**Check what's currently running:**

```bash
curl -s https://daatan.com/api/health | jq .version
curl -s https://staging.daatan.com/api/health | jq .version
```

**List available ECR image tags (most recent 20):**

```bash
aws ecr describe-images \
  --repository-name daatan-app \
  --region eu-central-1 \
  --query 'sort_by(imageDetails,&imagePushedAt)[-20:].imageTags' \
  --output json
```

**Check git log** for what version a commit corresponds to:

```bash
git log --oneline -20
```

Version tags follow semver (e.g. `1.7.140`). ECR stores images tagged with the version number from `package.json` at build time.

---

## Option A: GitHub Actions rollback workflow (preferred)

1. Go to **GitHub → Actions → Rollback**
2. Click **Run workflow**
3. Fill in:
   - **Environment**: `production` or `staging`
   - **Version**: the version number to restore (e.g. `1.7.140`) — must exist in ECR
   - **Reason**: brief description for the Telegram notification (optional)
4. Click **Run workflow**
5. Monitor the run — it will:
   - Verify the ECR image exists before touching the server
   - Pull the image and run `blue-green-deploy.sh` with `SKIP_BUILD=true`
   - Send a Telegram notification on success or failure

Total time: ~5–8 minutes.

### Triggering it from Telegram (`/rollback`)

The same workflow can be started from Telegram with `/rollback 1.7.x` (or
`/rollback staging 1.7.x`), handled by `POST /api/telegram/rollback`.

**The endpoint fails closed.** It only acts on requests carrying the matching
`x-telegram-bot-api-secret-token` header, so it is inert unless
`TELEGRAM_WEBHOOK_SECRET` is set on the app **and** Telegram is configured to send
that secret. With the var unset, every request is rejected — the secret is the
only proof a request genuinely came from Telegram; without it a spoofed `chat_id`
in the body could trigger a production rollback.

One-time setup:

1. Set `TELEGRAM_WEBHOOK_SECRET` to a random value in the app env (prod + staging).
2. Register the webhook so Telegram sends that secret with every update:
   ```bash
   curl -X POST "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook" \
     -d "url=https://daatan.com/api/telegram/rollback" \
     -d "secret_token=<TELEGRAM_WEBHOOK_SECRET>"
   ```
3. Ensure `TELEGRAM_ROLLBACK_CHAT_IDS` lists the allowed chat IDs and
   `GH_ROLLBACK_TOKEN` (a PAT with `actions:write`) is set.

---

## Option B: Manual SSM rollback (when CI is unavailable)

Use this if GitHub Actions is down or the Actions runner cannot reach the instance.

**Via AWS console:**

1. Open AWS Systems Manager → Run Command
2. Document: `AWS-RunShellScript`
3. Target: instance `i-04ea44d4243d35624` (prod) or `i-0406d237ca5d92cdf` (staging)
4. Commands (adjust `VERSION`, `ENV`, and `LOCAL_TAG` as needed):

```bash
set -e
export HOME=/home/ubuntu
export PATH=$PATH:/usr/local/bin:/usr/bin
cd ~/app

VERSION="1.7.140"           # <-- version to restore
ENV="production"            # <-- "production" or "staging"
LOCAL_TAG="daatan-app:latest"  # staging: "daatan-app:staging-latest"
ECR="272007598366.dkr.ecr.eu-central-1.amazonaws.com"
FULL_IMAGE="$ECR/daatan-app:$VERSION"

aws ecr get-login-password --region eu-central-1 | docker login --username AWS --password-stdin "$ECR"
docker pull "$FULL_IMAGE"
docker tag "$FULL_IMAGE" "$LOCAL_TAG"

export GIT_COMMIT="rollback-$VERSION"
export SKIP_BUILD=true
export ECR_REGISTRY="$ECR"
export IMAGE_TAG="$VERSION"
./scripts/blue-green-deploy.sh "$ENV"
```

**Via AWS CLI (from your machine):**

```bash
INSTANCE_ID="i-04ea44d4243d35624"   # prod; use i-0406d237ca5d92cdf for staging
aws ssm send-command \
  --document-name "AWS-RunShellScript" \
  --targets "Key=instanceids,Values=$INSTANCE_ID" \
  --parameters commands='["cd ~/app && export SKIP_BUILD=true && export IMAGE_TAG=1.7.140 && export ECR_REGISTRY=272007598366.dkr.ecr.eu-central-1.amazonaws.com && aws ecr get-login-password --region eu-central-1 | docker login --username AWS --password-stdin $ECR_REGISTRY && docker pull $ECR_REGISTRY/daatan-app:$IMAGE_TAG && docker tag $ECR_REGISTRY/daatan-app:$IMAGE_TAG daatan-app:latest && ./scripts/blue-green-deploy.sh production"]' \
  --region eu-central-1 \
  --output text --query "Command.CommandId"
```

Then poll status:

```bash
aws ssm get-command-invocation \
  --command-id "<COMMAND_ID>" \
  --instance-id "$INSTANCE_ID" \
  --query "{Status:Status,Output:StandardOutputContent}" \
  --region eu-central-1
```

---

## Option C: Auto-rollback (built into blue-green-deploy.sh)

`blue-green-deploy.sh` now auto-rolls back if Phase 7 (external health check) fails after a swap.

Before the traffic swap (Phase 6), the script captures the old container's image:

```bash
OLD_IMAGE=$(docker inspect $CONTAINER --format '{{.Config.Image}}' ...)
```

If `verify-health.sh` fails after the swap, the script:
1. Stops and removes the new (broken) container
2. Starts a fresh container from `$OLD_IMAGE` with the same name and network alias
3. Reloads nginx
4. Exits with code 1 (so CI marks the deploy as failed)

This means a bad deploy will be automatically corrected within seconds of Phase 7 running. The Telegram failure notification will still fire.

Note: auto-rollback only covers Phase 7 failure. Failures in Phase 4 (new container health) or Phase 5 (migrations) abort before any swap occurs — the old container is never touched.

---

## After rollback

1. **Confirm the rollback worked:**
   ```bash
   curl -s https://daatan.com/api/health | jq '{status,version,db}'
   ```
   Version should match the one you rolled back to.

2. **Check nginx is serving correctly:**
   ```bash
   curl -I https://daatan.com
   # Expect: HTTP/2 200, no redirect
   ```

3. **Tell the team** — the broken code is still on `main`. Do not deploy again until the bug is fixed and tested on staging.

4. **Find and fix the root cause** — check container logs:
   ```bash
   # Via SSM or watchdog workflow
   docker logs daatan-app --tail 100
   ```

5. **Create a fix PR**, verify it passes on staging, then re-deploy to production using the normal release process.
