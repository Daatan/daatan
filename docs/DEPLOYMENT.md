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
| Staging     | https://staging.daatan.com | Push to `main`       | this run's digest | `i-0406d237ca5d92cdf`   |
| Production  | https://daatan.com         | Git tag `v*`         | digest of `X.Y.Z`, built on `main` (never rebuilt) | `i-04ea44d4243d35624`   |

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
- CI builds **two** Docker images and pushes them to ECR (tags `sha-<commit>`, `X.Y.Z`, `staging-latest`):
  - the production-slim app image
  - the full-node_modules migrations image (same tags with a `-migrations` suffix)
- The staging environment is updated automatically, pulling the images **by digest**
- This is the only build of that commit: a later `v*` tag ships these exact images
- Monitor: https://staging.daatan.com/api/health

### 3. Release to production

When staging looks good, push a version tag:

```bash
git checkout main && git pull
git tag vX.Y.Z        # the version in package.json
git push origin vX.Y.Z
```

(`./scripts/release.sh` does the same interactively and also creates the GitHub release.)

The tag push does **not** rebuild anything or redeploy staging. It runs the tests, then:
1. `resolve-release` waits for this commit's `main` run to finish `Deploy to Staging`
   successfully (up to 30 min)
2. `deploy-production` checks that ECR's `X.Y.Z` / `X.Y.Z-migrations` are the images built
   from this commit (`sha-<commit>` digests), pulls those digests and runs the full blue-green deploy on production

So tag a `main` commit whose staging deploy succeeded — normally the current HEAD. A commit
whose `main` build was cancelled by a newer merge was never on staging and cannot be released.

> **Version**: `package.json`'s `version` field is the only place it's edited.
> `src/lib/version.ts` reads it at runtime via `NEXT_PUBLIC_APP_VERSION` — no
> comment to keep in sync there.

---

## Version Management

- **Single source of truth**: `package.json` → `version` field
- **Runtime value**: `NEXT_PUBLIC_APP_VERSION` build arg (set by CI from `package.json`), read by `src/lib/version.ts`
- **Pre-commit hook**: `scripts/check-version-bump.sh` — verifies the branch's `package.json` version advances past `origin/main`'s

### Bump commands

```bash
npm version patch --no-git-tag-version   # 1.30.8 → 1.30.9  (bug fixes, small changes)
npm version minor --no-git-tag-version   # 1.30.9 → 1.31.0  (new features)
npm version major --no-git-tag-version   # 1.31.0 → 2.0.0   (breaking changes)
```

`--no-git-tag-version` matters: plain `npm version` also creates a commit **and a `v*` git
tag**, and pushing a `v*` tag is a production deploy. The bump is required on every commit on
a non-`main` branch (see [VERSIONING.md](../VERSIONING.md)); CI's `Version bump` check
(`.github/workflows/version.yml`) re-runs `check-version-bump.sh` on each PR.

---

## CI/CD Pipeline (`deploy.yml`)

### Jobs

```
typecheck ─┐
lint ──────┼──► build ──┬──► build-app-image ────────┬──► deploy-staging ──► deploy-production
unit-test* ┘            └──► build-migrations-image ─┘    (push to main,       (tag push v* only)
                                                           and tag push v*)

unit-test*  = `unit-test` on PRs (related tests only, scripts/run-related-tests.sh)
              or `unit-test-full` on push/tag (full suite, 4 shards)

integration   (independent, on all pushes and PRs — runs
               `npm run test:integration` against the dockerized
               test postgres from docker-compose.test.yml)
```

The image builds and deploys are skipped on PRs. The `Version bump` check is a separate
workflow (`.github/workflows/version.yml`).

### `build` job

