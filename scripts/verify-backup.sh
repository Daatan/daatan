#!/bin/bash
#
# DAATAN Backup Verification
# Streams the latest DB backup from S3 into a throwaway, memory-capped Postgres
# container and runs a sanity query; sends a Telegram alert and exits 1 if
# anything fails.
# Executes ON the EC2 server (invoked via AWS SSM from backup.yml).
#
# Why a separate container (#1808): restoring into a temp DB inside the live
# daatan-postgres pushed the ~1.1 GB dump (and ~2.5 GB of restored data)
# through the host page cache, starved the other containers and drove prod swap
# past the prod-ec2-swap-high alarm twice a day. A cgroup memory limit also
# bounds the page cache the container's writes create, so the restore reclaims
# its own cache instead of the app's memory. --memory-swap equal to --memory
# keeps the container itself out of swap. The dump is streamed, never written
# to the host disk.
#

set -euo pipefail

S3_BUCKET="${S3_BACKUP_BUCKET:-daatan-db-backups-272007598366}"
DB_CONTAINER="${DB_CONTAINER:-daatan-postgres}"
DB_USER="${DB_USER:-daatan}"
VERIFY_CONTAINER="daatan-backup-verify"
VERIFY_DB="daatan_verify"
VERIFY_MEMORY="${VERIFY_MEMORY:-768m}"

if [ -f ~/app/.env ]; then
    source ~/app/.env
elif [ -f .env ]; then
    source .env
fi

send_alert() {
    local reason="$1"
    echo "❌ Verification failed: $reason"
    if [ -n "${TELEGRAM_BOT_TOKEN:-}" ] && [ -n "${TELEGRAM_CHAT_ID:-}" ]; then
        MSG="🚨 <b>Backup Verification FAILED</b>%0AThe latest backup was uploaded but could not be restored successfully.%0AReason: <code>${reason}</code>%0A<b>Manual investigation required — backup may be corrupt.</b>"
        curl -s -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/sendMessage" \
            -d "chat_id=${TELEGRAM_CLEAN_CHAT_ID:-$TELEGRAM_CHAT_ID}" \
            -d "text=$MSG" \
            -d "parse_mode=HTML" > /dev/null
        echo "⚠️ Alert sent to Telegram"
    fi
}

cleanup() {
    # -v also removes the anonymous data volume, so nothing is left on disk.
    docker rm -f -v "$VERIFY_CONTAINER" >/dev/null 2>&1 || true
}
trap cleanup EXIT

# Same image as the live database, so the restore runs on the exact server
# version and extensions (pgvector) the dump came from. No pull needed.
IMAGE=$(docker inspect -f '{{.Config.Image}}' "$DB_CONTAINER")

# Find latest backup
echo "Looking for latest backup in s3://${S3_BUCKET}/backups/ ..."
LATEST=$(aws s3 ls "s3://${S3_BUCKET}/backups/" | sort | tail -1 | awk '{print $4}')
if [ -z "$LATEST" ]; then
    send_alert "No backup files found in S3 bucket"
    exit 1
fi
echo "Latest backup: $LATEST"

# A container left over from a killed run would make `docker run` fail.
cleanup

echo "Starting $VERIFY_CONTAINER ($IMAGE, memory $VERIFY_MEMORY)..."
if ! docker run -d --name "$VERIFY_CONTAINER" \
    --memory "$VERIFY_MEMORY" --memory-swap "$VERIFY_MEMORY" \
    --network none \
    -e POSTGRES_USER="$DB_USER" \
    -e POSTGRES_DB="$VERIFY_DB" \
    -e POSTGRES_HOST_AUTH_METHOD=trust \
    "$IMAGE" \
    -c shared_buffers=128MB \
    -c maintenance_work_mem=128MB \
    -c max_parallel_maintenance_workers=0 \
    -c fsync=off -c synchronous_commit=off -c full_page_writes=off >/dev/null; then
    send_alert "could not start verify container from $IMAGE"
    exit 1
fi

# The image's entrypoint runs initdb on a temporary socket-only server, stops
# it, logs "init process complete" and starts the real one. A query can succeed
# against the temporary server, so check the log line first, then the query.
READY=0
for _ in $(seq 1 60); do
    if docker logs "$VERIFY_CONTAINER" 2>&1 | grep -q 'PostgreSQL init process complete' \
        && docker exec "$VERIFY_CONTAINER" psql -U "$DB_USER" -d "$VERIFY_DB" -Atc 'SELECT 1' >/dev/null 2>&1; then
        READY=1
        break
    fi
    sleep 2
done
if [ "$READY" -ne 1 ]; then
    send_alert "verify container did not become ready"
    exit 1
fi

# Roles are cluster-wide, so pg_dump doesn't carry them, but the dump GRANTs to
# them (e.g. elections_ro) and ON_ERROR_STOP fails on a missing one. Mirror the
# live cluster's role names as NOLOGIN roles.
ROLES=$(docker exec "$DB_CONTAINER" psql -U "$DB_USER" -d postgres -Atc \
    "SELECT rolname FROM pg_roles WHERE rolname NOT LIKE 'pg\\_%' AND rolname <> current_user")
for role in $ROLES; do
    docker exec "$VERIFY_CONTAINER" psql -U "$DB_USER" -d "$VERIFY_DB" -q \
        -c "CREATE ROLE \"$role\" NOLOGIN;"
done

# Restore, streamed from S3. ON_ERROR_STOP: without it psql exits 0 even when
# statements fail, so a "successful" restore proved nothing.
echo "Restoring $LATEST into $VERIFY_CONTAINER..."
START=$(date +%s)
if ! aws s3 cp --no-progress "s3://${S3_BUCKET}/backups/$LATEST" - \
    | gunzip -c \
    | docker exec -i "$VERIFY_CONTAINER" psql -U "$DB_USER" -d "$VERIFY_DB" -q -v ON_ERROR_STOP=1 >/dev/null; then
    OOM=$(docker inspect -f '{{.State.OOMKilled}}' "$VERIFY_CONTAINER" 2>/dev/null || echo unknown)
    send_alert "pg restore failed for $LATEST (container OOMKilled=$OOM, limit $VERIFY_MEMORY)"
    exit 1
fi
echo "Restore took $(( $(date +%s) - START ))s"

# Sanity check: users table must have at least one row. The Prisma model is
# User but the table is mapped to "users". `|| true` so a query error reaches
# send_alert instead of tripping set -e/pipefail first.
ROW_COUNT=$(docker exec "$VERIFY_CONTAINER" psql -U "$DB_USER" -d "$VERIFY_DB" \
    -t -c 'SELECT COUNT(*) FROM users;' 2>&1 | tr -d ' \n' || true)

if ! [[ "$ROW_COUNT" =~ ^[0-9]+$ ]] || [ "$ROW_COUNT" -eq 0 ]; then
    send_alert "Sanity check failed — User count was '${ROW_COUNT}' (expected > 0) in $LATEST"
    exit 1
fi

echo "Verify container memory after restore: $(docker stats --no-stream --format '{{.MemUsage}}' "$VERIFY_CONTAINER" 2>/dev/null || echo n/a)"
echo "✅ Backup verified: $ROW_COUNT users in restored DB ($LATEST)"
