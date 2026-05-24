#!/bin/bash
# Stealth cron wrapper for RIQ 21 intel refresh.
#
# OPSEC profile:
#   • Runs ONLY on weekdays (Mon-Fri) — weekends skipped
#   • Adds random jitter 0–180 min before doing work — actual execution time
#     varies day-to-day so the access log doesn't show a perfect cadence
#   • Skips if last successful run was within ~72h — typical cadence is
#     ~3x/week, not nightly
#   • NEVER hits portal.theroofdocs.com — only IEM (NOAA) + Railway Postgres
#
# Called by Windows Task Scheduler (via wsl.exe) which fires weekday mornings;
# this wrapper does the random delay + skip-window logic so the actual API
# traffic looks like organic business-hour usage.

set -u

# SCRIPTS_BASE: git repo with edited Node scripts (C: drive).
SCRIPTS_BASE="$(cd "$(dirname "$0")/../.." && pwd)"
# DATA_BASE: where data + logs live (D: has free space, C: is full).
DATA_BASE="/d/RIQ21"
export RIQ_BASE="$DATA_BASE"

LOG_DIR="$DATA_BASE/.logs"
LOG="$LOG_DIR/cron-refresh.log"
LAST_OK="$LOG_DIR/last-ok.txt"

mkdir -p "$LOG_DIR"
export PATH="/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

# Weekday check (1=Mon, 7=Sun on macOS date)
dow=$(date +%u)
if [ "$dow" -ge 6 ]; then
  echo "[$(date -Iseconds)] Skipped — weekend ($dow)" >> "$LOG"
  exit 0
fi

# Skip if we ran successfully in the last 72h. Combined with the random jitter
# below, actual runs fall into a ~3x/week cadence at varying weekday times.
now=$(date -u +%s)
last_ok=0
if [ -f "$LAST_OK" ]; then
  last_ok=$(cat "$LAST_OK" 2>/dev/null || echo 0)
fi
since_last=$(( now - last_ok ))
if [ "$since_last" -lt $(( 72 * 3600 )) ]; then
  echo "[$(date -Iseconds)] Skipped — last success ${since_last}s ago (< 72h)" >> "$LOG"
  exit 0
fi

# Random jitter 0–180 min so the actual fire time varies day-to-day.
# launchd fires at e.g. 9:17am; this stretches actual execution across
# 9:17am–12:17pm in a way that doesn't pattern-match scraping.
jitter=$(( RANDOM % (180 * 60) ))
echo "[$(date -Iseconds)] Sleeping ${jitter}s ($((jitter/60)) min) of jitter before stealth refresh…" >> "$LOG"
sleep "$jitter"

echo "" >> "$LOG"
echo "=== [$(date -Iseconds)] Stealth refresh starting ===" >> "$LOG"

"$SCRIPTS_BASE/scripts/roofdocs/refresh-stealth.sh" >> "$LOG" 2>&1
rc=$?

if [ "$rc" -eq 0 ]; then
  echo "=== [$(date -Iseconds)] Local stealth refresh OK — pushing to Railway Postgres ===" >> "$LOG"

  # DB URL must come from env (set in .env.local, never committed).
  # Source local env without leaking it to subshells beyond this scope.
  if [ -f "$DATA_BASE/.env.local" ]; then
    set -a
    # shellcheck disable=SC1091
    . "$DATA_BASE/.env.local"
    set +a
  fi
  if [ -z "${RIQ_DB_PUBLIC_URL:-}" ]; then
    echo "  ⚠ RIQ_DB_PUBLIC_URL not set in $DATA_BASE/.env.local — skipping Railway push" >> "$LOG"
    echo "$now" > "$LAST_OK"
    exit 0
  fi
  DATABASE_URL="$RIQ_DB_PUBLIC_URL" RIQ_BASE="$DATA_BASE" node "$SCRIPTS_BASE/scripts/roofdocs/import-to-postgres.mjs" >> "$LOG" 2>&1
  push_rc=$?

  if [ "$push_rc" -eq 0 ]; then
    echo "$now" > "$LAST_OK"
    echo "=== [$(date -Iseconds)] Railway push OK ===" >> "$LOG"
  else
    echo "=== [$(date -Iseconds)] Railway push FAILED (exit $push_rc) ===" >> "$LOG"
    rc=$push_rc
  fi
else
  echo "=== [$(date -Iseconds)] Stealth refresh FAILED (exit $rc) ===" >> "$LOG"
fi

# Tail the log so it doesn't grow forever.
if [ "$(wc -l < "$LOG")" -gt 5000 ]; then
  tail -3000 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
fi

exit "$rc"
