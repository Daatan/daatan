#!/usr/bin/env bash
#
# check-oracle-jev.sh — is the Oracle's Jev gate actually reaching Jev? (daatan#1792)
#
# Runs ON the Oracle box (i-00ac444b94c5ff9b2) via SSM, shipped by
# .github/workflows/oracle-jev-watchdog.yml. Read-only: it counts oracle-api's
# `event=jev_gate` log lines for the last two complete clock hours and prints ONE line
#
#   JEV|<action>|<hour>|<err>|<ok>|<prev_err>|<prev_ok>|<top error status>
#
# where <hour> is the last complete hour, <prev_*> the hour before it, and <action> is
#   alert      — the last hour is broken and the one before was not (or it is a 6th hour
#                and it is still broken, so a long outage re-pings every 6h, not hourly)
#   recovered  — the hour before was broken, the last hour is not and saw real successes
#   ok         — nothing to say
# A broken hour = at least 3 errors and errors are at least half of the calls.
#
# Why this exists: the Jev gate is fail-open — when every call errors (402 from an
# exhausted balance or key limit, an outage) articles just go through to the full Haiku
# extraction, nothing user-visible breaks, and the only symptom is cost. On 2026-10-04
# TypeSafe returned 402 for ~6h and nobody noticed until a manual look at the log.
# Jev now runs on an OpenRouter key shared with daatan, with a weekly limit.
#
# Never sends anything itself; the workflow owns the Telegram call. Test hooks:
# ORACLE_LOG (log path) and JEV_CHECK_NOW (a `date -d` time to evaluate at).

set -uo pipefail

LOG="${ORACLE_LOG:-/home/ubuntu/truthmachine/oracle_log.txt}"
NOW="${JEV_CHECK_NOW:-now}"

if [ ! -r "$LOG" ]; then
  echo "JEV|error|-|0|0|0|0|log not readable: $LOG"
  exit 0
fi

# Same clock as the log (oracle-api logs in the box's local time).
# Epoch arithmetic, not `date -d "$NOW - 1 hour"`: GNU date reads that "-1" as a UTC offset.
T=$(date -d "$NOW" +%s)
H1=$(date -d "@$((T - 3600))" '+%Y-%m-%d %H')
H2=$(date -d "@$((T - 7200))" '+%Y-%m-%d %H')

# The log is ~1 GB and ~9k lines an hour (multi-line payloads); 200k lines (~15 MB) covers
# the two hours with a wide margin for bursts without reading the whole file.
tail -n 200000 "$LOG" | awk -v h1="$H1" -v h2="$H2" '
  index($0, "event=jev_gate ") == 0 { next }
  { h = substr($0, 1, 13) }
  h != h1 && h != h2 { next }
  {
    ok = index($0, " status=ok ") > 0
    if (h == h2) { if (ok) o2++; else e2++; next }
    if (ok) { o1++; next }
    e1++
    s = $0
    sub(/.* status=/, "", s); sub(/ late=.*/, "", s)
    gsub(/[|<>&"]/, "", s)
    c[substr(s, 1, 90)]++
  }
  function broken(e, o) { return e >= 3 && 2 * e >= e + o }
  END {
    e1 += 0; o1 += 0; e2 += 0; o2 += 0
    top = "-"; m = 0
    for (k in c) if (c[k] > m) { m = c[k]; top = k }
    action = "ok"
    if (broken(e1, o1)) {
      if (!broken(e2, o2) || substr(h1, 12, 2) % 6 == 0) action = "alert"
    } else if (broken(e2, o2) && o1 > 0) {
      action = "recovered"
    }
    printf "JEV|%s|%s|%d|%d|%d|%d|%s\n", action, h1, e1, o1, e2, o2, top
  }'
