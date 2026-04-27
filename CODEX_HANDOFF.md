# Hail Yes! — Codex Handoff
**Last updated:** 2026-04-26
**Repo head:** `main / 14f9806`
**Production:** https://hailyes.up.railway.app

---

## Goal of this project

**Make reps forget they ever used IHM and HailTrace.**

Hail Yes! is a roofing-rep-facing storm intelligence app + adjuster-grade PDF generator. It's the Hail-Yes spinout from sister product SA21 (Susan21 / gemini-field-assistant at https://sa21.up.railway.app), decoupled into its own repo + Railway service.

**Competitive positioning:**
- **vs IHM** (Interactive Hail Maps, paywalled, $$$/year per rep): we use the same NOAA/NWS/NEXRAD source data, present it without their hail-trace token paywall, and ship a faster mobile UI.
- **vs HailTrace** (HailTrace.com): same upstream data; we add property-level swath impact tier classification, multi-source forensic consilience, MRMS hourly scrubber, and a free PDF that adjusters trust.
- **vs SA21** (sister product): we're meant to be lighter and rep-faster. SA21 is the comprehensive enterprise version with more backfilled history.

Focus regions: **VA, MD, PA, DE, NJ** (with DC + WV coverage too).

---

## Where things live

- **Local repo:** `/Users/a21/Desktop/storm-maps` (package name `hail-yes`)
- **Stack:** Express + TypeScript + Postgres (postgres.js v3) + Vite + React 19 + PDFKit
- **Deploy:** `cd /Users/a21/Desktop/storm-maps && railway up --detach` (Railway project "Hail Yes!")
- **Health probe:** `curl -s https://hailyes.up.railway.app/api/health`
- **Repo branches:**
  - `main` — current production
  - `claude/improve-storm-maps-ZElfS` (Apr 25–26, ~13 commits, ~9.5k lines, **unmerged**) — pure-JS MRMS GRIB2 decoder, wind swaths, ET-date handling, PG swath/event cache, web push, admin dashboard. Decoupled from SA21. Stripe slated for removal.

---

## Architecture overview

```
┌─────────────── Frontend (React 19 + Vite) ───────────────┐
│  StormMap.tsx (master) — Mapbox GL on web, leaflet on mobile (vis.gl)
│   ├─ StormCellsLayer        ↔ MRMS now-cast hail polygons
│   ├─ LiveStormCellsLayer    ↔ NWS active SVR warnings + MRMS swaths
│   ├─ ActiveStormsPanel      ↔ /api/storm/live-cells (90s poll)
│   ├─ HourlyScrubber         ↔ MRMS_Max_60min for 24 anchors per day
│   ├─ ScrubMode toggle       ↔ MRMS / NEXRAD modes
│   └─ Sketch overlay         ↔ localStorage by property+date
│  ReportsPage / DashboardPage / EvidencePage / TeamPage / AdminPage
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼  /api/...
┌─────────────── Backend (Express + tsx) ──────────────────┐
│  routes (server/index.ts)
│   ├─ /api/storm/events           → fetchStormEventsCached (live SPC + IEM LSR)
│   ├─ /api/storm/consilience      → 12-source corroboration
│   ├─ /api/storm/live-cells       → MRMS now-cast + NWS warnings (90s cache)
│   ├─ /api/storm/cocorahs         → CoCoRaHS observer reports
│   ├─ /api/storm/mesocyclones     → NEXRAD nx3mda
│   ├─ /api/storm/synoptic-stations → Synoptic surface obs
│   ├─ /api/storm/mping            → mPING crowd reports
│   └─ /api/hail/storm-report-pdf  → buildStormReportPdf (PDFKit)
│  storm/                                ← all the science
│   ├─ mrmsService / mrmsFetch / mrmsRaster — GRIB2 decoder + polygon builder
│   ├─ consilienceService — 12-source corroboration + Forensic Verification stamp
│   ├─ iemVtecClient — NWS warnings (api.weather.gov fallback for last ~30 days)
│   ├─ nexradImageService — IEM N0R WMS-T reflectivity snapshots
│   ├─ eventService — SPC + IEM LSR live aggregation + cache
│   ├─ narrativeComposer — Verisk-aligned hail-size prose
│   ├─ hailFallbackService — IHM-style swath fallback when MRMS unavailable
│   ├─ reportPdf — PDF generator (~1900 lines, focus area)
│   └─ geometry — pointInRing + haversine
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────── Postgres (Railway) ──────────────────────┐
│  verified_hail_events     (per-event rows; 5 source flags)
│  swath_cache              (MRMS swath polygons, keyed source/date/bbox_hash)
│  consilience_cache        (12-source corroboration result, 0.01° + radius)
│  event_cache              (storm event aggregator results, JSONB)
│  storm_days view          (event_date,lat_bucket,lng_bucket → max_hail rollup)
│  push_subscriptions       (web push VAPID subscribers)
│  reports / leads / users / etc (rep-facing app tables)
└─────────────────────────────────────────────────────────────┘
```

