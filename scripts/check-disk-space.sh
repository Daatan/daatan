#!/bin/bash
#
# DAATAN Disk Space Watchdog
# Checks disk usage and alerts Telegram if above threshold
#

set -e

# 85, not 90: a scheduled backup still needs ~4 GB and a migrating deploy ~2x the last
# pre-migrate dump; at 90% of 38 GB neither fits (daatan#2168).
THRESHOLD=${DISK_ALERT_THRESHOLD:-85}
ENVIRONMENT=${1:-staging}
INSTANCE_ID=$(curl -s http://169.254.169.254/latest/meta-data/instance-id || echo "unknown-instance")

# Get usage of root partition
USAGE=$(df / | tail -1 | awk '{print $5}' | sed 's/%//')

echo "Disk usage: $USAGE% (Threshold: $THRESHOLD%)"

if [ "$USAGE" -gt "$THRESHOLD" ]; then
    echo "⚠️ Disk usage high! Sending Telegram alert..."
    
    # We use direct curl here because this script runs on the server where we might
    # not have the full Node.js environment easily available for a simple check.
    # The environment variables should be available if sourced.
    
    # Prefer the app's .env by absolute path: run via SSM as root, ~ and the cwd may not
    # be /home/ubuntu (daatan#2168). Sourced with -e off so one unparseable line cannot
    # abort the only alert.
    ENV_FILE=/home/ubuntu/app/.env
    [ -f "$ENV_FILE" ] || ENV_FILE=.env
    if [ -f "$ENV_FILE" ]; then
        set +e
        # shellcheck disable=SC1090
        source "$ENV_FILE" >/dev/null 2>&1
        set -e
    fi

    if [ -n "$TELEGRAM_BOT_TOKEN" ] && [ -n "$TELEGRAM_CHAT_ID" ]; then
        MESSAGE="💾 <b>[$ENVIRONMENT] Critical: Disk Space Low</b>%0AInstance: <code>$INSTANCE_ID</code>%0AUsage: <b>$USAGE%</b> (Threshold: $THRESHOLD%)%0AImmediate action required!"
        
        curl -s -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/sendMessage" \
            -d "chat_id=${TELEGRAM_CLEAN_CHAT_ID:-$TELEGRAM_CHAT_ID}" \
            -d "text=$MESSAGE" \
            -d "parse_mode=HTML" > /dev/null
            
        echo "✅ Alert sent to Telegram"
    else
        echo "❌ Telegram not configured (missing env vars)"
        exit 1
    fi
else
    echo "✅ Disk space OK"
fi
