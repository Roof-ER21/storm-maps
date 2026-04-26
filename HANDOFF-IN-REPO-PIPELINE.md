# HANDOFF — In-repo storm pipeline

**Branch:** `claude/improve-storm-maps-ZElfS`
**Status:** 13 commits, ~9,500 lines added/changed. Builds clean, lint at baseline (97 pre-existing errors), pushed to GitHub.
**Predecessor docs:** `HANDOFF.md` (Codex baseline), `HANDOFF-VECTOR-SWATHS.md` (Susan21 vector pipeline). Both still useful — this doc adds what changed since.

## TL;DR

This branch eliminates the cross-repo `sa21.up.railway.app` dependency for the storm map. Every hail/wind path now runs in-repo with the Susan21 endpoint kept as a fallback. Adds:

- A pure-JS MRMS GRIB2 decoder + d3-contour pipeline
- An SPC/LSR-buffered hail polygon fallback
- A wind swath layer (the original product never had one)
- VA/MD/PA territory focus with auto-disable on out-of-territory search
- Eastern-time date handling with cross-midnight UTC dedup
- Postgres swath + event cache with TTL by storm age
- Web push for severe-warning fan-out
- A storm timeline scrubber with auto-play
- An in-repo PDFKit storm report
- An admin dashboard at `/#admin`

Read `DEPLOY.md` for the env vars + sanity-check curls.

## Commit map

```
1503f5d  Admin dashboard page + DEPLOY.md
149518d  LIVE label accuracy, hail prewarm pass, PDF polish
685ff19  Admin endpoint auth, tighter push rate limit, drop dead overlays
1e9b1a1  In-repo MRMS raster overlay + PDFKit storm report fallback
7444ec0  MRMS in-repo now-cast + impact endpoints; scrubber play/pause
3a087ed  Pure-JS MRMS GRIB2 decoder + d3-contour pipeline
f82959a  Wind→Data layer, hot-property prewarm, NWS push notifications
328d77c  Data-layer hail render, prewarm scheduler, hail fallback, scrubber wind
dc7067e  Storm timeline scrubber + cached storm-events aggregator
40cd6b0  Postgres-backed swath cache with TTL by storm age
e2c2600  Eastern time everywhere; collapse cross-midnight UTC duplicates
f76927f  VA/MD/PA territory toggle in Event Filters
c83d8b7  Wind swath layer for VA/MD/PA + hail polish foundation
```

Each commit message has a full body. `git log --oneline c83d8b7^..HEAD` to see them.

## Architecture (data flow)

```
Frontend (src/)
  StormMap → HailSwathLayer + WindSwathLayer (google.maps.Data)
  Sidebar  → AddressImpactBadge + WindImpactBadge
  AdminPage (hidden, /#admin)

       │ HTTPS
       ▼
Express server (server/index.ts)
       │
       ├── /api/hail/mrms-vector       → mrmsService.buildMrmsVectorPolygons
       ├── /api/hail/mrms-now-vector   → mrmsService.buildMrmsNowVectorPolygons
       ├── /api/hail/mrms-impact       → mrmsService.buildMrmsImpactResponse
       ├── /api/hail/mrms-image        → mrmsRaster (RGBA PNG)
       ├── /api/hail/mrms-meta         → mrmsRaster metadata
       ├── /api/hail/swath-fallback    → hailFallbackService (SPC/LSR-buffered)
       ├── /api/hail/impact-fallback   → hailFallbackService impact
       ├── /api/hail/storm-report-pdf  → reportPdf.buildStormReportPdf
       ├── /api/wind/swath-polygons    → windSwathService
       ├── /api/wind/now-polygons      → windSwathService (live)
       ├── /api/wind/impact            → windSwathService impact
       ├── /api/storm/events           → eventService (SPC + IEM aggregator)
       ├── /api/push/subscribe (POST/DELETE), /api/push/vapid-public
       ├── /api/admin/cache-status, cache-purge, prewarm-status, push-status
       │
       ├── swath_cache (Postgres)  ← getCachedSwath / setCachedSwath
       ├── event_cache (Postgres)  ← eventService
       └── push_subscriptions      ← pushService

       │
       ▼
Background workers (started on app boot in production)
  scheduler.ts        — 6-hour prewarm cycle (wind, hail, events, hot props)
  pushFanout.ts       — 90-second NWS poll → web-push fan-out
```

