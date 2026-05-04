# Handoff — storm-maps EOD 2026-04-30

**Author:** Claude (Opus 4.7)
**Session window:** ~16:00–22:00 EDT
**Repo:** `/Users/a21/Desktop/storm-maps`
**Production:** https://hailyes.up.railway.app
**Branch shipped on:** `main` (3 commits, all deployed green)

## TL;DR

Three production fixes shipped today, all validated end-to-end. One known borderline case left for follow-up. Two unrelated pre-existing endpoint timeouts (`dashboard`, `consilience-history`, `sync/leads`) intentionally **not** touched — out of today's scope.

## Commits shipped today (in order)

### 1. `32f4c72` — GRIB unit sanity check + DB archive fallback
**Files:** `server/index.ts`, `server/storm/hailFallbackService.ts`, `server/storm/mrmsContour.ts`
**Bugs fixed:**
- Archived MRMS GRIB2 files for some dates (notably 2024-07-16) had grid values 25.4× too large, producing 54-inch "purple blob" hail readings.
- `/api/hail/mrms-vector` returned HTTP 502 when MRMS archive was missing for a date instead of falling back to ground reports.

**Mechanism:**
- `mrmsContour.ts buildMrmsVectorCollection()` — if `maxValMm > 150` (>~6"), divide all grid values by 25.4. Heuristic threshold; logs `[mrms-contour] Suspicious max ...mm for {date}. Applying 25.4x unit correction.`
- `hailFallbackService.ts buildHailFallbackCollection()` — added archive query against `verified_hail_events` table (NCEI Storm Events, NWS warnings, IEM LSR, mPING; **SPC excluded** — preserves 4/27 visual decision that adjusters don't recognize SPC reports).
- `index.ts /api/hail/mrms-vector` — only auto-fallback when `collection === null` (radar archive missing). Empty-features stays empty to honor "MRMS = DIRECT HIT" canon.

**Cache cleanup performed:**
```
DELETE FROM swath_cache WHERE max_value > 5 AND source = 'mrms-hail';
-- removed 16 rows across 4 dates (2021-07-20, 2024-04-15, 2024-07-16×13, 2025-04-05)
```
Re-decoded with the fix on next request.

### 2. `9edf5ed` — `set_config()` over `SET LOCAL` + LIMIT 30 *(LIMIT was a regression, see #3)*
**Files:** `server/index.ts:1315, 1360, 1327`
**Bug fixed:** Pre-existing `SET LOCAL statement_timeout = $1` syntax error on `/api/hail/dates-by-location`. postgres.js v3.4.8 prepared-statement cache was re-issuing `tx.unsafe()` SET commands in extended-query form.

**Mechanism:** Replaced both `tx.unsafe(\`SET LOCAL statement_timeout = ${BUDGET}\`)` with:
```ts
await tx`SELECT set_config('statement_timeout', ${String(BUDGET)}, true)`;
```
`set_config()` is a function call — accepts bind parameters cleanly. Third arg `true` = transaction-scoped (equivalent to `SET LOCAL`).

### 3. `cfcae7d` — restore LIMIT 200 + chunk payload fetch
**File:** `server/index.ts:1327, 1356–1378`
**Bug fixed:** Commit #2 also dropped prefilter LIMIT from 200 to 30 based on a stale comment. **Smoke-tested DMV pin returned only 1 historical date instead of 2 — 2024-07-16 was being dropped.** Cause: prefilter sorts `date DESC, max_value DESC`, so 30 cuts off recent storms before reaching older ones; the point-in-polygon check (which decides which dates *actually* had hail at the rep's pin) never sees them.

**Mechanism:**
- LIMIT back to **200**.
- Real bottleneck (the 8s timeout on `WHERE id = ANY($1)` against multi-MB JSONB) addressed by **chunking the payload fetch into 8 parallel batches of 25 ids**, each in its own transaction with its own 8s budget. Wall-clock stays close to a single batch (~400ms) via `Promise.all`.

## Verification results

### `/api/hail/mrms-vector` — affected dates after corruption fix
| Date | Pre-fix max | Post-fix max | Heuristic fired |
|------|-------------|--------------|------|
| 2024-07-16 | 54.21" | **2.13"** | ✅ |
| 2024-04-15 | 7.41" | **1.84"** | ✅ |
| 2021-07-20 | 6.45" | **0.27"** | ✅ |
| 2025-04-05 | 5.74" | 5.74" | ❌ (raw ~145.8mm < 150mm threshold) |

### `/api/hail/dates-by-location` — restored after LIMIT regression
| Pin | Dates | Cold latency | Cache-hit latency |
|-----|-------|---|---|
| DMV (38.8, -77.0) | 2 (incl. 2024-07-16) | 814ms | 89ms |
| PA (40.0, -77.5) | 2 | 1.29s | — |

### Production logs post-deploy
- 10+ min of clean PG logs after `cfcae7d` (01:18+ UTC) — **zero** `SET LOCAL = $1` syntax errors, **zero** `swath_cache id = ANY` timeouts.
- `/api/health` rolling green.
- `[mrms-contour] Suspicious max ... Applying 25.4x unit correction.` confirmed firing for 2024-07-16 and 2021-07-20 in real traffic.

## Railway infra cleanup

| Action | Result |
|---|---|
| Deleted orphan `Postgres-k_ud` service + `postgres-volume-obs3` | ✅ (was empty — zero tables, 7.7MB system catalogs) |
| Worker `DATABASE_URL` rewired from literal string → `${{Postgres.DATABASE_URL}}` reference | ✅ (canvas line now drawn from Postgres → Hail Yes Worker) |
| Production services remaining | Hail Yes!, Hail Yes Worker, Postgres |

## Outstanding items (not blocking, ordered by priority)

### 1. The 2025-04-05 borderline 5.74" cache row
- **Single row** in DMV bbox.
- Raw GRIB max ≈ 145.8mm — below the 150mm correction threshold.
- **Zero ground-report corroboration** (NCEI/NWS/IEM/SPC/mPING all empty for that date in DMV).
- Likely also corruption, but borderline.
- **Options when revisited:**
  - (a) Lower threshold (risks false correction on legitimate severe storms — record DMV hail is ~4")
  - (b) Add corroboration check: "no ground sources + raw > 4" → suspect" (cleaner — uses cross-source signal that's already in DB)
  - (c) Leave it — single row, low blast radius (only affects one bbox lookup for one date)
- **Recommendation:** option (b) when there's time. Not urgent.

### 2. Pre-existing endpoint timeouts (NOT addressed today, NOT regressions)
| Endpoint / location | Symptom | Notes |
|---|---|---|
| `server/ai/routes/dashboardRoutes.ts:141` activity_log SELECT | `canceling statement due to statement timeout` | Order-by `created_at DESC` LIMIT 20. Likely needs index on `created_at`. |
| `server/index.ts:2129` `[consilience-history]` | Same symptom | Inspect query, likely same fix pattern — `set_config()` for timeout, narrow result set. |
| `server/index.ts:372` `[sync/leads] Error on lead demo-lead-1` | Update timeout | Affects only the seeded demo lead. May not matter — could just be heavy update with many JSON fields. |

These have been failing intermittently for days based on log archaeology; not user-blocking but worth a sweep.

### 3. Cosmetic — `VerifiedHailRow` interface in `hailFallbackService.ts`
After Gemini removed `source_spc_hail` from the SQL query, the field is still declared on the TypeScript interface (line ~37). Unused now. Drop in next pass.

### 4. Code comment cleanup
`server/index.ts:1287–1289` comment says *"capped at 30 dates / ~9MB total transfer / <400ms"* but the actual LIMIT is 200 with chunked fetch. Update comment to reflect reality.

## Active feedback memory updates needed

Suggested additions to `/Users/a21/.claude/projects/-Users-a21/memory/`:

1. **GRIB 25.4× corruption + heuristic threshold** — non-obvious operational fact worth keeping. Some archived MRMS GRIB2 files (e.g. 2024-07-16) have grid values 25.4× too large. Heuristic at `mrmsContour.ts buildMrmsVectorCollection()` divides by 25.4 if max > 150mm. Edge case at ~145.8mm (2025-04-05 / 5.74") slips through; add ground-report corroboration check if revisiting.

2. **postgres.js `tx.unsafe(SET LOCAL ...)` is unreliable** — postgres.js v3.4.8 prepared-statement cache will re-issue `SET LOCAL` in extended-query form (parameterized) on connection reuse, even when the JS template literal interpolated the value at compile time. Use `tx\`SELECT set_config('name', ${String(value)}, true)\`` instead. `set_config()` is a real SQL function and accepts bind parameters cleanly.

3. **`dates-by-location` prefilter LIMIT must stay ≥ 100** — Sort order is `date DESC, max_value DESC`, so a low LIMIT drops older storms BEFORE the point-in-polygon check that decides which dates actually had hail at the rep's pin. Reps lose historical-storm visibility past ~10 months at active locations. Stale code comments saying "30" don't reflect prod reality. Pair LIMIT 200 with chunked payload fetch (8 batches of 25 in parallel under separate transactions) to fit within statement_timeout.

## How to resume in the next session

1. Pull main: `cd /Users/a21/Desktop/storm-maps && git pull origin main` — should be at `cfcae7d`.
2. Verify health: `curl -s https://hailyes.up.railway.app/api/health`.
3. Spot-check rep flow: drop pin in DMV on https://hailyes.up.railway.app/, confirm historical-storms list populates with multiple dates including 2024-07-16 showing ~1.5–2.1" not 54".
4. If picking up outstanding item #1 (2025-04-05): start with `psql` on prod DB, query `verified_hail_events` for that date in the bbox to confirm ground-report state hasn't changed. Then either lower heuristic threshold (risky) or add corroboration check (cleaner).
5. If picking up outstanding item #2 (other endpoint timeouts): same `set_config()` pattern, same chunking approach where applicable. Read the existing `dates-by-location` implementation as the template.

## Files touched today

- `server/index.ts` — `/api/hail/mrms-vector` auto-fallback, `/api/hail/dates-by-location` set_config + chunking
- `server/storm/hailFallbackService.ts` — verified_hail_events archive fetch
- `server/storm/mrmsContour.ts` — 25.4× unit correction heuristic
- `HANDOFF-RELIABILITY-2026-04-30.md` — Gemini handoff (mid-session, can be deleted)
- `HANDOFF-2026-04-30-EOD.md` — this file

## Cache state at EOD

```
swath_cache: 2,662 mrms-hail rows, 122 mrms-now-60min, 73 wind-archive
verified_hail_events: untouched
Both Postgres services down to one (orphan Postgres-k_ud removed).
```

No background work was scheduled.
