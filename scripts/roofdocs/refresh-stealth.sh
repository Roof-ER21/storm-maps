#!/bin/bash
# Stealth refresh — rebuilds derived intel + pushes to Railway Postgres.
#
# Hits ONLY:
#   • mesonet.agron.iastate.edu  (IEM storm LSR archive — NOAA public data)
#   • postgres.railway.internal  (our own DB)
#
# Uses locally-cached job data (projects.json). Storm data refreshes each run.

set -u

# SCRIPTS_BASE: the git repo where the edited Node scripts live.
# Derived from this file's location so it works on any machine.
SCRIPTS_BASE="$(cd "$(dirname "$0")/../.." && pwd)"

# DATA_BASE: where projects.json + all derived data files live.
# On this Windows machine the data directory is on D: (C: has no free space).
DATA_BASE="/d/RIQ21"
export RIQ_BASE="$DATA_BASE"

echo "=== RIQ 21 stealth refresh — $(date -Iseconds) ==="
echo "  scripts: $SCRIPTS_BASE"
echo "  data:    $DATA_BASE"

# Sanity check: do we have local job data to work with?
if [ ! -f "$DATA_BASE/data/projects.json" ]; then
  echo "  ❌ $DATA_BASE/data/projects.json missing — run refresh-all.sh manually first"
  exit 1
fi

echo "→ [1/6] Refreshing IEM storm LSRs (NOAA public data, not portal)…"
node "$SCRIPTS_BASE/scripts/roofdocs/pull-storms.mjs" 2>&1 | tail -3

echo "→ [2/6] Re-correlating storms with existing jobs…"
node "$SCRIPTS_BASE/scripts/roofdocs/correlate-storms.mjs" 2>&1 | tail -3

echo "→ [3/6] Rebuilding customer storm exposure + playbook…"
node "$SCRIPTS_BASE/scripts/roofdocs/build-storm-exposure.mjs" 2>&1 | tail -3

echo "→ [4/6] Mining statistical patterns…"
node "$SCRIPTS_BASE/scripts/roofdocs/build-patterns.mjs" 2>&1 | tail -3

echo "→ [5/6] Rebuilding receivables + notes + orphans + cheat sheets…"
node "$SCRIPTS_BASE/scripts/roofdocs/build-receivables.mjs" 2>&1 | tail -3
node "$SCRIPTS_BASE/scripts/roofdocs/build-notes.mjs" 2>&1 | tail -3
node "$SCRIPTS_BASE/scripts/roofdocs/build-carrier-orphans.mjs" 2>&1 | tail -3
node "$SCRIPTS_BASE/scripts/roofdocs/build-cheat-sheets.mjs" 2>&1 | tail -3

echo "→ [6/6] Data files stay in $DATA_BASE/data/ — import-to-postgres pushes to Railway"
echo "=== Stealth refresh complete — $(date -Iseconds) ==="
echo "(zero portal API calls · IEM + local + Postgres only)"
