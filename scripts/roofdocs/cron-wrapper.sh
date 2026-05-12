#!/bin/bash
# Nightly Roof Docs Intel refresh wrapper.
# Called by launchd: ~/Library/LaunchAgents/com.theroofdocs.intel-refresh.plist
# Fires at 3:33 AM ET every day. Skips if the last successful run was within 22h
# (so a manual mid-day refresh doesn't trigger a redundant nightly).

set -u

BASE="/Users/a21/Desktop/storm-maps"
LOG_DIR="$BASE/.logs"
LOG="$LOG_DIR/cron-refresh.log"
LAST_OK="$LOG_DIR/last-ok.txt"

mkdir -p "$LOG_DIR"

# Initialize PATH so node + curl are found under launchd
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

now=$(date -u +%s)
last_ok=0
if [ -f "$LAST_OK" ]; then
  last_ok=$(cat "$LAST_OK" 2>/dev/null || echo 0)
fi

# 22h skip window (one hour of jitter so daily fires aren't blocked by manual runs)
since_last=$(( now - last_ok ))
if [ "$since_last" -lt $(( 22 * 3600 )) ]; then
  echo "[$(date -Iseconds)] Skipped — last success was ${since_last}s ago (< 22h)" >> "$LOG"
  exit 0
fi

echo "" >> "$LOG"
echo "=== [$(date -Iseconds)] Nightly Intel refresh starting ===" >> "$LOG"

# Token must be present + non-expired; refresh-all.sh checks this and exits early.
"$BASE/scripts/roofdocs/refresh-all.sh" >> "$LOG" 2>&1
rc=$?

if [ "$rc" -eq 0 ]; then
  echo "$now" > "$LAST_OK"
  echo "=== [$(date -Iseconds)] Refresh OK (exit $rc) ===" >> "$LOG"
else
  echo "=== [$(date -Iseconds)] Refresh FAILED (exit $rc) ===" >> "$LOG"
fi

# Tail the log so it doesn't grow forever (keep last 5000 lines).
if [ "$(wc -l < "$LOG")" -gt 5000 ]; then
  tail -3000 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
fi

exit "$rc"
