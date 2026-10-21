#!/bin/bash
set -e
SECONDS=0  # phase headers print elapsed time, to attribute deploy duration (daatan#1992)

# DAATAN Blue-Green Deployment Script
# True zero-downtime: builds new container, health-checks it, runs migrations,
# then swaps traffic using Docker network aliases.
#
# How it works:
# 1. Build new image while old container serves traffic
# 2. Start new container with a temporary name (no network alias yet)
# 3. Health-check the new container directly
# 4. Run migrations on the new container (before swap — if they fail, old stays live)
# 5. Swap traffic: disconnect old container's network alias, connect new container
#    with the service alias so nginx resolves to the new container instantly
# 6. Stop old container
#
# Nginx uses variable-based upstream ($upstream_staging / $upstream_prod) with
# Docker DNS resolver (127.0.0.11 valid=30s), so it re-resolves on each request.
# By swapping network aliases, Docker DNS points to the new container immediately.
#
# Usage:
#   ./scripts/blue-green-deploy.sh staging [--no-cache]
#   ./scripts/blue-green-deploy.sh production [--no-cache]

echo "🔵🟢 DAATAN Blue-Green Deployment"
echo "================================="

ENVIRONMENT=${1:-staging}
NO_CACHE_FLAG=""
if [ "$2" = "--no-cache" ]; then
    NO_CACHE_FLAG="--no-cache"
fi

# Select compose file for this environment
if [ "$ENVIRONMENT" = "staging" ] || [ "$ENVIRONMENT" = "next" ]; then
    COMPOSE_FILE="docker-compose.staging.yml"
else
    COMPOSE_FILE="docker-compose.prod.yml"
fi

# Determine container and compose service names
# SERVICE_ALIAS is the DNS name nginx uses to reach the app container
if [ "$ENVIRONMENT" = "staging" ]; then
    SERVICE="app-staging"
    SERVICE_ALIAS="app-staging"
    CONTAINER="daatan-app-staging"
    CONTAINER_NEW="daatan-app-staging-new"
    DB_SERVICE="postgres-staging"
    HEALTH_URL="https://staging.daatan.com"
elif [ "$ENVIRONMENT" = "next" ]; then
    SERVICE="app-next"
    SERVICE_ALIAS="app-next"
    CONTAINER="daatan-app-next"
    CONTAINER_NEW="daatan-app-next-new"
    DB_SERVICE="postgres-staging"
    HEALTH_URL="https://next.daatan.com"
elif [ "$ENVIRONMENT" = "production" ]; then
    SERVICE="app"
    SERVICE_ALIAS="app"
    CONTAINER="daatan-app"
    CONTAINER_NEW="daatan-app-new"
    DB_SERVICE="postgres"
    HEALTH_URL="https://daatan.com"
else
    echo "❌ Unknown environment: $ENVIRONMENT (use 'staging', 'production', or 'next')"
    exit 1
fi

# Ensure we are in the project directory
if [ -d "$HOME/app" ]; then
    cd "$HOME/app"
elif [ -d "/home/ubuntu/app" ]; then
    cd "/home/ubuntu/app"
else
    echo "❌ Could not find app directory in $HOME/app or /home/ubuntu/app"
    exit 1
fi

# Fetch environment variables from AWS Secrets Manager
if [ -f scripts/fetch-secrets.sh ]; then
    chmod +x scripts/fetch-secrets.sh
    ./scripts/fetch-secrets.sh "$ENVIRONMENT"
fi

# Source environment variables
if [ -f .env ]; then
    set -a
    source .env
    set +a
    echo "✅ Loaded env vars from .env"
else
    echo "❌ .env file not found!"
    exit 1
fi

export DEPLOY_ID=$(date +%s)
# GIT_COMMIT should be passed from CI/CD
if [ -z "$GIT_COMMIT" ]; then
    if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
        GIT_COMMIT=$(git rev-parse HEAD)
    else
        echo "⚠️ GIT_COMMIT not set and not in a git repo. Using 'unknown'"
        GIT_COMMIT="unknown"
    fi
fi
export GIT_COMMIT
BUILD_TIMESTAMP=$(date +%s)

echo "Environment:  $ENVIRONMENT"
echo "Service:      $SERVICE"
echo "Container:    $CONTAINER"
echo "Git commit:   ${GIT_COMMIT:0:8}"

