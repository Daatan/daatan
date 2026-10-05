#!/usr/bin/env bash
#
# check-oracle-jev.sh — is the Oracle's Jev gate actually reaching Jev? (daatan#1792, #1796)
#
# Runs ON the Oracle box (i-00ac444b94c5ff9b2) via SSM, shipped by
# .github/workflows/oracle-jev-watchdog.yml. It counts oracle-api's `event=jev_gate` log
# lines per clock hour for every complete hour since the previous check and prints ONE line
#
#   JEV|<action>|<hour>|<err>|<ok>|<n_broken>|<n_hours>|<first_broken>|<last_broken>|<top error status>
#
# where <hour> is the latest checked hour that saw any calls, <err>/<ok> its counts, <n_broken> of the
# <n_hours> checked hours were broken (<first_broken>..<last_broken>), and <action> is
#   alert      — the last hour is broken and either the previous state was ok or the last
#                alert is ≥6h old (a long outage re-pings every 6h, not every run)
#   blip       — the previous state was ok, some hour since then was broken, but the last
#                hour is fine again: one message instead of a 🚨 followed by a ✅
#   recovered  — the previous state was broken, the last hour is not and saw real successes
#   ok         — nothing to say
# A broken hour = at least 3 errors and errors are at least half of the calls. Quiet hours
# (no jev_gate calls; traffic is bursty) are skipped: the verdict is taken on the latest
# hour that had calls, and if none did the state is left as it was.
#
# State (#1796): GitHub runs the hourly schedule only every 3-7h, so a stateless look at the
# last two hours missed ongoing outages, recoveries and blips in between. The last checked
# hour, state and alert time live in $JEV_STATE (root-owned via SSM). No state file → a
# two-hour window and "previously ok", i.e. the old behaviour. Look-back is capped at 12h;
# a longer gap is reported in the hour count. If the state file can't be written the check
# still runs, statelessly. last_alert is recorded before the workflow sends Telegram, so a
# failed send is not retried for 6h — the red workflow run is the signal for that.
#
# Why this exists: the Jev gate is fail-open — when every call errors (402 from an
# exhausted balance or key limit, an outage) articles just go through to the full Haiku
# extraction, nothing user-visible breaks, and the only symptom is cost. On 2026-10-04
# TypeSafe returned 402 for ~6h and nobody noticed until a manual look at the log.
# Jev now runs on an OpenRouter key shared with daatan, with a weekly limit.
#
# Never sends anything itself; the workflow owns the Telegram call. Test hooks:
# ORACLE_LOG (log path), JEV_CHECK_NOW (a `date -d` time to evaluate at), JEV_STATE.

set -uo pipefail

LOG="${ORACLE_LOG:-/home/ubuntu/truthmachine/oracle_log.txt}"
NOW="${JEV_CHECK_NOW:-now}"
STATE="${JEV_STATE:-/var/lib/daatan-jev-watchdog/state}"
MAX_HOURS=12
REALERT_SECS=$((6 * 3600))

if [ ! -r "$LOG" ]; then
  echo "JEV|error|-|0|0|0|0|-|-|log not readable: $LOG"
  exit 0
fi

# Same clock as the log (oracle-api logs in the box's local time).
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

# The log is ~1 GB and ~9k lines an hour (multi-line payloads); 300k lines (~22 MB) covers
# the 12-hour cap with margin for bursts without reading the whole file.
OUT=$(tail -n 300000 "$LOG" | awk -v hours="$HOURS" -v prev="$PREV_STATE" \
    -v now="$T" -v last_alert="$LAST_ALERT" -v realert="$REALERT_SECS" '
  BEGIN { n = split(hours, H, "|") - 1; for (i = 1; i <= n; i++) want[H[i]] = 1 }
  index($0, "event=jev_gate ") == 0 { next }
  { h = substr($0, 1, 13) }
  !(h in want) { next }
  index($0, " status=ok ") > 0 { o[h]++; next }
  {
    e[h]++
    s = $0
    sub(/.* status=/, "", s); sub(/ late=.*/, "", s)
    gsub(/[|<>&"]/, "", s)
    c[substr(s, 1, 90)]++
  }
  function broken(h) { return e[h] >= 3 && 2 * e[h] >= e[h] + o[h] }
  END {
    nb = 0; first = "-"; last = "-"
    for (i = 1; i <= n; i++) if (broken(H[i])) { nb++; if (first == "-") first = H[i]; last = H[i] }
    # Decide on the latest hour that saw any calls: a quiet last hour must not hide a
    # recovery (or an outage) earlier in the window.
    L = n; while (L > 1 && e[H[L]] + o[H[L]] == 0) L--
    h1 = H[L]; e1 = e[h1] + 0; o1 = o[h1] + 0
    top = "-"; m = 0
    for (k in c) if (c[k] > m) { m = c[k]; top = k }

    action = "ok"; state = prev
    if (broken(h1)) {
      state = "broken"
      if (prev != "broken" || now - last_alert >= realert) action = "alert"
    } else if (o1 > 0) {
      state = "ok"
      if (prev == "broken") action = "recovered"
      else if (nb > 0) action = "blip"
    }
    printf "%s\n", state
    printf "JEV|%s|%s|%d|%d|%d|%d|%s|%s|%s\n", action, h1, e1, o1, nb, n, first, last, top
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
  # from scratch. Say so in the status field rather than failing the workflow.
  echo "${LINE%|*}|${LINE##*|} (state not saved: $STATE)"
fi
