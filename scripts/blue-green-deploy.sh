#!/bin/bash
set -e

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
echo "📦 Phase 1: Ensuring database is running..."
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
echo "🔐 Phase 1b: Ensuring TLS cert renewal loop (certbot) is running..."
docker compose -f $COMPOSE_FILE up -d certbot || echo "⚠️  Could not start certbot service (continuing deploy)"

# ─── Phase 2: Build new image (old container still serving traffic) ─────────────
echo ""
echo "🔨 Phase 2: Building new image (old container still serving traffic)..."

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
    echo "🔨 Phase 2: Skipping build (using pre-pulled image)..."

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
echo "🆕 Phase 3: Starting new container alongside old one..."

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

# Get environment variables from the compose file for the new container
# We run the new container directly (not via compose) to avoid name conflicts
ENV_ARGS=()
ENV_ARGS+=(-e "NODE_ENV=production")
ENV_ARGS+=(-e "APP_ENV=${ENVIRONMENT}")
ENV_ARGS+=(-e "NEXTAUTH_SECRET=${NEXTAUTH_SECRET}")
ENV_ARGS+=(-e "GOOGLE_CLIENT_ID=${GOOGLE_CLIENT_ID}")
ENV_ARGS+=(-e "GOOGLE_CLIENT_SECRET=${GOOGLE_CLIENT_SECRET}")
ENV_ARGS+=(-e "SERPER_API_KEY=${SERPER_API_KEY}")
ENV_ARGS+=(-e "SERPAPI_API_KEY=${SERPAPI_API_KEY}")
ENV_ARGS+=(-e "SCRAPINGBEE_API_KEY=${SCRAPINGBEE_API_KEY}")
ENV_ARGS+=(-e "BRIGHTDATA_API_KEY=${BRIGHTDATA_API_KEY}")
ENV_ARGS+=(-e "NIMBLEWAY_API_KEY=${NIMBLEWAY_API_KEY}")
ENV_ARGS+=(-e "DATAFORSEO_LOGIN=${DATAFORSEO_LOGIN}")
ENV_ARGS+=(-e "DATAFORSEO_PASSWORD=${DATAFORSEO_PASSWORD}")
ENV_ARGS+=(-e "GEMINI_API_KEY=${GEMINI_API_KEY}")
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
docker run -d \
    --name "$CONTAINER_NEW" \
    --network "$NETWORK" \
    --restart unless-stopped \
    "${ENV_ARGS[@]}" \
    "$IMAGE_NAME"

echo "✅ New container started as $CONTAINER_NEW"

# ─── Phase 4: Health check new container ─────────────────────────────────────────
echo ""
echo "🏥 Phase 4: Health-checking new container..."
echo "   URL: http://127.0.0.1:3000/api/health"
sleep 2

for i in {1..50}; do
    HEALTH_RESPONSE=$(docker exec $CONTAINER_NEW wget -qO- http://127.0.0.1:3000/api/health 2>&1 || echo "CONNECTION_ERROR")
    if echo "$HEALTH_RESPONSE" | grep -q '"status"'; then
        echo "✅ New container is healthy (attempt $i)"
        echo "   Response: $HEALTH_RESPONSE"
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

# ─── Phase 5: Run migrations (BEFORE swap — old container still serves traffic) ─
echo ""
echo "🗄️ Phase 5: Running Prisma migrations via dedicated migrations container..."
# The migrations container is built from the builder stage and has full node_modules,
# so prisma CLI and all transitive deps (@prisma/dev, effect, pathe, etc.) are always
# available — no missing-module errors regardless of Prisma version.
if [ "$ENVIRONMENT" = "staging" ] || [ "$ENVIRONMENT" = "next" ]; then
    MIGRATIONS_IMAGE="daatan-migrations:staging-latest"
    MIGRATION_DB_URL="postgresql://daatan:${POSTGRES_PASSWORD}@postgres-staging:5432/daatan_staging"
else
    MIGRATIONS_IMAGE="daatan-migrations:latest"
    MIGRATION_DB_URL="postgresql://daatan:${POSTGRES_PASSWORD}@postgres:5432/daatan"
fi
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

# ─── Phase 5b: Run database seed (populate initial data) ──────────────────────────
echo ""
echo "🌱 Phase 5b: Seeding database..."
# seed.ts is compiled to seed.js during Docker build (tsx is a devDep, not in prod image)
docker exec $CONTAINER_NEW node prisma/seed.js 2>&1 || {
    echo "⚠️  Seed script failed or had no-op (this is often OK)"
}
echo "✅ Database seed completed"

# Save the old container's image reference NOW — before we stop or remove it in
# Phase 6. If Phase 7 (external health check) fails after the swap, we need this
# to start a replacement container from the previously-working image.
OLD_IMAGE=$(docker inspect $CONTAINER --format '{{.Config.Image}}' 2>/dev/null || echo "")
echo "   Old image saved for rollback: ${OLD_IMAGE:-<none>}"

# ─── Phase 6: Swap traffic via network aliases (zero downtime) ──────────────────
echo ""
echo "🔄 Phase 6: Swapping traffic to new container..."

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
echo "🔍 Phase 7: Verifying deployment externally..."
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
        docker run -d \
            --name "$CONTAINER" \
            --network "$NETWORK" \
            --restart unless-stopped \
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
echo "🔐 Phase 8: Verifying authentication..."
AUTH_CHECK=$(curl -s "$HEALTH_URL/api/auth/providers" | head -c 50)
if echo "$AUTH_CHECK" | grep -q "google"; then
    echo "✅ Authentication working"
else
    echo "⚠️ Auth check failed, restarting with env vars..."
    docker compose -f $COMPOSE_FILE --env-file .env restart $SERVICE
    sleep 10
    AUTH_CHECK=$(curl -s "$HEALTH_URL/api/auth/providers" | head -c 50)
    if echo "$AUTH_CHECK" | grep -q "google"; then
        echo "✅ Authentication working after restart"
    else
        echo "❌ Authentication still failing"
        docker logs $CONTAINER --tail 30 | grep -i "auth\|secret\|error"
        exit 1
    fi
fi

# ─── Cleanup ────────────────────────────────────────────────────────────────────
echo ""
echo "🧹 Cleaning up old images..."
docker image prune -f

echo ""
echo "✅ Blue-green deployment complete!"
echo "   Environment: $ENVIRONMENT"
echo "   Container:   $CONTAINER"
echo "   Commit:      ${GIT_COMMIT:0:8}"