# ─── Phase 1: Ensure database is running ───────────────────────────────────────
echo ""
echo "[+${SECONDS}s] 📦 Phase 1: Ensuring database is running..."
docker compose -f $COMPOSE_FILE up -d $DB_SERVICE
# Wait for DB to be ready — check pg_isready instead of sleeping unconditionally
DB_CONTAINER=$(docker compose -f $COMPOSE_FILE ps -q $DB_SERVICE 2>/dev/null | head -1)
for _i in 1 2 3 4 5; do
    docker exec "$DB_CONTAINER" pg_isready -q 2>/dev/null && break || sleep 1
done

# ─── Phase 1b: Ensure TLS cert renewal loop is running ──────────────────────────
# The certbot service runs `certbot renew` on a 12h loop and is what keeps the
# Let's Encrypt cert fresh. Nothing else restarts it — if it stops (manual
# `docker rm`, host reboot, a stray `compose down`) renewals silently halt and
# the cert eventually expires, taking the whole site down over HTTPS (exactly
# the outage on 2026-06-20). Re-assert it on every deploy so a missing renewal
# loop can never outlive a single deploy cycle. Non-fatal: never block a deploy.
echo ""
echo "[+${SECONDS}s] 🔐 Phase 1b: Ensuring TLS cert renewal loop (certbot) is running..."
docker compose -f $COMPOSE_FILE up -d certbot || echo "⚠️  Could not start certbot service (continuing deploy)"

# ─── Phase 1c: Converge nginx with the compose file ─────────────────────────────
# Nothing else ever runs compose for nginx — this script only reloads it — so a
# changed `nginx:` service block (its log driver, #1788) never reached a running box
# without a manual `up -d nginx` over SSM. `up -d` is a no-op unless that service's
# config hash changed, so the usual deploy pays nothing; when it did change, nginx is
# recreated here (a few seconds of 502s) and the deploy continues.
# --no-deps: nginx `depends_on: app`, and the app is started by `docker run` below, so
# without it compose would try to create its own `app` container next to ours.
# Non-fatal: a failure leaves the existing nginx serving.
echo ""
echo "[+${SECONDS}s] 🌐 Phase 1c: Converging nginx with $COMPOSE_FILE..."
docker compose -f $COMPOSE_FILE up -d --no-deps nginx || echo "⚠️  Could not converge nginx (continuing deploy)"

# ─── Phase 2: Build new image (old container still serving traffic) ─────────────
echo ""
echo "[+${SECONDS}s] 🔨 Phase 2: Building new image (old container still serving traffic)..."

echo ""
echo "🧹 Pre-build cleanup: Docker disk usage before prune"
docker system df || true

echo ""
echo "🧹 Pre-build cleanup: pruning unused Docker images to free space..."
docker image prune -f || true
# docker builder prune -af is intentionally omitted: CI deploys use SKIP_BUILD=true
# (images arrive pre-built from ECR), so there is no build cache on the server to prune.
# Running it would destroy BuildKit cache uselessly and takes 10-20 seconds.
# docker volume prune -f || true  <-- DISABLING TO PREVENT DATA LOSS

echo ""
echo "🧹 Pre-build cleanup: Docker disk usage after prune"
docker system df || true

BUILD_ARGS=""
if [ "$ENVIRONMENT" = "staging" ]; then
    BUILD_ARGS="--build-arg DATABASE_URL=postgresql://daatan:${POSTGRES_PASSWORD}@postgres-staging:5432/daatan_staging"
    BUILD_ARGS="$BUILD_ARGS --build-arg NEXTAUTH_URL=https://staging.daatan.com"
else
    BUILD_ARGS="--build-arg DATABASE_URL=postgresql://daatan:${POSTGRES_PASSWORD}@postgres:5432/daatan"
    BUILD_ARGS="$BUILD_ARGS --build-arg NEXTAUTH_URL=https://daatan.com"
fi
BUILD_ARGS="$BUILD_ARGS --build-arg GIT_COMMIT=$GIT_COMMIT"
BUILD_ARGS="$BUILD_ARGS --build-arg BUILD_TIMESTAMP=$BUILD_TIMESTAMP"

