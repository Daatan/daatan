#!/bin/bash
# Backup PostgreSQL database to S3
#
# Runs ON the prod EC2 box (as root, via SSM Run Command) from two triggers:
#  - EventBridge Scheduler (terraform/backup_schedule.tf) — the primary
#    schedule, 04:00/16:00 UTC; runs the copy deploy.yml ships to ~/app/scripts.
#  - GitHub Actions backup.yml — manual dispatch only, which ships this file
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
S3_BUCKET="${S3_BACKUP_BUCKET:-daatan-db-backups-272007598366}"
S3_KEY="backups/${TIMESTAMP}.sql.gz"
# Set once the upload has started: from then on a failure must take the object back
# out of backups/, or a truncated dump would become the "latest" one.
UPLOAD_STARTED=0
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
  if [ "$rc" -ne 0 ] && [ "$UPLOAD_STARTED" = 1 ]; then
    # Object Lock keeps the version for its retention; the delete marker hides it from
    # `aws s3 ls`, so neither verify-backup.sh nor the keep-60 prune sees it.
    aws s3 rm "s3://${S3_BUCKET}/${S3_KEY}" >/dev/null 2>&1 \
      && echo "🗑️ Removed incomplete s3://${S3_BUCKET}/${S3_KEY}"
  fi
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

# Size of the newest existing backup, the baseline for the sanity check below.
PREV_BYTES=$(aws s3 ls "s3://${S3_BUCKET}/backups/" | sort | tail -1 | awk '{print $3}')
PREV_BYTES=${PREV_BYTES:-0}

# Dump, compress and stream straight to S3 — nothing touches the local disk
# (daatan#2168: staging a ~4 GB dump in /tmp failed every backup for ~42 h once the
# root disk filled). pipefail: a failed pg_dump fails the run, and on_exit then removes
# the object the upload completed from the truncated stream. A single-stream upload
# is limited to 10,000 parts (80 GB at the CLI's 8 MB default); pass --expected-size
# before the dump gets anywhere near that.
UPLOAD_STARTED=1
docker exec "$DB_CONTAINER" pg_dump -U "$DB_USER" "$DB_NAME" | gzip \
  | aws s3 cp --no-progress - "s3://${S3_BUCKET}/${S3_KEY}"

# A dump that errored early still gzips to a small valid file. Same rule as the
# pre-migrate dump in blue-green-deploy.sh: under 256 KiB, or under half the previous
# backup, means something is missing — not that the data shrank.
BYTES=$(aws s3api head-object --bucket "$S3_BUCKET" --key "$S3_KEY" --query ContentLength --output text)
if [ "$BYTES" -lt 262144 ] || [ "$BYTES" -lt $(( PREV_BYTES / 2 )) ]; then
  echo "❌ Uploaded dump is $BYTES bytes (previous backup: $PREV_BYTES) — treating it as incomplete"
  exit 1
fi
UPLOAD_STARTED=0
echo "✅ Uploaded s3://${S3_BUCKET}/${S3_KEY} ($(( BYTES / 1048576 )) MiB)"

# Keep only the newest 60 backups (30 days at two a day)
aws s3 ls "s3://${S3_BUCKET}/backups/" | awk '{print $4}' | sort | head -n -60 | while read -r key; do
  aws s3 rm "s3://${S3_BUCKET}/backups/$key"
  echo "🗑️ Removed old backup: $key"
done

echo "✅ Backup completed successfully"