## Frontend conventions

**Eastern time everywhere.** Use `src/services/dateUtils.ts`:
- `toEasternDateKey(iso)` → `YYYY-MM-DD`
- `getTodayEasternKey()` → today in ET
- `formatEasternDateLabel(iso)` → `Sat, Apr 25, 2026`
- `formatEasternTimestamp(iso)` → `Apr 25, 2026, 9:14 PM`
- `isOnEasternDate(iso, key)` → boolean

Never `event.beginDate.slice(0, 10)`. The grouping logic (`useStormData`) keys on Eastern dates and the dedupe collapses reports within 0.7 mi + 90 min, regardless of which UTC calendar day they fall on.

**Map layers go through `google.maps.Data`.** `HailSwathLayer.tsx` and `WindSwathLayer.tsx` both use a single `google.maps.Data` instance per map with feature-level styling — not `new google.maps.Polygon` per shape. The `MapsEventListener` lives on the Data layer; hover via `overrideStyle` / `revertStyle`. ~10× faster on dense storms.

**Source priority is "in-repo first → Susan21 fallback".** See `src/services/mrmsApi.ts`:
- `fetchSwathPolygons` tries `/api/hail/mrms-vector` → Susan21 → `/api/hail/swath-fallback`
- `fetchLiveSwathPolygons` tries `/api/hail/mrms-now-vector` → Susan21
- `fetchStormImpact` tries `/api/hail/mrms-impact` (when bounds passed) → Susan21
- `fetchHistoricalMrmsMetadata` tries `/api/hail/mrms-meta` → Susan21
- `getHistoricalMrmsOverlayUrl` returns `/api/hail/mrms-image` (Susan21 path is exposed via `getHistoricalMrmsOverlayUrlSusan21` for explicit fallback)

Same pattern in `src/services/windApi.ts` (in-repo only — wind never had Susan21).

**Territory clipping** (`src/data/territories.ts`):
- `FOCUS_TERRITORIES` = VA, MD+DC, PA bbox tuples
- `FOCUS_STATE_CODES` = `['VA','MD','PA','WV','DC','DE']`
- `isInFocusTerritory({ state, lat, lng })` is the predicate
- `App.tsx` `territoryOnly` defaults true; auto-disables when a search lands outside

## Backend pipelines

### MRMS GRIB2 (`server/storm/mrms*.ts` + `server/storm/grib2/`)

The single biggest piece. Pure-JS, no native deps:

- `mrmsFetch.ts` — pulls `MESH_Max_1440min` from IEM MTArchive on its actual 30-min publication cadence; walks ±12 h around the anchor to find the nearest available file. Gunzips via pako.
- `grib2/sections.ts` — section walker (0–8) supporting template 3.0 (regular lat/lon grid). Handles section-length-prefixed layout, signed angle encoding, micro-degree → degree conversion.
- `grib2/decode.ts` — data-section unpacker for templates 5.0 (simple bit-packed) and 5.41 (PNG-packed; uses pngjs for 8-bit and 16-bit grayscale). Bitmap (section 6) handling for missing values.
- `mrmsContour.ts` — crops the CONUS 7000×3500 grid to the requested bbox + 30 mi pad, runs d3-contour at the 13 IHM hail thresholds, simplifies rings (drops near-duplicate points to keep payloads <200 KB), converts pixel coords → lat/lng.
- `mrmsRaster.ts` — same crop, but encodes as RGBA PNG with the IHM palette for the GroundOverlay.
- `mrmsService.ts` — orchestrates fetcher → decoder → contourer with cache integration. `buildMrmsVectorPolygons`, `buildMrmsNowVectorPolygons`, `buildMrmsImpactResponse`.