# Build the image without stopping the running container
if [ "${SKIP_BUILD}" == "true" ]; then
    echo "[+${SECONDS}s] 🔨 Phase 2: Skipping build (using pre-pulled image)..."

    # Login and Pull if ECR info provided
    if [ -n "$ECR_REGISTRY" ] && [ -n "$IMAGE_TAG" ]; then
        echo "🔐 Logging in to ECR ($ECR_REGISTRY)..."
        # Determine region from registry URL (e.g. 123.dkr.ecr.eu-central-1.amazonaws.com)
        # ECR_REGISTRY is set by deploy.yml env or passed to this script
        REGION=$(echo "$ECR_REGISTRY" | cut -d'.' -f4)
        if [ -z "$REGION" ]; then REGION="eu-central-1"; fi # Fallback to Frankfurt as per docker-compose

        aws ecr get-login-password --region "$REGION" | docker login --username AWS --password-stdin "$ECR_REGISTRY"

        FULL_IMAGE="$ECR_REGISTRY/daatan-app:$IMAGE_TAG"
        echo "⬇️  Pulling image $FULL_IMAGE..."
        docker pull "$FULL_IMAGE"

        echo "🏷️  Tagging image..."
        if [ "$ENVIRONMENT" = "staging" ]; then
             docker tag "$FULL_IMAGE" "daatan-app:staging-latest"
             IMAGE_NAME="daatan-app:staging-latest"
        else
             docker tag "$FULL_IMAGE" "daatan-app:latest"
             IMAGE_NAME="daatan-app:latest"
        fi
    else
        echo "⚠️  ECR_REGISTRY or IMAGE_TAG not set, assuming image exists locally."
        if [ "$ENVIRONMENT" = "staging" ]; then
            IMAGE_NAME="daatan-app:staging-latest"
        else
            IMAGE_NAME="daatan-app:latest"
        fi
    fi
    # Build the image without stopping the running container
    # docker compose -f docker-compose.prod.yml build $NO_CACHE_FLAG $BUILD_ARGS $SERVICE
    echo "⚠️ Skipping build on server (source not available). Using pulled image."
fi

# ─── Phase 3: Start new container alongside old one ─────────────────────────────
echo ""
echo "[+${SECONDS}s] 🆕 Phase 3: Starting new container alongside old one..."

# Clean up any leftover new container from a previous failed deploy
docker rm -f $CONTAINER_NEW 2>/dev/null || true

# Get the image name that was just built (or pre-pulled)
if [ "${SKIP_BUILD}" == "true" ]; then
    if [ "$ENVIRONMENT" = "staging" ]; then
        IMAGE_NAME="daatan-app:staging-latest"
    elif [ "$ENVIRONMENT" = "next" ]; then
        IMAGE_NAME="daatan-app:next-latest"
    else
        IMAGE_NAME="daatan-app:latest"
    fi
elif [ "$ENVIRONMENT" = "staging" ]; then
    IMAGE_NAME="daatan-app:staging-${DEPLOY_ID}"
elif [ "$ENVIRONMENT" = "next" ]; then
    IMAGE_NAME="daatan-app:next-${DEPLOY_ID}"
else
    IMAGE_NAME="daatan-app:latest"
fi

# Memory budget (#1725). The prod host is a 3.7 GiB t3.medium shared with the elections
# container and postgres; V8 sizes its default heap limit from HOST RAM (2108 MB here),
# so with no cap the app could grow past what the box holds and the kernel OOM killer —
# after up to an hour of page-cache thrash that also broke networkd (2026-09-04) — was
# the only thing pushing back. The heap cap makes V8 collect earlier and die with a
# heap-OOM trace instead of taking the host down; the cgroup limit makes a runaway kill
# only this container. --memory-swap equal to --memory keeps the container off swap
# should the host ever get some (#1726). Measured: fresh ~380 MB, day-old plateau ~1.4 GB,
# bursts to ~1.85 GB under scanner traffic — 1280 MB heap + 2 GB cgroup leaves headroom
# for buffers/sharp while holding the worst case inside the box.
RESOURCE_ARGS=(--memory 2g --memory-swap 2g --memory-reservation 1g)

# Ship the app's stdout/stderr to CloudWatch Logs so it survives this script's
# `docker rm -f` of the previous container (daatan#1788: the old container's logs
# were deleted with it — #1725 forensics, the 2026-10-04 publish failures).
#  - The log group is Terraform-owned (terraform/logging.tf), so there is no
#    `awslogs-create-group`: a group created by the driver would have no retention.
#    The group must exist before this runs in an environment, or `docker run`
#    fails at container start (before the old container is touched).
#  - `mode=non-blocking`: an unreachable CloudWatch drops lines instead of
#    stalling the app's stdout writes.
#  - One stream per container instance (`<name>/<UTC timestamp>`), computed at each
#    call site so a replacement container never shares its predecessor's stream.
#  - Docker's dual logging keeps a bounded local copy, so `docker logs` still works.
case "$ENVIRONMENT" in
    production) LOG_ENV="prod" ;;
    *)          LOG_ENV="staging" ;;   # staging and next share the staging box
