#!/bin/bash
# Backup PostgreSQL database to S3
#
# Runs ON the prod EC2 box (as root, via SSM Run Command) from two triggers:
#  - EventBridge Scheduler (terraform/backup_schedule.tf) — the primary
#    schedule, 04:00/16:00 UTC; runs the copy deploy.yml ships to ~/app/scripts.
#  - GitHub Actions backup.yml — the fallback cron, which ships this file
#    inline to /tmp.
# Both can fire for the same slot, so the lock below lets only one run at a
# time; the other exits 0 with BACKUP_SKIPPED (backup.yml checks for it).
set -eo pipefail

LOCK_FILE="${BACKUP_LOCK_FILE:-/var/lock/daatan-db-backup.lock}"
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "BACKUP_SKIPPED: another DB backup or restore verification is already running (lock $LOCK_FILE) — nothing to do"
  exit 0
fi

TIMESTAMP=$(date -u +%Y%m%dT%H%M%SZ)
BACKUP_FILE="/tmp/daatan-backup-${TIMESTAMP}.sql.gz"
S3_BUCKET="${S3_BACKUP_BUCKET:-daatan-db-backups-272007598366}"
DB_CONTAINER="${DB_CONTAINER:-daatan-postgres}"
DB_NAME="${DB_NAME:-daatan}"
DB_USER="${DB_USER:-daatan}"

# The scheduled run has no GitHub failure step, so it sets
# BACKUP_ALERT_ON_FAILURE=1 and the script posts its own Telegram alert.
# backup.yml leaves it unset (its own failure step alerts), so there is no
# double message. Credentials come from ~/app/.env, read in a subshell so
# nothing else in it changes this script's settings.
on_exit() {
  local rc=$?
  rm -f "$BACKUP_FILE"
  if [ "$rc" -ne 0 ] && [ "${BACKUP_ALERT_ON_FAILURE:-0}" = 1 ] && [ -f "$HOME/app/.env" ]; then
    (
      set +eu
      # shellcheck disable=SC1091
      source "$HOME/app/.env" >/dev/null 2>&1
      if [ -n "${TELEGRAM_BOT_TOKEN:-}" ] && [ -n "${TELEGRAM_CHAT_ID:-}" ]; then
        curl -s -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/sendMessage" \
          -d "chat_id=${TELEGRAM_CLEAN_CHAT_ID:-$TELEGRAM_CHAT_ID}" \
          -d "text=🚨 <b>DB Backup FAILED</b> (scheduled run, exit $rc)%0ATime: $(date -u +%Y-%m-%dT%H:%M:%SZ)%0ASee the SSM command output." \
          -d "parse_mode=HTML" > /dev/null
        echo "⚠️ Alert sent to Telegram"
      fi
    )
  fi
}
trap on_exit EXIT

echo "📦 Starting DB backup at $TIMESTAMP"

# Dump and compress. pipefail: a failed pg_dump must fail the run, not upload
# a truncated file.
docker exec "$DB_CONTAINER" pg_dump -U "$DB_USER" "$DB_NAME" | gzip > "$BACKUP_FILE"
echo "✅ Dump complete: $BACKUP_FILE ($(du -sh "$BACKUP_FILE" | cut -f1))"

# Upload to S3
aws s3 cp "$BACKUP_FILE" "s3://${S3_BUCKET}/backups/${TIMESTAMP}.sql.gz"
echo "✅ Uploaded to s3://${S3_BUCKET}/backups/${TIMESTAMP}.sql.gz"

# Cleanup local file
rm -f "$BACKUP_FILE"

# Keep only the newest 60 backups (30 days at two a day)
aws s3 ls "s3://${S3_BUCKET}/backups/" | awk '{print $4}' | sort | head -n -60 | while read -r key; do
  aws s3 rm "s3://${S3_BUCKET}/backups/$key"
  echo "🗑️ Removed old backup: $key"
done

echo "✅ Backup completed successfully"