CONUS grid is the canonical 7000×3500 at 0.01° (130 W–60 W, 55 N–20 N).

Smoke-tested against Aug 29 / May 7 / Apr 2 2024 — see `scripts/smoke-mrms.ts`. Aug 29 yielded 778k hail cells nationwide / 4.13″ peak; cropped to DC bbox → 12 bands, 2.81″ peak.

### Wind swaths (`server/storm/windSwathService.ts`)

Same shape as the hail pipeline but no GRIB. Pulls SPC same-day/yesterday/archive CSVs (`spcReports.ts`) + IEM LSR archive (`iemLsr.ts`) + active NWS SVR polygon centroids (`nwsAlerts.ts`). Each report → buffered disk per gust-aware radius, bucketed cumulatively into 5 bands (50/58/65/75/90 mph). The `windowStartIso`/`windowEndIso` params on `buildWindSwathCollection` are how the storm timeline scrubber filters reports per radar frame.

### SPC/LSR hail fallback (`server/storm/hailFallbackService.ts`)

Mirror of wind for hail — SPC + IEM hail point reports buffered into the same 13-band IHM polygon shape the MRMS pipeline emits. Used when MRMS returns empty or fails. Shares the `swath_cache` source key `mrms-hail`; metadata.origin disambiguates (`mrms-vector` vs `in-repo-fallback`) — the real MRMS payload wins via the lookup in `mrmsService`.

### Event cache (`server/storm/eventService.ts`)

Server-side aggregator for property searches. Mirrors what the frontend used to do (SPC + IEM LSR + sa21 search), but caches the result in `event_cache` keyed on quantized lat/lng + radius + months. Sub-50 ms warm path for the 3 region centroids and the top 25 hot properties (refreshed every 6 hours by the scheduler). Frontend `searchByCoordinates` (`src/services/stormApi.ts`) tries this first, falls through to the legacy multi-source path.

### Cache layer (`server/storm/cache.ts`)

`getCachedSwath` / `setCachedSwath` against `swath_cache` (Postgres). Bbox quantized to 0.05° (~3.5 mi) so two reps querying the same neighborhood share entries. TTL by source + storm age:
- live (mrms-now, wind-live): 5 min
- today archive: 15 min
- yesterday: 1 hr
- last week: 6 hr
- last month: 1 day
- older: 30 days

Graceful fallback: every call wraps in try/catch, so a Postgres outage just means the call no-ops and the upstream live path runs.

### Prewarm scheduler (`server/storm/scheduler.ts`)

Boots in production (or with `HAIL_YES_PREWARM=1`). 60 s after boot it kicks the first cycle, then every 6 hours. Per cycle:
1. **Wind**: 30 days × 3 regions × buildWindSwathCollection
2. **Hail (SPC-gated)**: scan SPC reports for each of 30 days; only run the GRIB pipeline for (date, region) combos that actually had hail in bounds
3. **Events**: one entry per region at 12-month range
4. **Hot properties**: top 25 most-recently-used `properties` rows in the focus bbox

Throttled to 1 fetch in flight (250 ms pause). Stats exposed via `/api/admin/prewarm-status`.

### Push fan-out (`server/storm/pushFanout.ts`)

Boots in production (or with `HAIL_YES_PUSH=1`) when VAPID keys are configured. Every 90 s polls NWS for active SVR + Tornado warnings, parses affected states from `areaDesc`, and pushes to subs whose `territory_states` intersect. `last_alert_id` dedup blocks re-pushes; 410-Gone responses flip `invalidated_at` so dead subs stop getting retried.

### Admin auth (`server/storm/adminAuth.ts`)

Two paths: `Authorization: Bearer <ADMIN_TOKEN>` (env-configured shared secret) OR a JWT for a logged-in user with `plan='company'` or whose email is in `ADMIN_EMAILS`. Without `ADMIN_TOKEN` the endpoints are open in dev; production logs a warning at deploy.

## Database additions

`server/migrate.ts` (idempotent) creates these on every boot:

