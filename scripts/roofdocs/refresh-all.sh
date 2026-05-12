#!/bin/bash
# One-command refresh of all Roof Docs intelligence data.
# Run when token rotates (token expires every ~30 days from issue).
#
# Steps:
#   1. Verify token still valid
#   2. Re-pull bulk export
#   3. Delta-pull only NEW jobs since last run (skips existing files)
#   4. Pull invoices for any new job IDs
#   5. Pull reference data (pricing, receivables, etc.)
#   6. Geocode any new missing-coord records
#   7. Re-flatten projects.json
#   8. Re-pull storm LSRs (incremental, last 30d)
#   9. Re-correlate storms
#  10. Rebuild customer rollup + storm exposure + playbook
#  11. Rebuild receivables clean
#  12. Copy all data files to public/

set -e
cd "$(dirname "$0")/../.."
BASE="/Users/a21/Desktop/storm-maps"

echo "=== Roof Docs intelligence refresh — $(date -Iseconds) ==="

echo "→ [1/12] Verifying token…"
TOKEN=$(grep -A1 '"name": "token"' /Users/a21/web-recon/data/sessions/theroofdocs.json | grep value | sed 's/.*"value": "//;s/".*$//')
RC=$(curl -s -o /dev/null -w "%{http_code}" "https://api.theroofdocs.com/v1/trades/all" -H "x-access-token: $TOKEN" -H "Origin: https://portal.theroofdocs.com" -m 10)
if [ "$RC" != "200" ]; then
  echo "  ❌ Token check failed (HTTP $RC) — re-login required"
  echo "     cd /Users/a21/web-recon && node scripts/login-only.js"
  exit 1
fi
echo "  ✓ Token valid"

echo "→ [2/12] Re-pulling bulk export…"
curl -s -o /tmp/jobs-export.json "https://api.theroofdocs.com/v1/admin/exports/report" \
  -H "x-access-token: $TOKEN" -H "Origin: https://portal.theroofdocs.com" -m 60
COUNT=$(python3 -c "import json; print(len(json.load(open('/tmp/jobs-export.json'))['data']))")
echo "  ✓ Export: $COUNT jobs"

echo "→ [3/12] Delta-pulling new job details…"
node "$BASE/scripts/roofdocs/pull-all-jobs.mjs" 2>&1 | tail -3

echo "→ [4/12] Delta-pulling new invoices…"
node "$BASE/scripts/roofdocs/pull-invoices.mjs" 2>&1 | tail -3

echo "→ [5/12] Refreshing reference data…"
mkdir -p "$BASE/data/roofdocs-reference"
for ep_pair in \
  "admin/pricing/all:pricing-items" \
  "admin/pricing/project/all:pricing-project" \
  "admin/pricing/templates/all:pricing-templates" \
  "admin/pricing/contractor/all:pricing-contractor" \
  "admin/exports/library/pricing/material:pricing-material" \
  "dashboard/credits/all:credits" \
  "dashboard/adjustment/open:adjustments-open" \
  "dashboard/receivable/open:receivables-open" \
  "dashboard/jobs/all:dashboard-jobs-active" \
  "trades/all:trades"; do
  ep="${ep_pair%%:*}"; name="${ep_pair##*:}"
  curl -s -o "$BASE/data/roofdocs-reference/$name.json" \
    "https://api.theroofdocs.com/v1/$ep" \
    -H "x-access-token: $TOKEN" -H "Origin: https://portal.theroofdocs.com" -m 30
done
echo "  ✓ Reference data refreshed"

echo "→ [6/12] Geocoding new missing-coord records…"
node "$BASE/scripts/roofdocs/geocode-missing.mjs" 2>&1 | tail -2

echo "→ [7/12] Re-flattening projects.json…"
node "$BASE/scripts/roofdocs/flatten-v3.mjs" 2>&1 | tail -5

echo "→ [8/12] Pulling fresh storm LSRs (full rebuild)…"
node "$BASE/scripts/roofdocs/pull-storms.mjs" 2>&1 | tail -3

echo "→ [9/12] Re-correlating storms with jobs…"
node "$BASE/scripts/roofdocs/correlate-storms.mjs" 2>&1 | tail -5

echo "→ [10/12] Re-building customer storm exposure + playbook…"
node "$BASE/scripts/roofdocs/build-storm-exposure.mjs" 2>&1 | tail -5

echo "→ [11/13] Rebuilding receivables + notes…"
node "$BASE/scripts/roofdocs/build-receivables.mjs" 2>&1 | tail -3
node "$BASE/scripts/roofdocs/build-notes.mjs" 2>&1 | tail -3

echo "→ [12/14] Mining statistical patterns (carrier × zip × hail × rep × time)…"
node "$BASE/scripts/roofdocs/build-patterns.mjs" 2>&1 | tail -3

echo "→ [13/15] Building carrier-orphan backfill list…"
node "$BASE/scripts/roofdocs/build-carrier-orphans.mjs" 2>&1 | tail -3

echo "→ [14/15] Building per-entity cheat sheets…"
node "$BASE/scripts/roofdocs/build-cheat-sheets.mjs" 2>&1 | tail -3

echo "→ [15/15] Re-flattening projects (with new storms) + copying to public/…"
node "$BASE/scripts/roofdocs/flatten-v3.mjs" 2>&1 | tail -3
cp "$BASE/data/projects.json" "$BASE/public/projects.json"
cp "$BASE/data/resurrection.json" "$BASE/public/resurrection.json"
cp "$BASE/data/job-storms.json" "$BASE/public/job-storms.json"
cp "$BASE/data/receivables.json" "$BASE/public/receivables.json"
cp "$BASE/data/storm-exposure.json" "$BASE/public/storm-exposure.json"
cp "$BASE/data/storm-playbook.json" "$BASE/public/storm-playbook.json"
cp "$BASE/data/notes.json" "$BASE/public/notes.json"
cp "$BASE/data/patterns.json" "$BASE/public/patterns.json"
cp "$BASE/data/carrier-orphans.json" "$BASE/public/carrier-orphans.json"
cp "$BASE/data/cheat-sheets.json" "$BASE/public/cheat-sheets.json"
echo "  ✓ Data files in $BASE/public/"

echo ""
echo "=== Refresh complete — $(date -Iseconds) ==="
echo "Open http://127.0.0.1:8765/index.html"
