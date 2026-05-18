#!/bin/bash
# Stealth refresh — re-derives + DB-pushes without touching portal.theroofdocs.com.
#
# Hits ONLY:
#   • mesonet.agron.iastate.edu  (IEM storm LSR archive — NOAA public data)
#   • postgres.railway.internal  (our own DB)
#
# NEVER hits portal.theroofdocs.com — no /v1/admin/exports, no /v1/jobs/*.
# Uses the locally-cached job data from the last manual ./refresh-all.sh run.
#
# Cadence: invoked weekdays (Mon-Fri) at varying business-hour times by
# cron-wrapper.sh. Manual refresh of NEW portal jobs is done by the user via
# ./refresh-all.sh on demand.
#
# Trade-off: new jobs added to portal won't appear in RIQ until next manual
# pull. Existing jobs + their storm correlation + derived patterns stay fresh
# (storm data refreshes daily, patterns get rebuilt).

set -u
cd "$(dirname "$0")/../.."
BASE="/Users/a21/storm-maps"
export RIQ_BASE="$BASE"

echo "=== RIQ 21 stealth refresh — $(date -Iseconds) ==="

# Sanity check: do we have local job data to work with?
if [ ! -f "$BASE/data/projects.json" ]; then
  echo "  ❌ data/projects.json missing — run ./refresh-all.sh manually first to seed local data"
  exit 1
fi

echo "→ [1/6] Refreshing IEM storm LSRs (NOAA public data, not portal)…"
node "$BASE/scripts/roofdocs/pull-storms.mjs" 2>&1 | tail -3

echo "→ [2/6] Re-correlating storms with existing jobs…"
node "$BASE/scripts/roofdocs/correlate-storms.mjs" 2>&1 | tail -3

echo "→ [3/6] Rebuilding customer storm exposure + playbook…"
node "$BASE/scripts/roofdocs/build-storm-exposure.mjs" 2>&1 | tail -3

echo "→ [4/6] Mining statistical patterns…"
node "$BASE/scripts/roofdocs/build-patterns.mjs" 2>&1 | tail -3

echo "→ [5/6] Rebuilding receivables + notes + orphans + cheat sheets (from local data)…"
node "$BASE/scripts/roofdocs/build-receivables.mjs" 2>&1 | tail -3
node "$BASE/scripts/roofdocs/build-notes.mjs" 2>&1 | tail -3
node "$BASE/scripts/roofdocs/build-carrier-orphans.mjs" 2>&1 | tail -3
node "$BASE/scripts/roofdocs/build-cheat-sheets.mjs" 2>&1 | tail -3

echo "→ [6/6] Copying to public/ for static serving…"
for f in projects resurrection job-storms receivables storm-exposure storm-playbook notes patterns carrier-orphans; do
  if [ -f "$BASE/data/$f.json" ]; then
    cp "$BASE/data/$f.json" "$BASE/public/$f.json"
  fi
done

echo "=== Stealth refresh complete — $(date -Iseconds) ==="
echo "(zero portal API calls · IEM + local + Postgres only)"
