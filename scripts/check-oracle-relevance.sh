#!/usr/bin/env bash
#
# check-oracle-relevance.sh — is the Oracul answering POST /relevance? (daatan#2275)
#
# Runs ON the Oracle box (i-00ac444b94c5ff9b2) via SSM, shipped by
# .github/workflows/oracle-jev-watchdog.yml next to check-oracle-jev.sh, whose state machine
# it mirrors. It counts uvicorn's `"POST /relevance HTTP/1.1" <status>` access lines per clock
# hour for every complete hour since the previous check and prints ONE line
#
#   REL|<action>|<hour>|<err>|<ok>|<n_broken>|<n_hours>|<first_broken>|<last_broken>|<reason>|<top status>|<top error>
#
# where <hour> is the last complete hour, <err>/<ok> its non-2xx/2xx counts, <n_broken> of the
# <n_hours> checked hours were broken (<first_broken>..<last_broken>), <reason> says why the last
# hour is broken (`errors`, `quiet` or `-`), <top status> is the most common non-2xx status and
# <top error> the most common `relevance check failed ... err=` text in the checked hours.
# <action> is
#   alert      — the last hour is broken and either the previous state was ok or the last
#                alert is ≥6h old (a long outage re-pings every 6h, not every run)
#   blip       — the previous state was ok, some hour since then was broken, but the last
#                hour is fine again: one message instead of a 🚨 followed by a ✅
#   recovered  — the previous state was broken and the last hour is not
#   ok         — nothing to say
# A broken hour = errors are at least half of its calls, or it had fewer than MIN_CALLS calls.
# Unlike Jev, /relevance traffic is steady (news-indexer's judge v2 calls it ~1,500-2,000 times
# an hour, every hour, 11-20..11-26), so a quiet hour is itself a failure: the judge stopped
# calling, its calls no longer reach the box, or oracle-api stopped logging.
#
# Why this exists: from 2026-11-18 17:33 to 11-20 ~11:20 UTC every /relevance call returned 502
# (retro#1090: a litellm bump rejected `temperature` for Gemini 3.5). news-indexer's judge v2
# counts a 502 as transient, retries 4 times, then retires the article with no verdict: 726
# articles had to be re-queued by hand. Nothing alerted for ~41h.
#
# Access lines carry no timestamp, so each one is counted in the hour of the latest
# timestamped line (`YYYY-MM-DD HH:MM:SS,mmm LEVEL ...`) before it; the log interleaves
# hundreds of those a minute, so the error is a few lines at an hour boundary.
#
# State: same scheme as check-oracle-jev.sh (daatan#1796) — last checked hour, state and alert
# time in $REL_STATE (root-owned via SSM). No state file → a two-hour window and "previously
# ok". Look-back is capped at 12h. If the state file can't be written the check still runs,
# statelessly.
#
# Never sends anything itself; the workflow owns the Telegram call. Test hooks:
# ORACLE_LOG (log path), REL_CHECK_NOW (a `date -d` time to evaluate at), REL_STATE.

set -uo pipefail

LOG="${ORACLE_LOG:-/home/ubuntu/truthmachine/oracle_log.txt}"
NOW="${REL_CHECK_NOW:-now}"
STATE="${REL_STATE:-/var/lib/daatan-relevance-watchdog/state}"
MAX_HOURS=12
REALERT_SECS=$((6 * 3600))
MIN_CALLS=20

if [ ! -r "$LOG" ]; then
  echo "REL|error|-|0|0|0|0|-|-|-|-|log not readable: $LOG"
  exit 0
fi

# Same clock as the log (oracle-api logs in the box's local time, UTC).
# Epoch arithmetic, not `date -d "$NOW - 1 hour"`: GNU date reads that "-1" as a UTC offset.
T=$(date -d "$NOW" +%s)
H1_EPOCH=$(( (T / 3600 - 1) * 3600 ))   # start of the last complete hour

PREV_STATE=ok; LAST_HOUR_EPOCH=""; LAST_ALERT=0
if [ -r "$STATE" ]; then
  while IFS='=' read -r k v; do
    case "$k" in
      state) PREV_STATE="$v" ;;
      last_hour) LAST_HOUR_EPOCH="$v" ;;
      last_alert) LAST_ALERT="$v" ;;
    esac
  done < "$STATE"