---

## Major features delivered (cumulative this session, oldest → newest)

### Phase 1 — IHM parity & vector swaths
- **Three-tier classifier** — DIRECT HIT / NEAR MISS / AREA IMPACT / NO IMPACT, mutually exclusive distance bands (At Property 0–1mi, 1–3mi, 3–5mi, 5–10mi)
- **MRMS vector swath polygons** — pure-JS GRIB2 decoder reading MRMS_Max_60min / MRMS_Max_1440min / MESH instantaneous, with archive fallback to MESH when 60min unavailable
- **¼" display floor** — Verisk-aligned, sub-trace radar signatures rounded for adjuster use
- **Per-band columns** in PDF + UI matching HailTrace/IHM column layout

### Phase 2 — Live & historical data layers
- **Hourly MRMS scrubber** with 24 anchors per day, ScrubMode toggle (MRMS / NEXRAD), auto-enable showMrms when historical date selected
- **Live Storm Cells layer** — auto-on in LIVE mode, ActiveStormsPanel auto-fills with firing storms (90s poll)
- **MRMS tiered alerts** — 0.25″ / 0.5″ / 1.0″ thresholds, gated by `LIVE_MRMS_ALERT_ENABLED=approval-gate`
- **NWS warnings** for VA/MD/PA/DC/WV via IEM VTEC (now api.weather.gov fallback)
- **CoCoRaHS layer** — observer reports
- **NEXRAD Mesocyclone layer** — nx3mda rotation signatures
- **Synoptic surface stations layer** — wind/temp/pressure obs
- **mPING layer** — crowd-source hail/wind reports

### Phase 3 — Forensic consilience
- **12-source consilience** with Forensic Verification stamp (≥3 confirming sources)
- **Source taxonomy:** SPC raw + IEM LSR + MRMS MESH + NCEI Storm Events + NCEI SWDI + mPING + HailTrace + NWS warnings + Wind reports + Synoptic + NEXRAD nx3mda + CoCoRaHS

### Phase 4 — Property context layers
- **OSM building footprint overlay** (replaced broken county ArcGIS endpoints)
- **Street View Static API** thumbnails embedded in PDF cover card
- **Google Maps Static API** basemap for the Hail Footprint Map
- **NEXRAD reflectivity overlay** at storm peak time on top of basemap

### Phase 5 — Rep workflow
- **Field Inspection sketch mode** — drawing tools persist by property+date in localStorage
- **Maps deep-link** — Navigate / Turn-by-Turn with multi-waypoint routing
- **Geofence auto-knock log** — 60m radius / 20s dwell trigger
- **Web push subscriptions** (VAPID) — alert reps when MRMS fires nearby
- **Mobile form polish** — 16px text inputs (no zoom-on-focus), auto-expanding textarea, flex-col + Tailwind `order` utilities for proper scroll

### Phase 6 — Storm narrative composer
- Verisk-aligned hail-size descriptors (pea/marble/penny/quarter/half-dollar/ping-pong/golf-ball/lime/tennis/baseball/softball)
- Lead-with-wind logic when hail is sub-threshold
- BIGGEST HAIL / CLOSEST HAIL callout helpers
- Round-up to standard adjuster sizes (¼", ½", ¾", 1", 1¼", 1½", 1¾", 2"...)

### Phase 7 — Adjuster-grade PDF (most recent, last 15 commits)
**Built up across:**

