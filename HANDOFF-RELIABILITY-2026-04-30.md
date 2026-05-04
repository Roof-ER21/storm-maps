# Handoff — dates-by-location reliability fixes

**Date:** 2026-04-30
**Branch:** main
**Last commit:** `32f4c72` (GRIB unit sanity check + DB archive fallback) — already deployed and healthy
**Repo:** `/Users/a21/Desktop/storm-maps`
**Goal:** Two surgical fixes to stop pre-existing prod errors. Ship today, both in separate commits.

## Context

Earlier today we deployed the GRIB 25.4× scaling fix. While verifying that deploy, prod Postgres logs surfaced two pre-existing errors on `/api/hail/dates-by-location` that we did *not* introduce, but want fixed now:

```
17:37:30.497 UTC [147814] ERROR: syntax error at or near "$1" at character 31
17:37:30.497 UTC [147814] STATEMENT: SET LOCAL statement_timeout = $1

20:53:14.825 UTC [148768] ERROR: canceling statement due to statement timeout
20:53:14.825 UTC [148768] STATEMENT:
              SELECT id, payload FROM swath_cache WHERE id = ANY($1)
```

Both are in the same endpoint (`server/index.ts:1243` `/api/hail/dates-by-location`) which is hot — fired on every rep pin-drop and on map-pan. Both fail-soft (return `{dates: []}` with HTTP 200), so reps see *empty* historical-storm dropdowns instead of errors. That's a silent UX regression worth fixing.

Stack: postgres.js v3.4.8, Node 20, Express, Railway Postgres.

---

## Bug 1 — `SET LOCAL statement_timeout = $1` syntax error

### Location
`server/index.ts:1315` and `server/index.ts:1360` (two identical call sites inside `/api/hail/dates-by-location`).

### Current code
```ts
await tx.unsafe(`SET LOCAL statement_timeout = ${DATES_BY_LOCATION_BUDGET_MS}`);
```
where `DATES_BY_LOCATION_BUDGET_MS = 8_000` (line 1224).

### Why it's failing
The JS template literal interpolates `8000` into the string at JS level *before* `.unsafe()` is called, so we expect Postgres to receive the literal string `SET LOCAL statement_timeout = 8000`. Yet PG logs show `SET LOCAL statement_timeout = $1`.

This is a **postgres.js v3.4.8 quirk**: when `tx.unsafe()` runs inside `sql.begin(async (tx) => …)`, the prepared-statement cache on the pooled connection can re-issue the statement in extended-query form on subsequent transactions, and `SET` doesn't accept bind parameters in extended-query mode. The error is intermittent (only some requests), which fits a connection-reuse / cache-collision pattern.

The previous attempted fix (commit `1f99510 fix(hail): SET LOCAL needs literal SQL`) inlined the value but didn't escape the prepared-statement path.

### Fix — use `set_config()` instead of `SET LOCAL`

`set_config(name, value, is_local)` is a regular SQL function that **does** accept bind parameters and works fine in extended-query mode. The third argument `true` makes it transaction-scoped (equivalent to `SET LOCAL`).

Replace both call sites (1315 and 1360) with:

```ts
await tx`SELECT set_config('statement_timeout', ${String(DATES_BY_LOCATION_BUDGET_MS)}, true)`;
```

Note: pass the value as a string (`'8000'`) — `set_config` takes text. Postgres coerces it.