fi

if [ -n "$LAST_HOUR_EPOCH" ]; then
  N=$(( (H1_EPOCH - LAST_HOUR_EPOCH) / 3600 ))
  [ "$N" -lt 1 ] && N=1            # re-run within the same hour: re-check the last hour
  [ "$N" -gt "$MAX_HOURS" ] && N=$MAX_HOURS
else
  N=2
fi

HOURS=""
for ((i = N - 1; i >= 0; i--)); do
  HOURS+="$(date -d "@$((H1_EPOCH - i * 3600))" '+%Y-%m-%d %H')|"
done

# ~11-15k log lines an hour normally, ~45k during the 11-18/20 outage (every failed call logs
# its exception several times). 700k lines covers the 12-hour cap even at the outage rate
# without reading the whole ~3 GB file.
OUT=$(tail -n 700000 "$LOG" | LC_ALL=C awk -v hours="$HOURS" -v prev="$PREV_STATE" \
    -v now="$T" -v last_alert="$LAST_ALERT" -v realert="$REALERT_SECS" -v min_calls="$MIN_CALLS" '
  BEGIN { n = split(hours, H, "|") - 1; for (i = 1; i <= n; i++) want[H[i]] = 1 }
  /^[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9] [0-9][0-9]:/ {
    h = substr($0, 1, 13)
    if ((h in want) && index($0, " relevance check failed ") > 0 && (p = index($0, " err=")) > 0) {
      s = substr($0, p + 5, 90)
      gsub(/[|<>&"]/, "", s)
      c[s]++
    }
    next
  }
  h == "" || !(h in want) { next }
  index($0, "\"POST /relevance ") == 0 { next }
  $NF ~ /^2[0-9][0-9]$/ { o[h]++; next }
  { e[h]++; sc[$NF]++ }
  function broken(h,    t) { t = e[h] + o[h]; return t < min_calls || 2 * e[h] >= t }
  END {
    nb = 0; first = "-"; last = "-"
    for (i = 1; i <= n; i++) if (broken(H[i])) { nb++; if (first == "-") first = H[i]; last = H[i] }
    h1 = H[n]; e1 = e[h1] + 0; o1 = o[h1] + 0
    reason = "-"
    if (e1 + o1 < min_calls) reason = "quiet"
    else if (2 * e1 >= e1 + o1) reason = "errors"
    top = "-"; m = 0
    for (k in c) if (c[k] > m) { m = c[k]; top = k }
    ts = "-"; m = 0
    for (k in sc) if (sc[k] > m) { m = sc[k]; ts = k }
    gsub(/[|<>&"]/, "", ts)

    action = "ok"; state = prev
    if (broken(h1)) {
      state = "broken"
      if (prev != "broken" || now - last_alert >= realert) action = "alert"
    } else {
      state = "ok"
      if (prev == "broken") action = "recovered"
      else if (nb > 0) action = "blip"
    }
    printf "%s\n", state
    printf "REL|%s|%s|%d|%d|%d|%d|%s|%s|%s|%s|%s\n", action, h1, e1, o1, nb, n, first, last, reason, ts, top
  }')
NEW_STATE=${OUT%%$'\n'*}
LINE=${OUT#*$'\n'}
ACTION=$(printf '%s' "$LINE" | cut -d'|' -f2)

[ "$ACTION" = "alert" ] && LAST_ALERT=$T
if [ -n "$NEW_STATE" ] && mkdir -p "$(dirname "$STATE")" 2>/dev/null &&
   printf 'state=%s\nlast_hour=%s\nlast_alert=%s\n' "$NEW_STATE" "$H1_EPOCH" "$LAST_ALERT" \
     > "$STATE.tmp" 2>/dev/null && mv "$STATE.tmp" "$STATE" 2>/dev/null; then
  echo "$LINE"
else
  # Unwritable state: the verdict is still right for this run, but the next one starts
  # from scratch. Say so in the error field rather than failing the workflow.
  echo "${LINE%|*}|${LINE##*|} (state not saved: $STATE)"
fi