esac
awslogs_args() {
    printf '%s\n' \
        --log-driver awslogs \
        --log-opt awslogs-region=eu-central-1 \
        --log-opt "awslogs-group=/daatan/${LOG_ENV}/containers" \
        --log-opt "awslogs-stream=$1/$(date -u +%Y%m%dT%H%M%SZ)" \
        --log-opt mode=non-blocking \
        --log-opt max-buffer-size=4m
}

# Get environment variables from the compose file for the new container
# We run the new container directly (not via compose) to avoid name conflicts
ENV_ARGS=()
ENV_ARGS+=(-e "NODE_ENV=production")
ENV_ARGS+=(-e "NODE_OPTIONS=--max-old-space-size=1280")
ENV_ARGS+=(-e "APP_ENV=${ENVIRONMENT}")
ENV_ARGS+=(-e "NEXTAUTH_SECRET=${NEXTAUTH_SECRET}")
ENV_ARGS+=(-e "GOOGLE_CLIENT_ID=${GOOGLE_CLIENT_ID}")
ENV_ARGS+=(-e "GOOGLE_CLIENT_SECRET=${GOOGLE_CLIENT_SECRET}")
ENV_ARGS+=(-e "SERPER_API_KEY=${SERPER_API_KEY}")
ENV_ARGS+=(-e "SERPAPI_API_KEY=${SERPAPI_API_KEY}")
ENV_ARGS+=(-e "BRIGHTDATA_API_KEY=${BRIGHTDATA_API_KEY}")
ENV_ARGS+=(-e "NIMBLEWAY_API_KEY=${NIMBLEWAY_API_KEY}")
ENV_ARGS+=(-e "DATAFORSEO_LOGIN=${DATAFORSEO_LOGIN}")
ENV_ARGS+=(-e "DATAFORSEO_PASSWORD=${DATAFORSEO_PASSWORD}")
ENV_ARGS+=(-e "GOOGLE_VERTEX_PROJECT_ID=${GOOGLE_VERTEX_PROJECT_ID}")
ENV_ARGS+=(-e "GOOGLE_VERTEX_LOCATION=${GOOGLE_VERTEX_LOCATION}")
ENV_ARGS+=(-e "GOOGLE_VERTEX_CLIENT_EMAIL=${GOOGLE_VERTEX_CLIENT_EMAIL}")
ENV_ARGS+=(-e "GOOGLE_VERTEX_PRIVATE_KEY=${GOOGLE_VERTEX_PRIVATE_KEY}")
ENV_ARGS+=(-e "VAPID_PRIVATE_KEY=${VAPID_PRIVATE_KEY}")
ENV_ARGS+=(-e "BOT_RUNNER_SECRET=${BOT_RUNNER_SECRET}")
ENV_ARGS+=(-e "TEMPORAL_CLOCK_DISABLED=${TEMPORAL_CLOCK_DISABLED}")
ENV_ARGS+=(-e "OPENROUTER_API_KEY=${OPENROUTER_API_KEY}")
ENV_ARGS+=(-e RESEND_API_KEY)
ENV_ARGS+=(-e EMAIL_FROM)
ENV_ARGS+=(-e "MAX_BOTS=${MAX_BOTS:-50}")
ENV_ARGS+=(-e "TELEGRAM_BOT_TOKEN=${TELEGRAM_BOT_TOKEN}")
ENV_ARGS+=(-e "TELEGRAM_CHAT_ID=${TELEGRAM_CHAT_ID}")
ENV_ARGS+=(-e "TELEGRAM_CLEAN_CHAT_ID=${TELEGRAM_CLEAN_CHAT_ID}")
ENV_ARGS+=(-e "TELEGRAM_WEBHOOK_SECRET=${TELEGRAM_WEBHOOK_SECRET}")
ENV_ARGS+=(-e "TELEGRAM_ROLLBACK_CHAT_IDS=${TELEGRAM_ROLLBACK_CHAT_IDS}")
ENV_ARGS+=(-e "TELEGRAM_ADMIN_MAP=${TELEGRAM_ADMIN_MAP}")
ENV_ARGS+=(-e "GH_ROLLBACK_TOKEN=${GH_ROLLBACK_TOKEN}")
ENV_ARGS+=(-e "STAGING_URL=${STAGING_URL:-https://staging.daatan.com}")
ENV_ARGS+=(-e "NEWS_INDEXER_SECRET=${NEWS_INDEXER_SECRET}")
ENV_ARGS+=(-e "NEWS_INDEXER_URL=${NEWS_INDEXER_URL}")
ENV_ARGS+=(-e "NEWS_INDEXER_API_KEY=${NEWS_INDEXER_API_KEY}")
ENV_ARGS+=(-e "AI_PANEL_GROUNDED_TAG=${AI_PANEL_GROUNDED_TAG}")
ENV_ARGS+=(-e "ORACLE_URL=${ORACLE_URL}")
ENV_ARGS+=(-e "ORACLE_API_KEY=${ORACLE_API_KEY}")
ENV_ARGS+=(-e "INDEXNOW_KEY=${INDEXNOW_KEY}")
ENV_ARGS+=(-e "GOOGLE_INDEXING_CLIENT_EMAIL=${GOOGLE_INDEXING_CLIENT_EMAIL}")
ENV_ARGS+=(-e "GOOGLE_INDEXING_PRIVATE_KEY=${GOOGLE_INDEXING_PRIVATE_KEY}")
ENV_ARGS+=(-e "GOOGLE_VERTEX_PROJECT_ID=${GOOGLE_VERTEX_PROJECT_ID}")
ENV_ARGS+=(-e "GOOGLE_VERTEX_LOCATION=${GOOGLE_VERTEX_LOCATION}")
ENV_ARGS+=(-e "GOOGLE_VERTEX_CLIENT_EMAIL=${GOOGLE_VERTEX_CLIENT_EMAIL}")
ENV_ARGS+=(-e "GOOGLE_VERTEX_PRIVATE_KEY=${GOOGLE_VERTEX_PRIVATE_KEY}")
# Optional model overrides (#1800); empty = default (env.ts emptyStringAsUndefined).
ENV_ARGS+=(-e "LLM_STAGE_MODELS=${LLM_STAGE_MODELS:-}")
ENV_ARGS+=(-e "EVIDENCE_SECOND_OPINION_MODEL=${EVIDENCE_SECOND_OPINION_MODEL:-}")

