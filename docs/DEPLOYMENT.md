# Deployment Guide

## Overview

Daatan uses a blue-green deployment strategy on two dedicated AWS EC2 instances —
one for **production** and one for **staging**. Docker images are stored in Amazon ECR.
All server access goes through AWS SSM (no open SSH port).

```
GitHub → CI/CD (GitHub Actions) → ECR → EC2 via SSM → Blue-green swap → Health check
```

---

## Environments

| Environment | URL                        | Trigger              | Image tag         | EC2 Instance            |
|-------------|----------------------------|----------------------|-------------------|-------------------------|
| Staging     | https://staging.daatan.com | Push to `main`       | `staging-latest`  | `i-0406d237ca5d92cdf`   |
| Production  | https://daatan.com         | Git tag `v*`         | `1.30.X`          | `i-04ea44d4243d35624`   |

Each environment has its own EC2 instance, Postgres container, nginx, and SSL certificate.

---

## Standard Release Flow

### 1. Develop on a feature branch

```bash
git checkout -b feat/my-feature
# ... make changes ...
git commit -m "feat: add something"
git push -u origin feat/my-feature
```

### 2. Open and merge a PR

Create a PR targeting `main`. When merged:
- CI builds **two** Docker images and pushes them to ECR:
  - `staging-latest` — the production-slim app image
  - `staging-latest-migrations` — the full-node_modules migrations image
- The staging environment is updated automatically
- Monitor: https://staging.daatan.com/api/health

### 3. Release to production

When staging looks good, push a version tag:

```bash
git checkout main && git pull
git tag v1.30.X
git push origin v1.30.X
```

This triggers the `deploy-production` job which:
1. Verifies staging is running the same version
2. Pulls the versioned app + migrations images from ECR
3. Runs the full blue-green deploy on production

> **Version in `src/lib/version.ts`**: Keep the `// v1.X.Y` comment in sync with
> `package.json`. The pre-commit hook enforces consistency.

---

## Version Management

- **Single source of truth**: `package.json` → `version` field
- **Human hint**: `src/lib/version.ts` contains a `// v1.X.Y` comment that must match
- **Runtime value**: `NEXT_PUBLIC_APP_VERSION` build arg (set by CI from `package.json`)
- **Pre-commit hook**: `scripts/check-version-bump.sh` — verifies the two files agree

### Bump commands

```bash
npm version patch   # 1.30.8 → 1.30.9  (bug fixes, small changes)
npm version minor   # 1.30.9 → 1.31.0  (new features)
npm version major   # 1.31.0 → 2.0.0   (breaking changes)
```

---

## CI/CD Pipeline (`deploy.yml`)

### Jobs

```
build ──┬──► deploy-staging    (on push to main)
        └──► deploy-production (on tag push v*)
```

### `build` job

