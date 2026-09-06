#!/bin/bash
#
# DAATAN System Health Watchdog
# Checks CPU load and memory usage; alerts Telegram if above thresholds.
# Executes ON the EC2 server (invoked via AWS SSM from watchdog.yml).
#

set -e

MEM_THRESHOLD=90     # percent used
LOAD_MULTIPLIER=2    # alert if load1 > cores × this
ENVIRONMENT=${1:-staging}
INSTANCE_ID=$(curl -s --max-time 3 http://169.254.169.254/latest/meta-data/instance-id 2>/dev/null || echo "unknown-instance")

if [ -f ~/app/.env ]; then
    source ~/app/.env
elif [ -f .env ]; then
    source .env
fi

send_alert() {
    local msg="$1"
    if [ -n "${TELEGRAM_BOT_TOKEN:-}" ] && [ -n "${TELEGRAM_CHAT_ID:-}" ]; then
        curl -s -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/sendMessage" \
            -d "chat_id=${TELEGRAM_CLEAN_CHAT_ID:-$TELEGRAM_CHAT_ID}" \
            -d "text=$msg" \
            -d "parse_mode=HTML" > /dev/null
        echo "✅ Alert sent to Telegram"
    else
        echo "⚠️ Telegram not configured — alert suppressed"
    fi
}

# ── Memory ──────────────────────────────────────────────────────────────────
TOTAL_KB=$(grep MemTotal /proc/meminfo | awk '{print $2}')
AVAIL_KB=$(grep MemAvailable /proc/meminfo | awk '{print $2}')
USED_KB=$((TOTAL_KB - AVAIL_KB))
USED_PCT=$((USED_KB * 100 / TOTAL_KB))
USED_MB=$((USED_KB / 1024))
TOTAL_MB=$((TOTAL_KB / 1024))

echo "Memory: ${USED_MB}MB / ${TOTAL_MB}MB (${USED_PCT}%)"

if [ "$USED_PCT" -gt "$MEM_THRESHOLD" ]; then
    echo "⚠️ Memory usage high — sending alert..."
    MSG="🧠 <b>[${ENVIRONMENT}] Critical: Memory Pressure</b>%0AInstance: <code>${INSTANCE_ID}</code>%0AMemory: <b>${USED_MB} MB / ${TOTAL_MB} MB (${USED_PCT}%)</b>%0AHigh memory usage may cause OOM kills or severe slowdowns."
    send_alert "$MSG"
else
    echo "✅ Memory OK"
fi

# ── CPU load ────────────────────────────────────────────────────────────────
CPU_CORES=$(nproc)
LOAD1=$(cut -d' ' -f1 /proc/loadavg)
LOAD5=$(cut -d' ' -f2 /proc/loadavg)
LOAD_THRESHOLD=$(echo "$CPU_CORES * $LOAD_MULTIPLIER" | bc)

echo "CPU load: $LOAD1 (1m) / $LOAD5 (5m) — Cores: $CPU_CORES — Threshold: $LOAD_THRESHOLD"

if [ "$(echo "$LOAD1 > $LOAD_THRESHOLD" | bc)" -eq 1 ]; then
    echo "⚠️ High CPU load — sending alert..."
    MSG="🔥 <b>[${ENVIRONMENT}] Critical: High CPU Load</b>%0AInstance: <code>${INSTANCE_ID}</code>%0ALoad avg: <b>${LOAD1} (1m) / ${LOAD5} (5m)</b>%0ACPU cores: ${CPU_CORES} — sustained load above ${LOAD_THRESHOLD}x normal."
    send_alert "$MSG"
else
    echo "✅ CPU load OK"
fi

# ── App container memory-pressure restart (daatan#1725 proposal 5) ──────────
# /api/health returns status:"memory-pressure" (HTTP 503) once RSS crosses
# 1600 MB (src/app/api/health/route.ts) -- below the 2 GiB cgroup limit
# (blue-green-deploy.sh's `docker run --memory 2g`). That alone changes
# nothing: `--restart unless-stopped` restarts on process *exit*, not on a
# failed check, so this is the piece that closes the loop. `docker restart`
# sends SIGTERM first (graceful, drains in-flight requests) before SIGKILL,
# well ahead of the cgroup's hard limit.
#
# Scoped to memory-pressure only: a plain "degraded" status means the DB
# check failed, which restarting the app container cannot fix and could
# turn into a restart loop for no benefit.
#
# Requires 2 consecutive 5-min readings (a state file surviving between runs,
# reset by a healthy reading or after acting) before restarting, so one
# transient GC-pause spike doesn't recycle the app for nothing.
case "$ENVIRONMENT" in
    production) CONTAINER=daatan-app ;;
    staging)    CONTAINER=daatan-app-staging ;;
    *)          CONTAINER="" ;;
esac

if [ -n "$CONTAINER" ]; then
    STATE_FILE="/tmp/daatan-${ENVIRONMENT}-memory-pressure-count"
    HEALTH_BODY=$(curl -s --max-time 5 http://127.0.0.1:3000/api/health || echo "")
    HEALTH_STATUS=$(echo "$HEALTH_BODY" | grep -oE '"status"[[:space:]]*:[[:space:]]*"[^"]*"' | sed 's/.*"\([^"]*\)"$/\1/')

    echo "App health status (${CONTAINER}): ${HEALTH_STATUS:-unreachable}"

    if [ "$HEALTH_STATUS" = "memory-pressure" ]; then
        COUNT=$(( $(cat "$STATE_FILE" 2>/dev/null || echo 0) + 1 ))
        echo "$COUNT" > "$STATE_FILE"
        echo "⚠️ Memory pressure observed (${COUNT} consecutive reading(s))"

        if [ "$COUNT" -ge 2 ]; then
            echo "⚠️ Sustained memory pressure — restarting ${CONTAINER}..."
            rm -f "$STATE_FILE"
            if docker restart "$CONTAINER" > /dev/null; then
                MSG="♻️ <b>[${ENVIRONMENT}] Restarted ${CONTAINER}</b>%0AReason: sustained memory pressure (RSS above 1600 MB for 2 consecutive checks)%0AInstance: <code>${INSTANCE_ID}</code>"
                send_alert "$MSG"
            else
                MSG="🔴 <b>[${ENVIRONMENT}] Failed to restart ${CONTAINER}</b>%0AMemory pressure persists and the restart itself failed — manual intervention needed.%0AInstance: <code>${INSTANCE_ID}</code>"
                send_alert "$MSG"
            fi
        fi
    else
        rm -f "$STATE_FILE"
    fi
fi