### Verification
1. `npx tsc -b` — must exit 0.
2. After deploy, tail prod PG logs for 5 minutes:
   ```bash
   railway logs --service Postgres | grep -E "SET LOCAL|set_config|syntax error"
   ```
   Expect: **zero** `syntax error at or near "$1"` lines. Should see normal `set_config` calls (which don't error-log on success — silence is golden).
3. Hit the endpoint a few times to exercise both code paths:
   ```bash
   curl "https://hailyes.up.railway.app/api/hail/dates-by-location?lat=38.8&lng=-77.0&months=24"
   curl "https://hailyes.up.railway.app/api/hail/dates-by-location?lat=39.5&lng=-77.5&months=12"
   ```
   Expect: HTTP 200 with non-empty `dates` array (DMV has known historical storms).

---

## Bug 2 — `swath_cache WHERE id = ANY($1)` payload fetch timeout

### Location
`server/index.ts:1361–1363`:

```ts
return tx<SwathPayloadRow[]>`
  SELECT id, payload FROM swath_cache WHERE id = ANY(${ids})
`;
```

### Why it's failing
The prefilter (line 1316) returns up to **200 rows** (LIMIT 200), each carrying an `id` referencing a `swath_cache` row whose `payload` JSONB is a GeoJSON FeatureCollection. High-feature-count storms produce payloads of several MB each. 200 × ~1–3MB = ~200–600MB on the wire — far past the 8s `statement_timeout` budget.

**Inconsistency in current code:** The comment at line 1287–1289 says *"capped at 30 dates"* and *"~9MB total transfer"* — but the actual `LIMIT` at line 1327 is **200**. Looks like a recent bump that the comment didn't track. We're paying for 200 dates of JSONB on every uncached request.

### Fix — restore `LIMIT 30` to match the documented design

Change line 1327 from:
```sql
           LIMIT 200
```
to:
```sql
           LIMIT 30
```

Rationale: 30 dates of JSONB ≈ 9MB transfer (per the original design comment), comfortably fits in the 8s budget. The endpoint returns dates for a **rep's storm-history dropdown** — 30 most-recent storm dates over the requested window is plenty; no rep scrolls past that.

### Optional (only if 30 still times out)
If logs still show the same timeout after the LIMIT change, fall back to chunking the payload fetch:

```ts
const CHUNK = 10;
const chunks: number[][] = [];
for (let i = 0; i < ids.length; i += CHUNK) chunks.push(ids.slice(i, i + CHUNK));
const all = await Promise.all(
  chunks.map((chunk) =>
    pgSql.begin(async (tx) => {
      await tx`SELECT set_config('statement_timeout', ${String(DATES_BY_LOCATION_BUDGET_MS)}, true)`;
      return tx<SwathPayloadRow[]>`SELECT id, payload FROM swath_cache WHERE id = ANY(${chunk})`;
    }),
  ),
);
payloadRows = all.flat();
```
But try the LIMIT-only fix first — odds are it's enough.

### Verification
1. `npx tsc -b` — exit 0.
2. After deploy, tail prod PG logs:
   ```bash
   railway logs --service Postgres | grep -E "swath_cache.*ANY|canceling statement"
   ```
   Expect: zero `canceling statement` errors against `swath_cache id = ANY` over a 10-minute window.
3. Hit endpoint at a high-traffic location:
   ```bash
   time curl -s "https://hailyes.up.railway.app/api/hail/dates-by-location?lat=38.8&lng=-77.0&months=24" | jq '.dates | length'
   ```
   Expect: response in <2s, `dates` length between 1 and 30. Empty array would mean the prefilter returned nothing for that point — try a different lat/lng.
4. Spot-check that capping at 30 doesn't visibly hurt reps: open https://hailyes.up.railway.app/, drop a pin in DMV/PA, scan the historical-storms list. Should still show plenty of dates.

---

## Sequencing — ship today

Two commits, two deploys. Don't bundle.

```
Commit 1: fix(dates-by-location): replace SET LOCAL with set_config() to dodge postgres.js prepared-stmt quirk
Commit 2: fix(dates-by-location): restore LIMIT 30 on prefilter to match payload-budget comment
```

For each commit:
1. Edit, save.
2. `npx tsc -b` → exit 0.
3. `git add server/index.ts && git commit -m "..."`
4. `git push origin main`
5. Watch Railway deploy: `cd /Users/a21/Desktop/storm-maps && railway deployment list | head -3` — wait for `SUCCESS` on both `Hail Yes!` and `Hail Yes Worker` services.
6. Run the verification curl(s) for that bug.
7. Tail logs ~5 min for that bug's signature.
8. Move to next commit.

**Do not skip `npx tsc -b`.** Per recent feedback (`feedback_storm-maps-tsc-noemit-noop.md`), root tsconfig has `files: []` which makes `tsc --noEmit` a silent no-op. Always use `tsc -b`.

## Out of scope (do not touch)

- The `2025-04-05` borderline 5.74" cache row that escapes the GRIB heuristic — separate issue, defer.
- `dashboardRoutes.ts:141` activity_log timeout — separate endpoint, defer.
- `consilience-history` timeout (`server/index.ts:2129`) — separate endpoint, defer.
- `sync/leads` demo-lead-1 timeout — that's the seeded demo data; separate concern.
- The auto-fallback behavior on `/api/hail/mrms-vector` — already shipped today and verified, leave it.

## How to know you're done

- Both commits pushed and deployed green.
- 10 minutes of prod logs with **zero** `SET LOCAL ... = $1` syntax errors.
- 10 minutes of prod logs with **zero** `swath_cache.*ANY.*canceling statement` timeouts.
- Manual test: drop pin on production map → historical-storms list populates within 2s.

Report back with: the two commit SHAs, the post-deploy log tail (proof of zero errors), and a screenshot of the populated historical-storms list.