if [ "$ENVIRONMENT" = "staging" ]; then
    ENV_ARGS+=(-e "DATABASE_URL=postgresql://daatan:${POSTGRES_PASSWORD}@postgres-staging:5432/daatan_staging")
    ENV_ARGS+=(-e "NEXTAUTH_URL=https://staging.daatan.com")
    ENV_ARGS+=(-e "AUTH_TRUST_HOST=true")
    ENV_ARGS+=(-e "GA_MEASUREMENT_ID=${GA_MEASUREMENT_ID_STAGING}")
elif [ "$ENVIRONMENT" = "next" ]; then
    ENV_ARGS+=(-e "DATABASE_URL=postgresql://daatan:${POSTGRES_PASSWORD}@postgres-staging:5432/daatan_staging")
    ENV_ARGS+=(-e "NEXTAUTH_URL=https://next.daatan.com")
    ENV_ARGS+=(-e "AUTH_TRUST_HOST=true")
    ENV_ARGS+=(-e "GA_MEASUREMENT_ID=${GA_MEASUREMENT_ID_STAGING}")
else
    ENV_ARGS+=(-e "DATABASE_URL=postgresql://daatan:${POSTGRES_PASSWORD}@postgres:5432/daatan")
    ENV_ARGS+=(-e "NEXTAUTH_URL=https://daatan.com")
    ENV_ARGS+=(-e "GA_MEASUREMENT_ID=${GA_MEASUREMENT_ID_PROD}")
fi

# Get the Docker network name (compose project network)
# Try to detect from current container, fallback to common compose network names
NETWORK=$(docker inspect $CONTAINER --format '{{range $key, $val := .NetworkSettings.Networks}}{{$key}}{{end}}' 2>/dev/null || true)
if [ -z "$NETWORK" ]; then
    echo "⚠️  Could not detect network from $CONTAINER, trying common names..."
    for net in app_default daatan_default staging_default; do
        if docker network ls --format '{{.Name}}' | grep -q "^$net$"; then
            NETWORK=$net
            echo "✅ Found network: $NETWORK"
            break
        fi
    done
fi
NETWORK=${NETWORK:-"app_default"}
echo "Using network: $NETWORK"

# Start new container on the same network but with a temporary name
# No network alias yet — old container still owns the service alias
mapfile -t LOG_ARGS < <(awslogs_args "$CONTAINER")
docker run -d \
    --name "$CONTAINER_NEW" \
    --network "$NETWORK" \
    --restart unless-stopped \
    "${LOG_ARGS[@]}" \
    "${RESOURCE_ARGS[@]}" \
    "${ENV_ARGS[@]}" \
    "$IMAGE_NAME"