1. Build Next.js app with a dummy DB URL — **PRs only** (on push/tag the Docker build does it)
2. Security audit (`npm audit --audit-level=critical`)
3. Check env var parity between `blue-green-deploy.sh` and `docker-compose.prod.yml`
   (`scripts/check-env-parity.sh` — extracts `-e KEY` tokens from `blue-green-deploy.sh`'s
   `ENV_ARGS` bash array and compares against the compose file's `environment:` block per
   service; doesn't catch a var missing from *both*, only drift between them)
4. Resolve `NEXT_PUBLIC_APP_VERSION` (tag name on `v*` pushes, else `package.json`) — baked into the image, so a tag must match `package.json`'s version at the tagged commit

### `build-app-image` / `build-migrations-image` jobs

Run in parallel after `build`, on `main` pushes and staging dispatches only — **never on `v*` tags**
(daatan#1954: tag rebuilds overwrote `staging-latest` and raced the main deploy, putting an older
commit on staging; they also meant production ran bytes staging never saw):
- **app image** (`sha-<commit>`; on `main` also `staging-latest` and `X.Y.Z` = `package.json`'s
  version) — the only one that writes the BuildKit cache
- **migrations image** (the same tags with `-migrations`, `migrations` Dockerfile target) — reads
  the cache only

Both jobs output the pushed digest; deploys pull by digest, not by tag.

### `deploy-staging` job

1. Configure AWS credentials (OIDC)
2. Wake staging if asleep (see [Staging sleep schedule](#staging-sleep-schedule)) and wait for SSM `Online`
3. SSM command to server:
   - Download deploy scripts from GitHub
   - Pull the app and migrations images **by the digests this run pushed**
   - Run `blue-green-deploy.sh staging` with `EXPECTED_VERSION` set (checked before the swap and in Phase 7)
4. Poll command status (via `.github/actions/ssm-deploy`)
5. Verify `https://staging.daatan.com/api/health` reports correct version
6. Send Telegram notification

### `resolve-release` job (tag / production dispatch)

1. Resolve the version from the tag (or the required `version` input on a production dispatch)
2. **Tag only:** wait (up to 30 min) for this commit's `main` run to finish `Deploy to Staging`
   successfully. Fails if it failed, was cancelled or superseded by a newer merge — tag the
   current `main` HEAD instead. Does not touch staging itself, so weekend releases work while
   staging sleeps. Needs no AWS credentials.

### `deploy-production` job (`environment: production`)

1. Configure AWS credentials (the OIDC role trusts only `main` and this environment)
2. Look up the ECR digests of `X.Y.Z` and `X.Y.Z-migrations`; on a tag, require they equal
   `sha-<commit>` / `sha-<commit>-migrations` (i.e. the images built from this very commit)
3. Check EC2 SSM health (`Environment=prod` instance)
4. SSM command:
   - Pull the app and migrations images by those digests
   - Run `blue-green-deploy.sh production` with `EXPECTED_VERSION` set
5. Poll + verify (via `.github/actions/ssm-deploy`)
6. Send Telegram notification (to `TELEGRAM_CLEAN_CHAT_ID`, falling back to `TELEGRAM_CHAT_ID`)

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
Phase 1b Certbot     docker compose up -d certbot (re-asserts the TLS renewal loop; non-fatal)
Phase 2  Skip build  (SKIP_BUILD=true, image pre-pulled)
Phase 3  Start new   daatan-app-staging-new  (no alias, no traffic)
Phase 4  Health ✓    wget 127.0.0.1:3000/api/health inside new container
                     (+ version == $EXPECTED_VERSION when set — a wrong image never gets traffic)
Phase 4b Dump        if `prisma migrate status` ≠ up to date: pg_dump → ~/app/backups/pre-migrate/
                     (dump fails or looks truncated → abort, old container untouched)
Phase 5  Migrate     docker run --rm daatan-migrations:staging-latest  ← isolated
Phase 6  Swap        alias moves: nginx now resolves to new container
Phase 7  Verify      verify-health.sh https://staging.daatan.com (+ $EXPECTED_VERSION)
Phase 8  Auth ✓      curl https://staging.daatan.com/api/auth/providers
         Rollback?   if Phase 7 fails → restart the old image (by image ID), swap back
                     (Phase 8 failure: exit 1 — no rollback)
```

**Zero-downtime guarantee**: old container serves all traffic until Phase 6. Phases 3–5
run in parallel with live traffic. If anything in Phases 3–5 fails, the old container
is untouched and the new container is removed.

### Memory budget of the app container (since #1725)

The app is started by a bare `docker run` in `scripts/blue-green-deploy.sh` (both the
Phase 3 start and the rollback), **not** by `docker-compose.prod.yml` — resource limits
must live in the script or they silently never apply. Both `docker run` calls pass:

| Setting | Value | Why |
|---|---|---|
| `NODE_OPTIONS=--max-old-space-size=1280` | 1280 MB heap | V8 sizes its default heap limit from **host** RAM (2108 MB on the 3.7 GiB prod box, shared with the `elections` container and postgres). With the cap V8 collects earlier and a runaway dies with a heap-OOM trace instead of dragging the host into an hour of page-cache thrash. |
| `--memory 2g --memory-swap 2g` | cgroup hard limit, no swap | A runaway kills only this container. Equal swap value keeps it off swap should the host get some (#1726). |
| `--memory-reservation 1g` | soft limit | Kernel reclaims from this container first under host pressure. |

Sized from measurements: fresh container ~380 MB RSS, day-old plateau ~1.4 GB, bursts
to ~1.85 GB under scanner traffic. `/api/health` now returns `memory` (rss, heapUsed,
heapTotal, heapLimit, external in MB) and the app logs the same once a minute
(`[memory] process.memoryUsage`), so the plateau question can be answered from logs.

These land on prod only with the next tagged release (the script runs at deploy time);
until then the same cgroup limits can be applied to a running container with
`docker update --memory 2g --memory-swap 2g --memory-reservation 1g daatan-app`
(non-disruptive) — the heap cap needs a container recreate.

nginx pairs this with a `page_limit` zone on `location /` of daatan.com and
elections.daatan.com (`infra/nginx/nginx-prod-ssl.conf`: 120 r/m, burst 200, 429 on
excess; `/_next/static/` is outside the budget). A backup-file scanner sent 4 078
requests in 3 min on 2026-09-04, each a full root-layout render of a 404, and that was
the burst behind one of the kills.

**Swap (proposal 2)**: `terraform/ec2.tf`'s prod `user_data` now provisions a 2 GiB
swapfile on first boot — a shock absorber, not a leak fix, so `prod-ec2-swap-high`
(≥25% for 15 min, `terraform/monitoring.tf`) gets a chance to fire as an early warning
instead of the box going straight from healthy to OOM-killed. `ignore_changes = [ami,
user_data]` on that resource means this never touches the already-running prod
instance — to add swap there now, run this once over SSM (`aws ssm send-command`,
document root or the `/ssm` skill):

```bash
if [ ! -f /swapfile ]; then
  sudo fallocate -l 2G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
fi
free -m
```

**Recycle on sustained memory pressure (proposal 5)**: `/api/health` returns HTTP 503
with `status: "memory-pressure"` once RSS crosses 1600 MB (`src/app/api/health/route.ts`)
— below the 2048 MB cgroup limit, above the ~1.4 GB day-old plateau. This alone changes
nothing: Docker's `--restart unless-stopped` restarts on process *exit*, not on a failed
healthcheck. `.github/workflows/watchdog.yml`'s disk-watchdog job (every 5 min) is what
closes the loop — it runs `scripts/check-system-health.sh` over SSM, which reads
`/api/health` from inside the app container (`docker exec … wget`; the app has no published
host port) and, after **2 consecutive** `memory-pressure` readings, issues
`docker restart daatan-app` (`daatan-app-staging` on staging) and posts to Telegram. A
restart sends SIGTERM (graceful, drains in-flight requests) before SIGKILL, well ahead of
the cgroup's hard 2 GiB limit. A plain `degraded` (DB) status never triggers a restart.

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

### Migrations must be expand/contract

Phase 5 migrates the live database **while the old container is still serving traffic**,
and the old container keeps serving for a few more seconds until the Phase 6 swap — or
for good, if Phase 7 auto-rolls back to it. Neither that auto-rollback nor `rollback.yml`
undoes a migration (see `docs/ROLLBACK.md`). So every migration must be safe for the
**previous** release's code to run against:

- **Expand (any release):** add tables, add nullable columns or columns with a default,
  add indexes, add enum values. Old code ignores what it doesn't know about.
- **Contract (a later release):** drop or rename a column/table, add `NOT NULL` to an
  existing column, drop an enum value, tighten a constraint — only after a release that
  no longer reads or writes the old shape has been deployed to production.
- **A rename is three steps:** add the new column and write both (release N), backfill and
  switch reads (N+1), drop the old column (N+2).
- **Long locks block the live app.** Prisma runs each migration file in a transaction, so
  `CREATE INDEX CONCURRENTLY` cannot go in a normal migration; on a large table, put it in
  its own migration file with nothing else in it (it must be the only statement) or build
  the index by hand before the deploy and make the migration `IF NOT EXISTS`.

Reviewers: a migration that drops, renames or narrows something in the same PR that
stops using it is the pattern to reject.

### Pre-migrate DB dump (#1958)

Phase 4b runs `prisma migrate status` in the migrations image. Exit 0 (schema up to date —
most deploys) skips the dump. Anything else (pending migrations, diverged history, DB
unreachable) dumps first:

- **Where:** `~/app/backups/pre-migrate/<env>-<version>-<UTC timestamp>.sql.gz` on the host
  (`pg_dump -U daatan <db> | gzip` via `docker exec` into the postgres container). Staging
  and `next` share the staging DB and the same directory.
- **Retention:** the newest `PRE_MIGRATE_DUMP_KEEP` (default 2) files; older ones are
  pruned before each new dump. Prod's dump is ~1.1–1.5 GB compressed (the size of the S3
  backups), so 2 dumps hold ~3 GB of the 40 GB root volume. Prod already peaks around
  65% during deploys and the disk alarm fires at 85% — raise the count only with disk
  headroom to match. Older restore points live in the S3 backups.
- **Abort, before migrating or swapping traffic, when:** the postgres container can't be
  found; free disk is under twice the previous dump (3 GiB if there is none); `pg_dump`
  exits non-zero; or the result is under 256 KiB or under half the previous dump. The
  half-size guard can trip after a legitimately large data deletion — delete the older
  dumps in the directory and redeploy.
- **Cost:** the status check is one short container run (seconds). The dump itself only
  happens on migration deploys; on prod expect roughly 1–3 min (not yet measured), on
  top of a ~3 min deploy, inside the 10 min wait in `.github/actions/ssm-deploy`.

These are separate from, and do not replace, the twice-daily S3 backups (`backup.yml`).

**Restoring** (writes made between the dump and the restore are lost; prefer a forward
fix or a hand-written down-migration when the data is intact). Over SSM on the host,
production names shown (staging: `daatan-app-staging`, `daatan-postgres-staging`,
DB `daatan_staging`):

```bash
cd ~/app && ls -lt backups/pre-migrate/            # pick the dump taken before the bad deploy
DUMP=backups/pre-migrate/<file>.sql.gz
docker stop daatan-app                              # stop writes (site is down from here)
docker exec daatan-postgres psql -U daatan -d postgres -v ON_ERROR_STOP=1 \
  -c "DROP DATABASE daatan WITH (FORCE)" -c "CREATE DATABASE daatan OWNER daatan"
gunzip -c "$DUMP" | docker exec -i daatan-postgres psql -U daatan -d daatan -v ON_ERROR_STOP=1 -q
docker exec daatan-postgres psql -U daatan -d daatan -c "SELECT count(*) FROM users"
```

Then bring back the version that matches the restored schema. **First re-point the local
migrations tag at that version** — the Rollback workflow does not pull a migrations image,
so its Phase 5 would run the newer `daatan-migrations:latest` and re-apply the very
migrations you just rolled back (the dump's `_prisma_migrations` doesn't list them):

```bash
ECR=272007598366.dkr.ecr.eu-central-1.amazonaws.com
aws ecr get-login-password --region eu-central-1 | docker login --username AWS --password-stdin $ECR
docker pull $ECR/daatan-app:release-X.Y.Z-migrations     # the version you are rolling back to
docker tag  $ECR/daatan-app:release-X.Y.Z-migrations daatan-migrations:latest
```

(Staging: pull `X.Y.Z-migrations` — `release-` tags exist only for prod releases — and tag
it `daatan-migrations:staging-latest`.)

then run the **Rollback** workflow for `X.Y.Z` (`docs/ROLLBACK.md`); its Phase 4b/5 find
the schema up to date. If a collation-sensitive index looks wrong afterwards, see
`docs/DATABASE_COLLATION.md`.

---

## Docker Images

### ECR Repository

- Registry: `272007598366.dkr.ecr.eu-central-1.amazonaws.com`
- Repository: `daatan-app`

### Image Tags

| Tag | Purpose | Built from |
|---|---|---|
| `staging-latest` | Latest `main` app image (informational — deploys pull by digest) | `runner` stage |
| `staging-latest-migrations` | Latest `main` migrations image (informational) | `migrations` stage |
| `X.Y.Z` | Versioned app image, pushed by the `main` build of the commit carrying that `package.json` version; a `v*` tag promotes it, never rebuilds it. Production and rollbacks pull this | `runner` stage |
| `X.Y.Z-migrations` | Versioned migrations image | `migrations` stage |
| `sha-<commit>` | Per-commit reference (7-char SHA); a release checks `X.Y.Z` has the same digest | `runner` stage |
| `sha-<commit>-migrations` | Per-commit migrations reference | `migrations` stage |
| `buildcache` | BuildKit layer cache | — |

### Dockerfile Stages

```
builder  ──► runner      (slim production app image, ~200MB)
         └──► migrations  (full node_modules for prisma CLI, ~700MB)
```

- **`builder`**: Full build environment — `npm ci`, Prisma generate, Next.js build
- **`runner`**: Slim production image — only `.next/standalone`, static files, and runtime node_modules
- **`migrations`**: `FROM builder`, removes `.next/public` — retains full `node_modules` for `prisma migrate deploy`

**Gotcha: dot-prefixed `public/` paths 404 in standalone mode.** Next.js's
`output: 'standalone'` static file server refuses to serve any `public/`
request path with a dot-prefixed path segment (a built-in security
default) — e.g. `public/.well-known/assetlinks.json` returned a live 404
for 4 days (2026-07-21 to 2026-07-25, see
[daatan#1176](https://github.com/Daatan/daatan/issues/1176)) despite being
committed, correct, and passing local `next dev` checks that didn't hit the
standalone runner. Sibling non-dotted `public/` files served fine the whole
time, which is what isolated it. If you ever need to serve another
`.well-known/*` file (Apple's `apple-app-site-association`, `security.txt`,
etc.), don't rely on `public/` — add a `next.config.js` `rewrites()` entry
pointing the dotted path at a normal API route that reads the file from
disk, same pattern as `src/app/api/well-known/assetlinks/route.ts`. Always
verify with a live `curl -sD -` against the deployed URL, not just a local
build — the standalone runner is the only place this bites.

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

### Staging sleep schedule

Staging is **stopped 20:00–06:00 UTC on weekdays and all weekend** by two EventBridge
Scheduler schedules (`terraform/staging_schedule.tf`, #1526) — it idles at ~2% CPU and this
saves ~60% of its compute. The EIP stays attached, so `staging.daatan.com` never changes.

What this means in practice:

- **Merges outside the window still deploy.** `deploy-staging` (and `rollback.yml` for
  staging) starts the instance if it is `stopped` and waits up to 5 min for the SSM agent
  to report `Online` before sending commands — roughly 90 s extra. A `v*` tag release at
  night wakes staging the same way, since `deploy-production` depends on `deploy-staging`.
- The box stays up after a wake-up until the next scheduled stop (20:00 UTC) — there is no
  "stop again after deploy".
- `watchdog.yml` skips its staging probes during the window (until 06:15 UTC to allow for
  boot); the `staging-ec2-status-check-failed` alarm treats missing data as OK for the
  same reason. Production probing and alarms are unchanged.
- Need staging outside hours? `aws ec2 start-instances --instance-ids i-0406d237ca5d92cdf`
  (or just trigger a staging deploy). To pause the schedule without a TF change:
  `aws scheduler update-schedule --name daatan-staging-stop --state DISABLED ...` — but
  prefer a TF change so the state does not drift.

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
in the bundles, the update flow, and rotation runbooks. A few secrets are
instead read at runtime from SSM SecureStrings (`OPENROUTER_API_KEY` per env,
`ORACLE_API_KEY` shared), with the bundle value as fallback — see
[docs/SECRETS.md](./SECRETS.md).

---

## Manual / Emergency Operations

### Manual staging deploy (workflow dispatch)

Go to **Actions → CI/CD Pipeline → Run workflow**, select `staging`.

### Manual production deploy (workflow dispatch)

Go to **Actions → CI/CD Pipeline → Run workflow**, select `production`, enter the
version tag (e.g. `v1.30.9`).

### Rollback production

Preferred: the GitHub Actions **Rollback** workflow (Actions → Rollback → Run workflow),
which redeploys an existing versioned image from ECR, or the Telegram `/rollback` bot that
triggers the same workflow. See `docs/ROLLBACK.md` for both.

Tagging an older commit (`git tag vX.Y.Z <commit-sha> && git push origin vX.Y.Z`) also
works, with two caveats: the tag name must not already exist, and a tag push rebuilds from
that commit and runs `deploy-staging` first — so staging is rolled back to it too.

### Restarting the app on prod — do NOT force-recreate

⚠️ **Never run `docker compose up --force-recreate app` directly on production.**
It recreates the container in-place under live load and can spike CPU/memory — on
2026-05-05 this took daatan.com down for ~22 min and killed the SSM agent for ~20 min.

- **Deploy a new image:** use `scripts/blue-green-deploy.sh production` — the standard,
  health-checked, zero-downtime path.
- **Restart the running container (no rebuild):** `docker compose restart app` (the
  memory-pressure watchdog uses `docker restart daatan-app`). A restart keeps the
  container's original environment — it does **not** pick up a changed `.env`; that takes
  a redeploy (blue-green recreates the container with fresh `-e` values).

### View live logs

Over SSM (the `/ssm` skill in Claude Code, or `aws ssm send-command`):
`docker logs daatan-app --tail 100`. For a quick health check, `curl -s https://daatan.com/api/health`.

### Logs that survive a deploy (CloudWatch)

`docker logs` belongs to the container, and blue-green removes the old container, so its
logs go with it (daatan#1788). The app, nginx and postgres containers therefore also ship to
CloudWatch Logs (`awslogs` driver, `mode=non-blocking`): log group `/daatan/prod/containers`
or `/daatan/staging/containers` (30-day retention, Terraform-owned in `terraform/logging.tf`),
one stream per container instance — `daatan-app/<UTC deploy timestamp>`, `daatan-nginx`,
`daatan-postgres[-staging]`. `docker logs` keeps working (Docker's dual logging).

Logs Insights, across deploys:

```
fields @timestamp, @logStream, @message
| filter @logStream like /daatan-app/
| sort @timestamp desc
| limit 100
```

- The group must exist before a deploy reaches an environment: the flags omit
  `awslogs-create-group` on purpose (a driver-created group has no retention), so a missing
  group makes `docker run` fail at container start, before the old container is touched.
- The rollback `docker run` uses bounded `json-file` instead of `awslogs`, so a log-driver
  problem can never leave the site with no container.
- Postgres and nginx pick up a changed `logging:` block automatically: Phase 1 runs
  `compose up -d <db>` and Phase 1c runs `compose up -d --no-deps nginx` on every deploy.
  Both are no-ops unless that service's compose config changed; when it did, the container is
  recreated (postgres: seconds of DB restart; nginx: seconds of 502s). `--no-deps` matters:
  nginx `depends_on: app`, and the app is started by `docker run`, not by compose.

---

## Required Secrets

**GitHub Actions secrets** (referenced as `secrets.*` in `.github/workflows/`):

| Secret                         | Used by                              |
|--------------------------------|--------------------------------------|
| `AWS_ROLE_ARN`                 | OIDC auth for all AWS operations — the role (`terraform/oidc_github.tf`) only trusts runs on `main` and jobs in the `production` environment, and may `SendCommand` only to the prod, staging and Oracul instances; a workflow run from any other branch gets no AWS credentials |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | Baked into Docker image at build     |
| `TELEGRAM_BOT_TOKEN`           | Deploy success/failure notifications |
| `TELEGRAM_CHAT_ID`             | Deploy notifications target          |
| `TELEGRAM_CLEAN_CHAT_ID`       | Prod deploy notifications + high-signal workflow alerts (falls back to `TELEGRAM_CHAT_ID`) |
| `BOT_RUNNER_SECRET`            | Bot + cron triggers (`bots.yml`, `heartbeat.yml` and the other `/api/cron/*` workflows — all validate against the app's `BOT_RUNNER_SECRET`) |
| `STAGING_URL`                  | Bot cron + heartbeat target URL (staging) |
| `GSC_SA_KEY`, `YWM_OAUTH_TOKEN`, `CRUX_API_KEY` | SEO report (`seo-report.yml`) |
| `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_PASSWORD` | Android release signing (`android-release.yml`) |

There is no `CRON_SECRET` GitHub secret and no code reads one (`heartbeat.yml` used to, and
got 401s). An `OPENROUTER_API_KEY` GitHub secret is referenced by no workflow (see
[docs/SECRETS.md](./SECRETS.md)).

**App runtime env** (in the `daatan-env-<env>` bundle, passed to the container by
`blue-green-deploy.sh` — not GitHub secrets):

| Variable                       | Purpose                              |
|--------------------------------|--------------------------------------|
| `INDEXNOW_KEY`                 | IndexNow instant indexing (Bing/Yandex) — optional; omit to disable |
| `TELEGRAM_WEBHOOK_SECRET`      | Shared secret for the Telegram rollback webhook — unset = fail closed |
| `TELEGRAM_ROLLBACK_CHAT_IDS`   | Comma-separated Telegram chat IDs allowed to issue `/rollback` |
| `GH_ROLLBACK_TOKEN`            | GitHub PAT with `actions:write` to trigger the Rollback workflow |
| `TELEGRAM_ADMIN_MAP`           | JSON map of Telegram user id → `User.id` (`{"123":"cuid1"}`) — optional User-link enrichment for the manual number-rating feedback buttons (daatan#1223); voting is open to all channel members, safe to leave unset |