| Commit | What it did |
|---|---|
| `2c11266` | SA21-grade professionalism — navy header banner, gray section banners, Data Sources & Methodology, Disclaimer |
| `30de4a7` | Drop bufferPages per-page footer (caused 3 phantom blank pages) |
| `c19a05a` | **Close SA21 coverage gap** — multi-source query (was NCEI-only); 12→25mi radius; 18→24mo window; real lat/lng distances (was defaulting to 5mi via sparse-cache join bug) |
| `0ee9cfa` | Hit-history label text update |
| `d2b71fe` | Per-date `buildMrmsImpactResponse` swath check for historical dates |
| `aa36b19` | swath_cache direct-hit scan finds dates that NCEI doesn't have |
| `4ee37e2` | **Credibility filter** (drop >10mi rows from hit history); Damage Score card removed; SA21-style NWS warning panel |
| `46e6e17` | Honest distance bands ("within 5–10 mi" instead of misleading "11.0 mi away") |
| `8e15c3b` | Fixed broken IEM watchwarn (HTTP 422 silent for months); switched to api.weather.gov fallback |
| `a8172ff` | Cleaner Hail Footprint legend |
| `68dc178` | Legend fraction glyph fix (Helvetica missing ⅛/⅜ — show "1/8") |
| `8bee23c` | **Merged hit-history + per-band into one table**; round-up display (0.38" → 0.50"); NEXRAD overlay on Hail Footprint Map |
| `02af958` | Round-up applied to LARGEST HAIL summary card |
| `9b7c61e` | Round-up applied to BIGGEST HAIL callout + Storm Impact Narrative prose |
| `14f9806` | **Removed NCEI Storm Events Archive (Appendix)** — was bloating PDF to 5 pages |