echo "✅ New container started as $CONTAINER_NEW"
echo "   Log driver: $(docker inspect -f '{{.HostConfig.LogConfig.Type}}' "$CONTAINER_NEW" 2>/dev/null || echo unknown) (expected awslogs; see docs/DEPLOYMENT.md)"

# ─── Phase 4: Health check new container ─────────────────────────────────────────
echo ""
echo "[+${SECONDS}s] 🏥 Phase 4: Health-checking new container..."
echo "   URL: http://127.0.0.1:3000/api/health"
sleep 2

for i in {1..50}; do
    HEALTH_RESPONSE=$(docker exec $CONTAINER_NEW wget -qO- http://127.0.0.1:3000/api/health 2>&1 || echo "CONNECTION_ERROR")
    if echo "$HEALTH_RESPONSE" | grep -q '"status"'; then
        echo "✅ New container is healthy (attempt $i)"
        echo "   Response: $HEALTH_RESPONSE"
        # EXPECTED_VERSION is exported by deploy.yml. Checking it here, before the
        # swap, keeps a wrong image (e.g. a re-pointed tag, daatan#1954) from ever
        # taking traffic; Phase 7's verify-health.sh reads the same variable.
        if [ -n "$EXPECTED_VERSION" ]; then
            NEW_VERSION=$(echo "$HEALTH_RESPONSE" | grep -oE '"version"\s*:\s*"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"$/\1/')
            if [ "$NEW_VERSION" != "$EXPECTED_VERSION" ]; then
                echo "❌ New container reports version '$NEW_VERSION', expected '$EXPECTED_VERSION'"
                docker rm -f $CONTAINER_NEW 2>/dev/null || true
                echo "🔄 Old container still serving traffic — no downtime occurred"
                exit 1
            fi
            echo "✅ Version matches ($NEW_VERSION)"
        fi
        break
    fi
    if [ $i -eq 50 ]; then
        echo "❌ New container failed health check after 50 attempts"
        echo "   Last response: $HEALTH_RESPONSE"
        echo "📋 New container logs (last 100 lines):"
        docker logs $CONTAINER_NEW --tail 100
        # Clean up failed new container
        docker rm -f $CONTAINER_NEW 2>/dev/null || true
        echo "🔄 Old container still serving traffic — no downtime occurred"
        exit 1
    fi
    echo "⏳ Waiting... ($i/50)"
    sleep 3
done

if [ "$ENVIRONMENT" = "staging" ] || [ "$ENVIRONMENT" = "next" ]; then
    MIGRATIONS_IMAGE="daatan-migrations:staging-latest"
    DB_NAME="daatan_staging"
    MIGRATION_DB_URL="postgresql://daatan:${POSTGRES_PASSWORD}@postgres-staging:5432/daatan_staging"
else
    MIGRATIONS_IMAGE="daatan-migrations:latest"
    DB_NAME="daatan"
    MIGRATION_DB_URL="postgresql://daatan:${POSTGRES_PASSWORD}@postgres:5432/daatan"
fi

# ─── Phase 4b: Pre-migrate DB dump (#1958) ──────────────────────────────────────
# Phase 5 changes the schema under the live old container, and neither the Phase 7
# auto-rollback nor rollback.yml undoes a migration. So when a migration is pending,
# dump the DB to the host first; if the dump fails or looks truncated, abort here,
# before anything is migrated or swapped. `prisma migrate status` exits 0 only when
# the DB is up to date; any other exit (pending, diverged, unreachable) dumps anyway.
# Restore procedure: docs/DEPLOYMENT.md "Pre-migrate DB dump".
abort_before_migrate() {
    echo "❌ $1 — aborting before migrations."
    docker rm -f $CONTAINER_NEW 2>/dev/null || true
    echo "🔄 Old container still serving traffic — no downtime occurred, DB untouched"
    exit 1
}

echo ""
echo "[+${SECONDS}s] 💾 Phase 4b: Checking for pending migrations..."
SCHEMA_UP_TO_DATE=0
if docker run --rm \
    --network "$NETWORK" \
    -e DATABASE_URL="$MIGRATION_DB_URL" \
    "$MIGRATIONS_IMAGE" node node_modules/prisma/build/index.js migrate status >/dev/null 2>&1; then
    SCHEMA_UP_TO_DATE=1
    echo "✅ Database schema is up to date — skipping pre-migrate dump"
else
    DUMP_DIR="$PWD/backups/pre-migrate"
    DUMP_KEEP="${PRE_MIGRATE_DUMP_KEEP:-2}"
    DUMP_FILE="$DUMP_DIR/${ENVIRONMENT}-${EXPECTED_VERSION:-${GIT_COMMIT:0:8}}-$(date -u +%Y%m%dT%H%M%SZ).sql.gz"
    mkdir -p "$DUMP_DIR"
    [ -n "$DB_CONTAINER" ] || abort_before_migrate "Database container not found"

    # Keep DUMP_KEEP dumps in total: prune to DUMP_KEEP-1 before writing the new one.
    mapfile -t OLD_DUMPS < <(ls -1t "$DUMP_DIR"/*.sql.gz 2>/dev/null || true)
    for old in "${OLD_DUMPS[@]:$((DUMP_KEEP > 0 ? DUMP_KEEP - 1 : 0))}"; do
        rm -f "$old" && echo "   🗑️  Pruned $(basename "$old")"
    done
    rm -f "$DUMP_DIR"/*.part
    PREV_DUMP=$(ls -1t "$DUMP_DIR"/*.sql.gz 2>/dev/null | head -1 || true)
    PREV_BYTES=$( [ -n "$PREV_DUMP" ] && stat -c %s "$PREV_DUMP" || echo 0)

    # Room for the new dump: twice the previous one, or 3 GiB with no baseline.
    NEED_BYTES=$(( PREV_BYTES > 0 ? PREV_BYTES * 2 : 3 * 1024 * 1024 * 1024 ))
    FREE_BYTES=$(( $(df -Pk "$DUMP_DIR" | awk 'NR==2 {print $4}') * 1024 ))
    [ "$FREE_BYTES" -ge "$NEED_BYTES" ] || \
        abort_before_migrate "Only $((FREE_BYTES / 1048576)) MiB free in $DUMP_DIR, need $((NEED_BYTES / 1048576)) MiB for the dump"

    echo "💾 Dumping $DB_NAME to $DUMP_FILE ..."
    DUMP_START=$(date +%s)
    if ! ( set -o pipefail
           docker exec "$DB_CONTAINER" pg_dump -U daatan "$DB_NAME" | nice -n 10 gzip > "$DUMP_FILE.part" ); then
        rm -f "$DUMP_FILE.part"
        abort_before_migrate "pg_dump failed"
    fi
    DUMP_BYTES=$(stat -c %s "$DUMP_FILE.part")
    # An empty or errored dump gzips to well under 256 KiB; a real one is MBs. A dump
    # under half the previous one means something is missing, not that data shrank.
    if [ "$DUMP_BYTES" -lt 262144 ] || [ "$DUMP_BYTES" -lt $(( PREV_BYTES / 2 )) ]; then
        rm -f "$DUMP_FILE.part"
        abort_before_migrate "Dump is suspiciously small ($DUMP_BYTES bytes; previous $PREV_BYTES)"
    fi
    mv "$DUMP_FILE.part" "$DUMP_FILE"
    echo "✅ Pre-migrate dump: $(basename "$DUMP_FILE") ($((DUMP_BYTES / 1048576)) MiB, $(( $(date +%s) - DUMP_START ))s)"
fi

# ─── Phase 5: Run migrations (BEFORE swap — old container still serves traffic) ─
echo ""
echo "[+${SECONDS}s] 🗄️ Phase 5: Running Prisma migrations via dedicated migrations container..."
# Phase 4b's `migrate status` exited 0, i.e. nothing is pending: `migrate deploy`
# would be a no-op, so skip its container start (daatan#1992).
if [ "$SCHEMA_UP_TO_DATE" = 1 ]; then
    echo "✅ No pending migrations (Phase 4b) — skipping migrate deploy"
else
    # The migrations container is built from the builder stage and has full node_modules,
    # so prisma CLI and all transitive deps (@prisma/dev, effect, pathe, etc.) are always
    # available — no missing-module errors regardless of Prisma version.
    echo "   Image: $MIGRATIONS_IMAGE"
    docker run --rm \
        --network "$NETWORK" \
        -e DATABASE_URL="$MIGRATION_DB_URL" \
        "$MIGRATIONS_IMAGE" 2>&1 || {
        echo "❌ Migration failed! Aborting deployment."
        docker rm -f $CONTAINER_NEW 2>/dev/null || true
        echo "🔄 Old container still serving traffic — no downtime occurred"
        exit 1
    }
    echo "✅ Migrations applied successfully"
fi

# Save the old container's image NOW — before we stop or remove it in Phase 6. If
# Phase 7 (external health check) fails after the swap, we need this to start a
# replacement container from the previously-working image. It must be the image ID
# (.Image), not the name it was started from (.Config.Image): that name is
# daatan-app:latest / :staging-latest, which the pull before this script has already
# re-pointed at the NEW image (daatan#1955). Nothing prunes between here and Phase 7.
OLD_IMAGE=$(docker inspect $CONTAINER --format '{{.Image}}' 2>/dev/null || echo "")
echo "   Old image saved for rollback: ${OLD_IMAGE:-<none>}"

# ─── Phase 6: Swap traffic via network aliases (zero downtime) ──────────────────
echo ""
echo "[+${SECONDS}s] 🔄 Phase 6: Swapping traffic to new container..."

# Disconnect old container from network (removes its DNS alias)
docker network disconnect $NETWORK $CONTAINER 2>/dev/null || true

# Reconnect new container with the service alias so nginx resolves to it
# First disconnect (it's already connected without alias), then reconnect with alias
docker network disconnect $NETWORK $CONTAINER_NEW 2>/dev/null || true
docker network connect --alias $SERVICE_ALIAS $NETWORK $CONTAINER_NEW

# Reload nginx to force immediate DNS re-resolution
docker exec daatan-nginx nginx -s reload 2>/dev/null || true

echo "✅ Traffic swapped to new container"

# Stop and remove old container
docker stop $CONTAINER 2>/dev/null || true
docker rm -f $CONTAINER 2>/dev/null || true

# Rename new container to the canonical name for future deploys
docker rename $CONTAINER_NEW $CONTAINER

echo "✅ Old container removed, new container is now $CONTAINER"

# ─── Phase 7: External verification ────────────────────────────────────────────
echo ""
echo "[+${SECONDS}s] 🔍 Phase 7: Verifying deployment externally..."
if ./scripts/verify-health.sh "$HEALTH_URL"; then
    echo "✅ Health check passed"
else
    echo "❌ External health check failed — initiating automatic rollback..."
    if [ -n "$OLD_IMAGE" ]; then
        echo "🔄 Rolling back to: $OLD_IMAGE"
        # New container is currently named $CONTAINER — stop and remove it
        docker network disconnect $NETWORK $CONTAINER 2>/dev/null || true
        docker stop $CONTAINER 2>/dev/null || true
        docker rm -f $CONTAINER 2>/dev/null || true
        # Start old image with canonical name and service alias
        # Rollback deliberately does NOT use awslogs: the old container is already gone,
        # so a log-driver failure here would leave nothing serving. Bounded json-file.
        docker run -d \
            --name "$CONTAINER" \
            --network "$NETWORK" \
            --restart unless-stopped \
            --log-opt max-size=10m --log-opt max-file=3 \
            "${RESOURCE_ARGS[@]}" \
            "${ENV_ARGS[@]}" \
            "$OLD_IMAGE"
        docker network disconnect $NETWORK $CONTAINER 2>/dev/null || true
        docker network connect --alias $SERVICE_ALIAS $NETWORK $CONTAINER
        docker exec daatan-nginx nginx -s reload 2>/dev/null || true
        echo "✅ Rollback complete — old version is serving traffic again"
        echo "   Rolled back to image: $OLD_IMAGE"
    else
        echo "⚠️  Could not rollback: old image reference not available"
        echo "   Manual intervention required"
    fi
    docker logs $CONTAINER --tail 50
    exit 1
fi

# Docker log inspection (non-fatal warnings only)
./scripts/verify-logs.sh "$ENVIRONMENT"

# ─── Phase 8: Verify auth ──────────────────────────────────────────────────────
echo ""
echo "[+${SECONDS}s] 🔐 Phase 8: Verifying authentication..."
AUTH_CHECK=$(curl -s "$HEALTH_URL/api/auth/providers" | head -c 50)
if echo "$AUTH_CHECK" | grep -q "google"; then
    echo "✅ Authentication working"
else
    echo "❌ Authentication failing"
    docker logs $CONTAINER --tail 30 | grep -i "auth\|secret\|error"
    exit 1
fi

# ─── Cleanup ────────────────────────────────────────────────────────────────────
echo ""
echo "[+${SECONDS}s] 🧹 Cleaning up old images..."
docker image prune -f

echo ""
echo "✅ Blue-green deployment complete! (${SECONDS}s)"
echo "   Environment: $ENVIRONMENT"
echo "   Container:   $CONTAINER"
echo "   Commit:      ${GIT_COMMIT:0:8}"