1. Install dependencies, type-check, lint
2. Run unit tests
3. Build Next.js app (with dummy DB URL)
4. Security audit
5. Check env var parity between `blue-green-deploy.sh` and `docker-compose.prod.yml`
   (`scripts/check-env-parity.sh` — extracts `-e KEY` tokens from `blue-green-deploy.sh`'s
   `ENV_ARGS` bash array and compares against the compose file's `environment:` block per
   service; doesn't catch a var missing from *both*, only drift between them)
6. Build and push **app image** (`staging-latest`) to ECR
7. Build and push **migrations image** (`staging-latest-migrations`) to ECR
   - Reuses all cached layers from step 6 — adds ~30–60s to CI time

### `deploy-staging` job

1. Configure AWS credentials (OIDC)
2. Check EC2 SSM health (`Environment=staging` instance)
3. SSM command to server:
   - Download deploy scripts from GitHub
   - Pull `staging-latest` app image from ECR
   - Pull `staging-latest-migrations` migrations image from ECR
   - Run `blue-green-deploy.sh staging`
4. Poll command status (via `.github/actions/ssm-deploy`)
5. Verify `https://staging.daatan.com/api/health` reports correct version
6. Send Telegram notification

### `deploy-production` job

1. Configure AWS credentials
2. Resolve version from tag name
3. Verify staging version ≥ production target (safety gate)
4. Check EC2 SSM health (`Environment=prod` instance)
5. SSM command:
   - Pull versioned app image (`1.30.X`) from ECR
   - Pull versioned migrations image (`1.30.X-migrations`) from ECR
   - Run `blue-green-deploy.sh production`
6. Poll + verify (via `.github/actions/ssm-deploy`)
7. Send Telegram notification

### Composite action: `.github/actions/ssm-deploy`

Eliminates the duplicate SSM polling loop and health check used by both deploy jobs.
Inputs: `command-id`, `health-url`, `app-version`.

---

## Blue-Green Deployment Flow

```
                        TRAFFIC
                           │
                     daatan-nginx
                           │
              ┌────────────▼────────────┐
              │   daatan-app-staging     │  ← serving traffic (old)
              │   (old container)        │
              └──────────────────────────┘
                           │ Phase 6: alias swap
                           ▼
Phase 1  DB up       postgres-staging (always running)
Phase 2  Skip build  (SKIP_BUILD=true, image pre-pulled)
Phase 3  Start new   daatan-app-staging-new  (no alias, no traffic)
Phase 4  Health ✓    curl 127.0.0.1:3000/api/health inside new container
Phase 5  Migrate     docker run --rm daatan-migrations:staging-latest  ← isolated
Phase 5b Seed        docker exec daatan-app-staging-new node prisma/seed.js
Phase 6  Swap        alias moves: nginx now resolves to new container
Phase 7  Verify      curl https://staging.daatan.com/api/health
Phase 8  Auth ✓      curl https://staging.daatan.com/api/auth/providers
         Rollback?   if Phase 7/8 fails → restart old image, swap back
```

**Zero-downtime guarantee**: old container serves all traffic until Phase 6. Phases 3–5
run in parallel with live traffic. If anything in Phases 3–5 fails, the old container
is untouched and the new container is removed.

### The dedicated migrations container (since v1.8.32)

Migrations no longer run inside the app container. Instead, a dedicated short-lived
container (`daatan-migrations:staging-latest`) is run with `docker run --rm`.

**Why**: Prisma v7's CLI (`@prisma/dev`, `effect`, `pathe`, ~50 deps) requires a full
`node_modules` that is too large to include in the slim production image. The migrations
container is built `FROM builder` and has complete `node_modules`.

**Safety**: The migrations container runs before the traffic swap (Phase 5), connects
to Postgres via the Docker network, applies migrations, then exits. It has no DNS alias
and cannot receive application traffic.

See `docs/PRISMA_MIGRATE_DEPLOY_DEPS.md` for full background.

---

## Docker Images

### ECR Repository

- Registry: `272007598366.dkr.ecr.eu-central-1.amazonaws.com`
- Repository: `daatan-app`

### Image Tags

| Tag | Purpose | Built from |
|---|---|---|
| `staging-latest` | Latest staging app image | `runner` stage |
| `staging-latest-migrations` | Latest staging migrations image | `migrations` stage |
| `1.30.X` | Versioned production app image | `runner` stage |
| `1.30.X-migrations` | Versioned production migrations image | `migrations` stage |
| `sha-<commit>` | Per-commit reference | `runner` stage |
| `buildcache` | BuildKit layer cache | — |

### Dockerfile Stages

```
builder  ──► runner      (slim production app image, ~200MB)
         └──► migrations  (full node_modules for prisma CLI, ~700MB)
```

- **`builder`**: Full build environment — `npm ci`, Prisma generate, Next.js build, seed compilation
- **`runner`**: Slim production image — only `.next/standalone`, static files, and runtime node_modules
- **`migrations`**: `FROM builder`, removes `.next/public` — retains full `node_modules` for `prisma migrate deploy`

---

## Deploy Time

| Scenario | CI time | Server time |
|---|---|---|
| Standard code-only deploy | +30–60s (migrations image) | +5–30s (incremental pull) |
| After `package.json` changes | +30–60s | +1–3 min (npm ci layer) |
| First deploy after PR #620 | +30–60s | +2–5 min (one-time: builder layers pulled) |

---

## Infrastructure

### EC2 Instances

| Role        | Instance ID             | IP               | Tag                   | IAM Role                    |
|-------------|-------------------------|------------------|-----------------------|-----------------------------|
| Production  | `i-04ea44d4243d35624`   | `3.126.238.216`  | `Environment=prod`    | `daatan-ec2-role-prod`      |
| Staging     | `i-0406d237ca5d92cdf`   | —                | `Environment=staging` | `daatan-ec2-role-staging`   |

- **Access**: AWS SSM only — port 22 is closed on both instances
- **SSL**: Each instance has its own Let's Encrypt certificate via `certbot/dns-route53`

---

## Secrets Bootstrap (`fetch-secrets.sh`)

Runtime environment variables are stored in AWS Secrets Manager as two
bundles — `daatan-env-prod` and `daatan-env-staging`, each holding a full
`.env` blob. They are pulled onto the instance at deploy time by
`scripts/fetch-secrets.sh` (called from `scripts/blue-green-deploy.sh`).

**Deploy-env → Secrets Manager name mapping (load-bearing alias):**

| `blue-green-deploy.sh` argument | `fetch-secrets.sh` `ENVIRONMENT` | Secret name |
|---|---|---|
| `production` | `production` | `daatan-env-prod` |
| `staging`    | `staging`    | `daatan-env-staging` |

The `production → prod` rename happens inside `fetch-secrets.sh` via a
`case` statement (historical: Terraform created the secret as
`daatan-env-prod` but the deploy pipeline uses the word `production`
everywhere else). **If you add a new deploy environment, extend the
`case` statement** — otherwise the pull will silently fall back to
the existing `.env` on the server and your new values will never go
live. The fall-back is intentional (so a transient IAM/network blip
doesn't brick a deploy) but it also hides genuine misconfigurations,
so watch the `⚠️ Could not fetch …` line in the deploy log.

```bash
# scripts/fetch-secrets.sh — excerpt
ENVIRONMENT=${1:-prod}
case "$ENVIRONMENT" in
  production) SECRET_SUFFIX="prod" ;;
  *)          SECRET_SUFFIX="$ENVIRONMENT" ;;
esac
SECRET_NAME="daatan-env-${SECRET_SUFFIX}"
```

See [SECRETS.md](../SECRETS.md) for the full list of variables carried
in the bundles, the update flow, and rotation runbooks.

---

## Manual / Emergency Operations

### Manual staging deploy (workflow dispatch)

Go to **Actions → CI/CD Pipeline → Run workflow**, select `staging`.

### Manual production deploy (workflow dispatch)

Go to **Actions → CI/CD Pipeline → Run workflow**, select `production`, enter the
version tag (e.g. `v1.30.9`).

### Rollback production

Tag the previous known-good commit and push:

```bash
git tag v1.30.X <commit-sha>
git push origin v1.30.X
```

There are now two additional rollback paths: the GitHub Actions **Rollback**
workflow (Actions → Rollback → Run workflow) and the Telegram `/rollback` bot for
one-tap operator-initiated rollbacks. See `docs/ROLLBACK.md` for both.

### Restarting the app on prod — do NOT force-recreate

⚠️ **Never run `docker compose up --force-recreate app` directly on production.**
It recreates the container in-place under live load and can spike CPU/memory — on
2026-05-05 this took daatan.com down for ~22 min and killed the SSM agent for ~20 min.

- **Deploy a new image:** use `scripts/blue-green-deploy.sh production` — the standard,
  health-checked, zero-downtime path.
- **Restart the running container (no rebuild):** `docker compose restart app`.

### View live logs

Use the `/logs` slash command in Claude Code, or the `/prod-status` command for a
full health check. See `.claude/commands/` for details.

---

## Required Secrets

| Secret                         | Used by                              |
|--------------------------------|--------------------------------------|
| `AWS_ROLE_ARN`                 | OIDC auth for all AWS operations     |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | Baked into Docker image at build     |
| `TELEGRAM_BOT_TOKEN`           | Deploy success/failure notifications |
| `TELEGRAM_CHAT_ID`             | Deploy notifications target          |
| `BOT_RUNNER_SECRET`            | Bot cron trigger (`bots.yml`)        |
| `CRON_SECRET`                  | Heartbeat cron auth (`heartbeat.yml`) — same value as `BOT_RUNNER_SECRET` in `.env` |
| `STAGING_URL`                  | Bot cron + heartbeat target URL (staging) |
| `OPENROUTER_API_KEY`           | Bot LLM calls (staging only)         |
| `INDEXNOW_KEY`                 | IndexNow instant indexing (Bing/Yandex) — optional; omit to disable |
| `TELEGRAM_WEBHOOK_SECRET`      | Shared secret for the Telegram rollback webhook — unset = fail closed |
| `TELEGRAM_ROLLBACK_CHAT_IDS`   | Comma-separated Telegram chat IDs allowed to issue `/rollback` |
| `GH_ROLLBACK_TOKEN`            | GitHub PAT with `actions:write` to trigger the Rollback workflow |
