# Claude Code Handoff

Last updated: 2026-04-27

## Current State

Local branch: `main`

Committed work:

- `ad27841` — `Improve storm event coverage and app polish`

Uncommitted local follow-up may exist after this handoff if Codex adds an ops-runbook commit. Check:

```bash
git status --short --branch
git log --oneline --decorate -5
```

Intent: make Hail Yes! feel more complete than IHM/HailTrace for roofing reps by improving historical storm-date coverage, warming MRMS swaths before reps ask for them, and keeping the app fast on mobile.

## What Codex Already Changed

- `/api/storm/events` now merges `verified_hail_events` rows with live SPC/IEM sources before radius filtering and dedupe.
- Added `scripts/iem-lsr-backfill.ts` and `npm run backfill:iem-lsr`.
- Added `scripts/prewarm-hail-cache.ts` and `npm run prewarm:hail`.
- Added `scripts/refresh-storm-data.ts` and `npm run ops:refresh-storm-data`.
- Removed AI scan-limit/paywall enforcement from middleware while keeping route wiring.
- Rewrote README for the current Hail Yes! product.
- Lazy-loaded map-heavy frontend chunks. Main bundle dropped from about 614 kB to about 462 kB.
- Made lint a usable gate: `npm run lint` exits 0, with remaining explicit-`any` warnings in AI/property adapters.

## Verification Already Done Locally

These passed in the sandbox:

```bash
npm run build
npm run lint
npm run backfill:iem-lsr -- --days 3 --plan
npm run prewarm:hail -- --days 1 --all-days --dry-run --regions VA
npm run ops:refresh-storm-data -- --plan
```

Expected lint state: exits 0 with explicit-`any` warnings only.

## What Needs Claude Code / Real Environment

The sandbox could not push, deploy, or connect to Railway Postgres. Finish these from a real terminal with network and credentials.

1. Push the committed branch:

```bash
git push origin main
```

2. Deploy Railway:

```bash
railway up --detach
```

3. Confirm health:

```bash
curl -s https://hailyes.up.railway.app/api/health
```

4. Run storm-data refresh with production `DATABASE_URL` loaded:

```bash
npm run ops:refresh-storm-data -- --plan
npm run ops:refresh-storm-data -- --years 2024-2026 --iem-days 45 --hail-days 180
```

If you prefer step-by-step:

```bash
npm run backfill:ncei -- --years 2024-2026
npm run backfill:iem-lsr -- --days 45
npm run prewarm:hail -- --days 180
```

5. Verify database coverage:

```sql
SELECT source_ncei_storm_events, source_iem_lsr, COUNT(*)
  FROM verified_hail_events
 GROUP BY source_ncei_storm_events, source_iem_lsr
 ORDER BY COUNT(*) DESC;

SELECT source, COUNT(*), MAX(max_value), MAX(generated_at)
  FROM swath_cache
 GROUP BY source
 ORDER BY source;
```

6. Verify `/api/storm/events` returns richer historical rows:

```bash
curl -s 'https://hailyes.up.railway.app/api/storm/events?lat=39.1286026&lng=-77.5425290&radius=25&months=24&states=VA,MD,PA,DE,NJ,DC,WV' \
  | jq '.metadata, .sources, (.events | length), (.events[0:5] | map({date:.beginDate,type:.eventType,mag:.magnitude,source:.source}))'
```

7. Generate and inspect a PDF:

```bash
curl -s -X POST -H "Content-Type: application/json" -d '{
  "address":"1255 Barksdale Dr NE, Leesburg, VA 20176",
  "lat":39.1286026,
  "lng":-77.5425290,
  "dateOfLoss":"2025-06-27",
  "radiusMiles":15,
  "rep":{"name":"Ahmed Mahmoud","email":"ahmed.mahmoud@theroofdocs.com"},
  "company":{"name":"Roof-ER21"}
}' "https://hailyes.up.railway.app/api/hail/storm-report-pdf" -o /tmp/hail-yes-report.pdf

pdfinfo /tmp/hail-yes-report.pdf
pdftotext -layout /tmp/hail-yes-report.pdf -
```

Look for: 3 pages, rounded hail sizes, hit-history table populated from more than NCEI-only rows, no Damage Score card, no NCEI appendix bloat.

## Important Cautions

- `CODEX_HANDOFF.md` is untracked local context. Decide whether to delete it, keep it local, or intentionally commit it.
- Do not merge `claude/improve-storm-maps-ZElfS` wholesale into `main`. Its diff against current `main` is deletion-heavy and removes many layers/PDF work. Cherry-pick only after reviewing specific files.
- `verified_hail_events` should remain official-source-first. Per user rule: only NOAA/NWS/NEXRAD-aligned evidence belongs there.
- Keep Hail Yes! lighter than SA21. Avoid adding enterprise SA21 complexity unless it directly helps reps move faster.

## Remaining Product Work

- Historical NWS warning archive ingest from IEM watch/warn ZIP shapefiles into a local table.
- Typed adapters for the AI/property-data integrations to remove the remaining lint warnings.
- Production PDF visual QA after backfills.
- Optional: add admin UI buttons for the new `ops:refresh-storm-data` sequence, guarded by admin auth.