**Final PDF structure (3 pages):**
1. Navy header banner ("Storm Impact Analysis") + sub-header (Report#, Date, Prepared by, rep info, Verification Code) + property summary line + Storm Coverage tier card with Street View + merged Property Hail Hit History table (tier badge + date + per-band columns + Biggest Nearby) + Storm Impact Narrative + Storm Summary 2-card panel (LARGEST HAIL DAY / PEAK WIND DAY in big orange numerals, no Damage Score)
2. NEXRAD Radar + Hail Footprint Map (Google basemap + NEXRAD overlay + swath polygons + property pin + below-map legend) + Data Sources & Methodology (6 federal sources bulleted)
3. Disclaimer & Limitations + closing italic line "Prepared by {Company} · Data sourced from NOAA, NWS, NEXRAD federal weather systems · © {year}"

---

## Known limitations / open work

These came up during the polish work and were left as out-of-scope. Pick up if relevant.

### 1. NWS warning panel only works for dates within last ~30 days

`server/storm/iemVtecClient.ts::fetchIemVtecForDate` falls back to `api.weather.gov/alerts` for warning data. NWS only retains ~30 days of historical alerts at that endpoint. For older dates of loss the "Active National Weather Service Warnings" section auto-hides.

The original IEM endpoint (`https://mesonet.agron.iastate.edu/cgi-bin/request/gis/watchwarn.py`) holds the full historical archive but silently ignores `fmt=geojson` and always returns a ZIP shapefile. We attempted the ISO 8601 timestamp fix in `8e15c3b` but the format issue remains.

**Path forward:** add a ZIP shapefile parser as a separate ingest service that writes warning polygons to a `nws_warnings_archive` table indexed by date + bbox. Then `fetchIemVtecForDate` queries that table instead of (or in addition to) api.weather.gov.

### 2. verified_hail_events backfill is sparse vs SA21

For 1255 Barksdale Dr NE, Leesburg VA, SA21 surfaces 15 hail dates / 605 reports over 24 months. We surface 5–7 (after the >10mi credibility filter). Same schema, different ingest depth.

Missing dates SA21 has but we don't:
- Apr 24 2026 (very recent)
- Aug 17 2025 + Aug 16 2025
- Jul 31 2025
- ...

Source flags we have: `source_ncei_storm_events`, `source_ncei_swdi`, `source_mping`, `source_hailtrace`, `source_nws_warnings`. SA21 also has `source_iem_lsr`, `source_cocorahs`, `source_mrms_swath` (different schema for a different ingest pipeline).

**Path forward:** backfill jobs for VA/MD/PA/DE/NJ/DC/WV 2024–2026:
- NCEI Storm Events bulk download (state CSVs)
- IEM LSR for the 45-day pre-NCEI window
- CoCoRaHS observer reports (free API)
- SPC WCM archive for cross-source confirmation

### 3. swath_cache only has entries for dates reps have viewed

The MRMS swath cache populates lazily on map render. The PDF's swath direct-hit scan in `reportPdf.ts` queries `swath_cache` for any cached polygon containing the property point in the last 24 months. Coverage grows organically with rep usage but you can pre-warm by running the swath builder for every date in a target window.

**Path forward:** schedule a cron that calls `buildMrmsVectorPolygons` for every date 2024-01-01 through today across the focus-region bbox, populating swath_cache during off-hours.

### 4. NEXRAD overlay shows nothing on quiet days

`fetchNexradSnapshot` (`server/storm/nexradImageService.ts`) pulls IEM N0R reflectivity for the storm peak time. On dates with no significant echoes near the property (e.g. 1255 Barksdale on 2025-06-27), the overlay is mostly transparent — visually weak. The fetch IS working; the data is genuinely empty.

**Path forward (if user complains):** detect when the radar has no echoes inside the bounds and either (a) hide the "NEXRAD Radar +" prefix from the section title, (b) fall back to the busiest historical hit date's NEXRAD snapshot, or (c) replace with an MRMS swath aggregate visualization for that date.

### 5. Stripe paywall scheduled for removal

The `claude/improve-storm-maps-ZElfS` branch includes Stripe scaffolding (carried over from a prior iteration) that the user wants removed. Not yet done.

### 6. fetchStormEventsCached doesn't query verified_hail_events

The live event aggregator at `server/storm/eventService.ts::fetchStormEventsCached` only pulls SPC + IEM LSR. It does NOT query our local `verified_hail_events` table — meaning the `/api/storm/events` endpoint returns sparse results for historical queries (SPC archive ~7 days, IEM LSR same-day). Events older than that are invisible to the live event search even though they're in the DB.

**Path forward:** extend `fetchStormEventsCached` to UNION verified_hail_events for the requested window before falling back to live SPC/IEM. Already partially mitigated for the PDF by `fetchNceiArchiveForReport` (which DOES query verified_hail_events directly), but the API endpoint and the frontend Recent Storm Dates list still suffer.

---

## Files of interest

| File | Purpose |
|---|---|
| `server/storm/reportPdf.ts` | PDF generator. ~1900 lines. Most recent work. |
| `server/storm/narrativeComposer.ts` | Storm Impact Narrative prose + BIGGEST/CLOSEST callouts. Has `roundUpHailIn` helper. |
| `server/storm/iemVtecClient.ts` | NWS warnings fetcher. IEM watchwarn → api.weather.gov fallback. |
| `server/storm/mrmsService.ts` | MRMS swath polygon fetcher + point-in-polygon impact response (`buildMrmsImpactResponse`). |
| `server/storm/mrmsFetch.ts` | MRMS GRIB2 fetch (3 products: MESH_Max_60min, MESH_Max_1440min, MESH instantaneous). |
| `server/storm/mrmsRaster.ts` | GRIB2 raster decoder. Falls back mesh60 → MESH instantaneous when archive lacks 60min product. |
| `server/storm/eventService.ts` | `fetchStormEventsCached` — pulls SPC + IEM LSR live. **Does NOT query verified_hail_events** (gap). |
| `server/storm/consilienceService.ts` | 12-source consilience + Forensic Verification stamp. |
| `server/storm/nexradImageService.ts` | IEM N0R WMS-T reflectivity snapshot fetcher. |
| `server/storm/hailFallbackService.ts` | IHM-style swath fallback when MRMS unavailable. Also defines `IHM_HAIL_LEVELS` (color palette + labels). |
| `server/storm/geometry.ts` | `pointInRing`, `haversineMiles`, `nearestRingDistanceMiles`. |
| `server/migrate.ts` | Schema. `verified_hail_events` + source flag columns + `swath_cache` + `consilience_cache` + `event_cache` + `storm_days` view. |
| `server/index.ts` | Express app + routes. `/api/hail/storm-report-pdf` at line ~928. |
| `src/components/StormMap.tsx` | Master map component. |
| `src/components/ActiveStormsPanel.tsx` | Live storms sidebar (auto-fills, polls 90s). |
| `src/components/LiveStormCellsLayer.tsx` | MRMS now-cast hail polygons + NWS warnings on map. |

---

## Test commands

```bash
# Local dev
cd /Users/a21/Desktop/storm-maps
npm run build                    # TS check + Vite build
npm run dev                      # Frontend dev server (5173)
npm run dev:server               # Backend dev server with .env.local

# Generate a PDF against prod
curl -s -X POST -H "Content-Type: application/json" -d '{
  "address":"1255 Barksdale Dr NE, Leesburg, VA 20176",
  "lat":39.1286026,
  "lng":-77.5425290,
  "dateOfLoss":"2025-06-27",
  "radiusMiles":15,
  "rep":{"name":"Ahmed Mahmoud","email":"ahmed.mahmoud@theroofdocs.com"},
  "company":{"name":"Roof-ER21"}
}' "https://hailyes.up.railway.app/api/hail/storm-report-pdf" -o /tmp/test.pdf

# Inspect
pdfinfo /tmp/test.pdf
pdftotext -layout /tmp/test.pdf -
pdftoppm -r 110 /tmp/test.pdf /tmp/test -png   # visual page renders
```

## Deploy command

```bash
cd /Users/a21/Desktop/storm-maps && railway up --detach
```

Pre-push hook is unreliable (says "up to date" while Railway rejects fresh builds). Verify by polling `/api/health` timestamp until it rolls forward, or check the home page hash:
```bash
curl -s https://hailyes.up.railway.app/ | grep -oE 'index-[A-Za-z0-9_-]+\.js'
```

---

## Test addresses & dates

| Address | Date of Loss | Why |
|---|---|---|
| 1255 Barksdale Dr NE, Leesburg VA 20176 | 2026-04-01 | Quiet day at property — tests "NO IMPACT" cover card + empty NWS panel auto-hide |
| 1255 Barksdale Dr NE, Leesburg VA 20176 | 2025-06-27 | User's recent test — quiet at property, 1.50" hail somewhere in 15mi bounds |
| 1255 Barksdale Dr NE, Leesburg VA 20176 | 2025-05-03 | Hit history DIRECT HIT date — swath_cache contains the property point |
| 17032 Silver Charm Pl, Leesburg VA 20176 | 2025-05-16 | SA21's example date — 5 NWS warnings, 1.25" hail, 65mph wind |

---

## Memory pointers

- **CLAUDE.md** at `/Users/a21/CLAUDE.md` — global config + project map for the user's workspace
- **Memory Palace MCP** — primary memory system; load core memories with `mcp__memory-palace__read_memory(uri="system://boot")`
- **claude-mem** is backup
- **Auto-memory** at `/Users/a21/.claude/projects/-Users-a21/memory/MEMORY.md` — index of saved context
- Storm-maps-specific memories already saved:
  - `hail-yes-project.md` — Hail Yes overall context
  - `storm-pipeline-apr20.md` — pipeline overhaul history
  - `sa21-session-apr24.md` + `sa21-session-apr25.md` — recent SA21 work
  - `storm-maps-vector-swaths-apr17.md` — IHM-parity vector swath work
  - `feedback_swath-first-direct-hit.md` — UI/PDF/Susan must agree: inside an MRMS swath = DIRECT HIT
  - `feedback_storm-data-sources.md` — only qualified/verifiable sources (NOAA/NWS/NEXRAD) belong in `verified_hail_events`; GroupMe chatter is reference-only

---

## Email tooling

User's outbound email goes through `/Users/a21/bin/ahmed21-send` (Gmail, NOT Zapier — Zapier is metered and fails):

```bash
ahmed21-send send \
  --to ahmed.mahmoud@theroofdocs.com \
  --subject "..." \
  --body-file /tmp/email.html --html \
  --attach /tmp/test.pdf
```

---

## What the user is likely to ask next

1. **Backfill verified_hail_events** to close the 7-vs-15-dates gap with SA21 — biggest single coverage win
2. **Pre-warm swath_cache** for the focus region across 2024–2026 — improves DIRECT HIT classification
3. **NWS warning archive parser** so the warnings panel works for historical dates of loss — adjusters love radar-paired warning panels
4. **Strip Stripe** from `claude/improve-storm-maps-ZElfS` and merge to main
5. **PDF tightening to 2 pages** — the current page 3 is mostly empty (just Disclaimer); could compact methodology so Disclaimer fits on page 2
6. **Wire fetchStormEventsCached to verified_hail_events** so the live UI's Recent Storm Dates list shows historical depth

---

## User communication style

- Sends short feedback messages with screenshots ("this looks horrible", "looks good but...")
- Wants iteration on a specific test PDF, then email it back when fixed
- Prefers direct fixes over plans
- Always email the regenerated PDF to ahmed.mahmoud@theroofdocs.com after a meaningful change
- Use `ahmed21-send` not Zapier
- "CC" / "CC21" always means **The CC21** project (different repo), NEVER susan21-command-center
- "SA21" is gemini-field-assistant (https://sa21.up.railway.app), the sister storm-intelligence app
- Round-up rule: 0.38" → 0.50", 1.41" → 1.50" — adjusters and reps don't speak in 0.37 or 0.42
- Credibility rule: anything tagged AREA IMPACT must be within 10 mi (cover card promise must hold)