```sql
swath_cache         -- (source, date, bbox_hash) → GeoJSON FeatureCollection
event_cache         -- cache_key → property-search response
push_subscriptions  -- (endpoint) → VAPID subscription
```

10 core tables now (was 7).

## Frontend file map (post-changes)

```
src/
├── App.tsx                          (territoryOnly + admin route + EST migration)
├── components/
│   ├── AdminPage.tsx                (NEW — /#admin)
│   ├── HailSwathLayer.tsx           (rewritten — google.maps.Data)
│   ├── WindSwathLayer.tsx           (NEW — google.maps.Data)
│   ├── WindLegend.tsx               (NEW)
│   ├── WindImpactBadge.tsx          (NEW)
│   ├── AddressImpactBadge.tsx       (now accepts bounds)
│   ├── StormMap.tsx                 (scrubber, wind layer wiring, EST)
│   ├── Sidebar.tsx                  (territory toggle, prelim/verified pill, push toggle)
│   └── (deleted: HistoricalFootprintLayer, HistoricalHailContourLayer)
├── data/
│   └── territories.ts               (NEW — VA/MD/PA + helpers)
├── services/
│   ├── dateUtils.ts                 (NEW — Eastern conversion + dedupe)
│   ├── geoUtils.ts                  (NEW — area / point-in-polygon / bbox)
│   ├── windApi.ts                   (NEW — frontend wind client)
│   ├── mrmsApi.ts                   (rewritten — in-repo first chain)
│   ├── stormApi.ts                  (in-repo first chain)
│   ├── reportService.ts             (Susan21-with-fallback chain)
│   ├── notificationService.ts       (added enableStormAlerts / disableStormAlerts / push subscribe)
│   └── nhpApi.ts                    (uses MaxMESH attribute)
├── types/
│   ├── windLevels.ts                (NEW — 5-band insurance palette)
│   └── storm.ts                     (HAIL_SIZE_CLASSES boundary fix; AppView += admin)
└── hooks/
    ├── useHailAlert.ts              (Eastern dates)
    ├── useStormAlerts.ts            (Eastern grouping)
    └── useStormData.ts              (Eastern keys + 0.7mi/90min dedupe)
```

## Backend file map

```
server/
├── index.ts                         (route registrations)
├── schema.ts / migrate.ts           (3 new tables)
├── storm/
│   ├── adminAuth.ts                 (NEW — requireAdmin middleware)
│   ├── cache.ts                     (NEW — swath_cache wrapper)
│   ├── eventService.ts              (NEW — storm event aggregator + event_cache)
│   ├── geometry.ts                  (NEW — bufferCircle, pointInRing, etc.)
│   ├── hailFallbackService.ts       (NEW — SPC/LSR-buffered hail polygons)
│   ├── iemLsr.ts                    (NEW — IEM wind LSR fetcher)
│   ├── iemHailReports.ts            (NEW — IEM hail LSR fetcher)
│   ├── mrmsContour.ts               (NEW — pixel→lat/lng + d3-contour)
│   ├── mrmsFetch.ts                 (NEW — IEM MTArchive fetch)
│   ├── mrmsRaster.ts                (NEW — RGBA PNG encoder)
│   ├── mrmsService.ts               (NEW — pipeline orchestrator)
│   ├── nwsAlerts.ts                 (NEW — NWS SVR polygons)
│   ├── pushFanout.ts                (NEW — 90s NWS poll)
│   ├── pushService.ts               (NEW — VAPID + subscriptions)
│   ├── reportPdf.ts                 (NEW — PDFKit report)
│   ├── scheduler.ts                 (NEW — 6h prewarm cycle)
│   ├── spcReports.ts                (NEW — SPC wind CSV)
│   ├── spcHailReports.ts            (NEW — SPC hail CSV)
│   ├── types.ts                     (NEW — server-side BoundingBox + WindReport)
│   ├── windSwathService.ts          (NEW — wind pipeline)
│   └── grib2/
│       ├── sections.ts              (NEW — GRIB2 section walker)
│       └── decode.ts                (NEW — template 5.0 + 5.41 decoder)
├── ai/                              (unchanged — pre-existing AI routes)
└── ...
```

