#!/bin/bash
#
# DAATAN Backup Verification
# Downloads the latest DB backup from S3 and restores it to a temp database.
# Runs a sanity query; sends a Telegram alert and exits 1 if anything fails.
# Executes ON the EC2 server (invoked via AWS SSM from backup.yml).
#

set -euo pipefail

S3_BUCKET="${S3_BACKUP_BUCKET:-daatan-db-backups-272007598366}"
DB_CONTAINER="${DB_CONTAINER:-daatan-postgres}"
DB_USER="${DB_USER:-daatan}"
TEMP_DB="daatan_verify_$(date +%s)"
BACKUP_LOCAL="/tmp/verify-backup-$$.sql.gz"

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
    docker exec "$DB_CONTAINER" psql -U "$DB_USER" -d postgres \
        -c "DROP DATABASE IF EXISTS \"$TEMP_DB\";" 2>/dev/null || true
    rm -f "$BACKUP_LOCAL"
}
trap cleanup EXIT

# Find latest backup
echo "Looking for latest backup in s3://${S3_BUCKET}/backups/ ..."
LATEST=$(aws s3 ls "s3://${S3_BUCKET}/backups/" | sort | tail -1 | awk '{print $4}')
if [ -z "$LATEST" ]; then
    send_alert "No backup files found in S3 bucket"
    exit 1
fi
echo "Latest backup: $LATEST"

# Download
echo "Downloading..."
if ! aws s3 cp "s3://${S3_BUCKET}/backups/$LATEST" "$BACKUP_LOCAL"; then
    send_alert "S3 download failed for $LATEST"
    exit 1
fi
echo "Downloaded $(du -sh "$BACKUP_LOCAL" | cut -f1)"

# Create temp database
echo "Creating temp database $TEMP_DB..."
if ! docker exec "$DB_CONTAINER" psql -U "$DB_USER" -d postgres \
    -c "CREATE DATABASE \"$TEMP_DB\";"; then
    send_alert "could not create temp database $TEMP_DB"
    exit 1
fi

# Restore. ON_ERROR_STOP: without it psql exits 0 even when statements fail,
# so a "successful" restore proved nothing (#1808).
echo "Restoring to $TEMP_DB..."
if ! gunzip -c "$BACKUP_LOCAL" | docker exec -i "$DB_CONTAINER" psql -U "$DB_USER" -d "$TEMP_DB" -q -v ON_ERROR_STOP=1; then
    send_alert "pg restore failed for $LATEST"
    exit 1
fi

# Sanity check: users table must have at least one row. The Prisma model is
# User but the table is mapped to "users". `|| true` so a query error reaches
# send_alert instead of tripping set -e/pipefail first (#1808).
ROW_COUNT=$(docker exec "$DB_CONTAINER" psql -U "$DB_USER" -d "$TEMP_DB" \
    -t -c 'SELECT COUNT(*) FROM users;' 2>&1 | tr -d ' \n' || true)

if ! [[ "$ROW_COUNT" =~ ^[0-9]+$ ]] || [ "$ROW_COUNT" -eq 0 ]; then
    send_alert "Sanity check failed — User count was '${ROW_COUNT}' (expected > 0) in $LATEST"
    exit 1
fi

echo "✅ Backup verified: $ROW_COUNT users in restored DB ($LATEST)"