## Smoke tests (run before deploys)

```bash
# Pipeline sanity (no DB needed; cache no-ops gracefully):
npx tsx scripts/smoke-mrms.ts       # GRIB fetch + decode + contour, 3 dates
npx tsx scripts/smoke-pdf.ts        # raster PNG + 2-page PDF for Aug 29 2024
npm run build                       # tsc -b + vite build
npm run lint                        # baseline 97 errors (none introduced this branch)

# After deploy:
curl https://app/api/health
curl 'https://app/api/hail/mrms-vector?date=2024-08-29&north=39.5&south=38.0&east=-76.0&west=-78.0' | jq '.features | length'
curl 'https://app/api/wind/swath-polygons?date=2024-08-29&north=39.5&south=38.0&east=-76.0&west=-78.0' | jq '.metadata'
curl -H "Authorization: Bearer $ADMIN_TOKEN" https://app/api/admin/cache-status | jq
```

## Known limitations / next-up

1. **MRMS now-cast lags real-time by ~2 hours.** IEM MTArchive isn't real-time. To close this gap, fetch from `mrms.ncep.noaa.gov/data/2D/MESH_Max_1440min/` directly. The fetcher (`mrmsFetch.ts`) is the only file that needs updating.
2. **No auth on `/api/storm/events` or wind/hail polygon endpoints.** Rate-limited but anonymous. Fine for a private app; revisit if it goes public.
3. **PDF doesn't match Susan21 polish.** Missing the executive-summary / AI analysis / NEXRAD radar imagery sections. The Susan21 path is still the preferred one — in-repo is the fallback. Bringing parity would be a 1–2 day project.
4. **NHP swath data is sparse for VA/MD/PA.** The NHP ArcGIS service mostly publishes Canadian polygons. NHP fetch is wired but produces little value for the focus territory.
5. **Lint baseline is 97 errors** — all in pre-existing AI route files (`@typescript-eslint/no-explicit-any` mostly). Nothing introduced on this branch.
6. **Storm-events endpoint is anonymous.** Same as #2 — relevant if the URL goes public.

## Quick orientation for a new agent

1. **Read `DEPLOY.md`** for env vars + sanity-check curls.
2. **Read this file** for the architecture map.
3. **Run `npx tsx scripts/smoke-mrms.ts`** to verify the GRIB pipeline against live NOAA data — 3 known dates, < 1 minute total.
4. **Spin up the dev server** (`npm run dev:server` for the API on `:3100`, `npm run dev` for the SPA on `:5173` proxied to `:3100`). The `dev:server` script uses `--env-file=.env.local`; create one if missing.
5. **For the MRMS pipeline specifically**, the fastest mental model is: GRIB2 file → `readGrib2(buf)` → `decodeGribData(sections)` → `buildMrmsVectorCollection({ decoded, grid, bounds, ... })`. Each step is independently testable; `smoke-mrms.ts` exercises all three.
6. **Cache is graceful**. Every cache module has try/catch around the Postgres calls so dev without a DB still works — you'll see ECONNREFUSED warnings in stderr, those are expected when `DATABASE_URL` doesn't point at a live Postgres.

## Where to push back

- **Keep date handling in Eastern.** Anywhere you see `.slice(0, 10)` on an ISO timestamp, that's a bug. Use `toEasternDateKey`.
- **Don't call `new google.maps.Polygon` directly.** Map overlays should use `google.maps.Data` via `HailSwathLayer` / `WindSwathLayer` patterns.
- **Susan21 is optional.** Don't add new hard dependencies on it. Anything that needs Susan21 should also have an in-repo path (or fall back to one of the existing ones).
- **Cache writes are fire-and-forget.** Don't `await` them on the user's request path.
- **Admin endpoints need `requireAdmin`.** Anything in `/api/admin/*` should pass through it.
