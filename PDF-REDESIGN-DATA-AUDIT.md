# PDF Redesign Data Audit

**Date:** 2026-04-27  
**Spec Reference:** PDF-REDESIGN-SPEC-2026-04-27.md  
**Audit Scope:** Verify which data fields needed by the new PDF layout already exist in the codebase vs. require new implementation.

---

## Summary Table

| # | Field | Status | Where It Lives | Notes / What's Missing |
|---|---|---|---|---|
| 1 | **Storm direction** (cardinal heading N/E/S/W) | MISSING | — | No utility exists to compute azimuth/bearing from event tracks. Must derive mean heading from lat/lng displacement across events on date. Suggest adding to `server/storm/geometry.ts` or new `trackService.ts`. |
| 2 | **Storm speed** (mph from track displacement / time) | MISSING | — | No speed computation utility exists. Must calculate mean speed from event lat/lng/time displacement. Recommend adding to same service as #1. |
| 3 | **Hail duration** (minutes first-to-last hail event on date) | PARTIAL | `server/storm/reportPdf.ts:1496-1506` (peakHailEvents), `server/storm/eventService.ts:28-43` (StormEventDto) | Event times exist (`beginDate`/`endDate` in StormEventDto, `begin_time_utc`/`end_time_utc` in DB), but no helper to compute span. Trivial to add in PDF renderer; no data-layer work needed. |
| 4 | **Storm peak time** (earliest begin_time on date of loss) | EXISTS | `server/storm/reportPdf.ts:1743-1747` | Already used in PDF to find peak NEXRAD time. Query events array, sort by beginDate ascending, return first. |
| 5 | **NWS Severe Thunderstorm warnings** (SBW polygons) | PARTIAL | DB: `source_nws_warnings` boolean flag in `verified_hail_events` (line 280 of migrate.ts); IEM fetch: `server/storm/iemVtecClient.ts` | **Flag exists but NOT polygons.** `verified_hail_events` only stores boolean `source_nws_warnings=TRUE`. Polygons must be fetched live from IEM SBW GeoJSON endpoint (`fetchIemVtecWarnings()` at iemVtecClient.ts:91). Spec says "if the table doesn't carry SBW polygons, fall back to fresh IEM query" — this is that fallback. |
| 6 | **NEXRAD radar imagery** (PNG for specific timestamp) | EXISTS | `server/storm/nexradImageService.ts` | `fetchNexradSnapshot()` already pulls WMS-T base-reflectivity PNGs from IEM ridge archive (`mesonet.agron.iastate.edu/cgi-bin/wms/nexrad/n0r-t.cgi`). Snaps to 5-min grid, 20s timeout, returns Buffer. Ready to use in Section 6. |
| 7 | **NCEI/IEM LSR narrative** (per-row comment field) | EXISTS | `verified_hail_events.narrative` (TEXT, added at migrate.ts:289); `NceiAppendixRow.narrative` (reportPdf.ts:60) | `narrative` column exists in DB and is populated by ingest pipeline. SELECT clause in `fetchNceiArchiveForReport()` (reportPdf.ts:107, 130) already pulls it. Ready for Section 4 Comments. |
| 8 | **Dominant track direction** (multi-event N vs E vs N→E, not just first event) | MISSING | — | No centroid/mean-azimuth utility. Requires same bearing computation as #1. Must synthesize heading across all events on date (not per-row). Same implementation as #1. |

---

## Detailed Findings

### 1. Storm Direction (Cardinal Heading)

**Status:** `MISSING`

**Evidence:**
- No `computeStormDirection`, `calculateAzimuth`, `bearing`, or similar function found in:
  - `server/storm/geometry.ts` (haversine, buffer, point-in-ring exist; no bearing)
  - `server/storm/windSwathService.ts` (handles swath polygons, not track direction)
  - `server/storm/*.ts` (searched 40+ files; no direction/azimuth utilities)

**What's needed:**
- Accept list of events with `{lat, lng, time}` for a given date
- Compute mean azimuth (bearing) from property→event vectors or event-to-event deltas
- Convert bearing (0–360°) to cardinal (N/NE/E/SE/S/SW/W/NW or 16-point)
- Return cardinal string or "—" if no track available

**Suggested approach:**
- Add `computeStormAzimuth(events: {lat: number; lng: number; time: string}[]): number` to `geometry.ts`
  - Use atan2 on Δlat/Δlng (local equirectangular OK for continental US)
- Add `azimuthToCardinal(degrees: number): string` helper to convert bearing → "N", "NNE", etc.
- Call from PDF Section 2 after filtering events to date-of-loss

---

### 2. Storm Speed (mph)

**Status:** `MISSING`

**Evidence:**
- No `computeStormSpeed`, `trackSpeed`, or wind-velocity utility found
- `windSwathService.ts` dedupes wind reports but doesn't compute storm motion speed
- Wind gust speeds exist (from ASOS, LSR), but that's not storm translation speed

**What's needed:**
- Accept list of events with `{lat, lng, time}` for a given date
- Compute displacement between first and last event
- Divide by elapsed time → mph
- Return formatted speed or "—"

**Suggested approach:**
- Add `computeStormSpeed(events: {lat: number; lng: number; time: string}[]): number` to `geometry.ts`
  - Use haversineMiles (already exported)
  - Sort events by time; compute Δdist / Δtime in hours
- Call from PDF Section 2 after filtering to date-of-loss

---

### 3. Hail Duration (Minutes)

**Status:** `PARTIAL` — data exists, no utility

**Evidence:**
- Events have `begin_time_utc`/`end_time_utc` in DB (`migrate.ts:290–291`)
- `StormEventDto` has `beginDate`/`endDate` (`eventService.ts:33–34`)
- `reportPdf.ts:1496–1506` already filters `datedEvents` by date
- Report PDF calls `composeStormNarrative()` which works with event times

**What exists:**
- Full timestamp precision in both DB and event DTO
- Already filtering to dateOfLoss in PDF generation

**What's missing:**
- No dedicated `computeHailDuration()` helper
- Logic must live in PDF renderer or a simple utility function

**Suggested approach:**
- Add small utility: `computeHailDuration(events: StormEventDto[], dateStr: string): number`
  - Filter events to matching date
  - Find min/max `beginDate`
  - Return (max - min) in minutes with 1 decimal
- Trivial JS, no DB work needed

---

### 4. Storm Peak Time (Earliest Hail Event)

**Status:** `EXISTS`

**Evidence:**
- `reportPdf.ts:1743–1747` already uses this logic to find peak NEXRAD time:
  ```typescript
  const peak = [...datedEvents]
    .filter((e) => e.eventType === 'Hail')
    .sort((a, b) => new Date(a.beginDate).getTime() - new Date(b.beginDate).getTime());
  return peak[0]?.beginDate;
  ```
- Events are already sorted by time; first hail event = peak

**What's already done:**
- Filtering by `Hail` event type
- Sorting ascending by `beginDate`
- Direct access to formatted time string

**Suggested approach:**
- Extract the peak-time logic to a reusable function or inline in Section 2 table render
- Format as `h:mm A z` (e.g., "5:00 PM EDT") — already done elsewhere in PDF via `formatStormTime()`

---

### 5. NWS Severe Thunderstorm Warnings (SBW Polygons)

**Status:** `PARTIAL` — flag exists, polygons must be fetched live

**Database Schema:**
- `verified_hail_events.source_nws_warnings BOOLEAN` exists (migrate.ts:280)
- No polygon geometry column
- No separate `nws_warnings` table

**Live Fetch Infrastructure:**
- `server/storm/iemVtecClient.ts:91–130` exports `fetchIemVtecWarnings()`
  - Returns `IemVtecWarning[]` with:
    - `issueIso`, `expireIso` (timestamps)
    - `phenomenon` ('SV' = Severe Thunderstorm)
    - `wfo` (forecast office)
    - `rings: number[][][]` (polygon coordinates)
    - `product?: string` (narrative)
  - Calls IEM GeoJSON SBW endpoint
  - Already used in consilience logic

**What's missing:**
1. New function `fetchNwsWarningsForProperty()` mentioned in spec (line 226 of PDF-REDESIGN-SPEC)
   - Query `verified_hail_events` where `source_nws_warnings=TRUE` (supplement with live IEM query if none found)
   - Filter by date-of-loss + 2-day window
   - `pointInRing()` test to ensure polygon contains property
2. Per-warning NEXRAD image fetch (see #6 below)

**Suggested approach:**
- Add `server/storm/nwsWarningsService.ts`:
  ```typescript
  export async function fetchNwsWarningsForProperty(
    lat: number, lng: number, dateOfLoss: string, days = 2
  ): Promise<IemVtecWarning[]>
  ```
  - Query DB for rows with `source_nws_warnings=TRUE` on dateOfLoss ± days
  - Filter by `pointInRing(property, polygon)`
  - Supplement with live `fetchIemVtecWarnings()` if DB yields nothing
- Reuse existing `pointInRing()` from `geometry.ts`

---

### 6. NEXRAD Radar Imagery (PNG for Timestamp)

**Status:** `EXISTS`

**Code Location:**
- `server/storm/nexradImageService.ts` — complete implementation
  - `fetchNexradSnapshot(input: NexradSnapshotInput): Promise<Buffer | null>`
  - Uses IEM WMS-T endpoint: `mesonet.agron.iastate.edu/cgi-bin/wms/nexrad/n0r-t.cgi`
  - Snaps timestamp to 5-min grid
  - Configurable bbox and image dimensions (default 600×400)
  - 20s timeout, returns null on failure
  - Ready to embed in PDF Section 6

**What's already done:**
- Full endpoint integration
- Time-snapping logic
- Error handling with graceful fallback
- Already imported and used in `reportPdf.ts:32`

**Suggested approach:**
- For Section 6 (per-warning radar):
  - Call `fetchNexradSnapshot()` with warning's `issueIso` (effective time)
  - Pass property lat/lng for bbox centering
  - Cache result in-memory (LRU per spec 8s timeout per warning)
  - If fetch fails, leave column blank (per spec line 160)

---

### 7. NCEI / IEM LSR Narrative (Per-Row Comment Field)

**Status:** `EXISTS`

**Database:**
- `verified_hail_events.narrative TEXT` (migrate.ts:289)
- Populated by ingest pipeline from NCEI Storm Events + IEM LSR comments

**Code:**
- `NceiAppendixRow.narrative` defined (reportPdf.ts:60)
- `fetchNceiArchiveForReport()` SELECT includes narrative:
  - Line 107: `begin_time_utc::text, narrative,`
  - Line 130: `begin_time_utc::text, narrative,`
- Already returned to PDF renderer

**What's ready:**
- Column exists and is populated
- Already in query result
- Just needs to be displayed in Section 4 Comments column

**Suggested approach:**
- Render `narrative` directly from query result
- Fall back to "—" if null/empty
- No additional data-layer work needed

---

### 8. Dominant Track Direction (Multi-Event Synthesis)

**Status:** `MISSING`

**Differs from #1:**
- #1 is per-row: azimuth of a single event relative to property
- #8 is global: overall storm motion direction from centroid/vector average of all events on date
- Example: cluster moves N→E from first to last event → report "NE", not just "E"

**Evidence:**
- No `computeDominantTrackDirection()` or similar
- Spec line 176: "Cardinal heading (N/E/S/W or compass mid-points), or "—" when track unknown"

**What's needed:**
- Accept all events on date-of-loss
- Compute centroid of first 25% and last 25% of events (by time)
- Calculate azimuth between centroids
- Convert to cardinal

**Suggested approach:**
- Reuse azimuth logic from #1
- Add:
  ```typescript
  function computeDominantTrackDirection(
    events: {lat: number; lng: number; time: string}[]
  ): string
  ```
  - Sort by time
  - Take first quartile and last quartile by count
  - Compute centroid of each quartile
  - Compute azimuth between centroids
  - Return cardinal string
- Use in Section 7 Historical Storm Activity table

---

## Implementation Roadmap

### Phase 1: Geometry Utilities (No DB changes)
**Effort:** ~2 hours  
**Files to create/modify:**
- `server/storm/geometry.ts` — add:
  - `computeStormAzimuth(events): number` (bearing in degrees)
  - `azimuthToCardinal(degrees): string` (16-point compass)
  - `computeDominantTrackDirection(events): string` (multi-event azimuth)

**Reuse:**
- `haversineMiles()` (already exported)
- `pointInRing()` (already exported)

---

### Phase 2: Storm Services (No DB changes)
**Effort:** ~3 hours  
**Files to create:**
- `server/storm/nwsWarningsService.ts` — add:
  - `fetchNwsWarningsForProperty(lat, lng, dateOfLoss, days)`: Promise<IemVtecWarning[]>
    - Query `verified_hail_events` for `source_nws_warnings=TRUE`
    - Supplement with live IEM SBW fetch
    - Filter by `pointInRing()`

**Reuse:**
- `fetchIemVtecWarnings()` from `iemVtecClient.ts` (already exported)
- `pointInRing()` from `geometry.ts`
- `fetchNexradSnapshot()` from `nexradImageService.ts` (already exported)

---

### Phase 3: PDF Section Updates (No DB changes)
**Effort:** ~4 hours  
**File:** `server/storm/reportPdf.ts` — wire in:
- Section 2 Hail Impact Details:
  - `computeStormAzimuth()` → Storm Direction field
  - `computeStormSpeed()` → Storm Speed field
  - `computeHailDuration()` → Hail Duration field
  - Peak time (already exists, just format)

- Section 6 Severe Weather Warnings:
  - `fetchNwsWarningsForProperty()` → warning blocks
  - `fetchNexradSnapshot()` per warning effective time

- Section 7 Historical Storm Activity:
  - `computeDominantTrackDirection()` → Direction column
  - `computeStormSpeed()` → Speed column (per-row or per-date?)
  - `computeHailDuration()` → Duration column (per-row or per-date?)

---

## Data Checklist

✓ = data exists, no work needed  
○ = data exists, utility wrapper needed  
✗ = must implement from scratch

| Field | DB | Utility | PDF |
|---|---|---|---|
| Storm direction | ✓ (lat/lng/time) | ✗ | ○ |
| Storm speed | ✓ (lat/lng/time) | ✗ | ○ |
| Hail duration | ✓ (begin_time_utc) | ✗ | ○ |
| Storm peak time | ✓ (begin_time_utc) | ○ (inline) | ○ |
| NWS warnings polygon | ✗ (fetch live) | ○ (wrapper) | ○ |
| NEXRAD radar PNG | ✓ (IEM API) | ✓ | ○ |
| NCEI narrative | ✓ (verified_hail_events) | — | ○ |
| Dominant track dir | ✓ (lat/lng/time) | ✗ | ○ |

---

## Conclusion

**No database schema changes are required.** All raw data (lat, lng, timestamps, narrative) exists.

**Estimated effort:**
- **Geometry/track utilities:** 2 hours
- **NWS warnings service:** 1 hour
- **PDF wire-in:** 4–6 hours
- **Testing + polish:** 2–3 hours
- **Total:** ~10 hours for backend engineer

**Start with:** Geometry utilities (azimuth/cardinal/speed/duration) because they're reused across multiple sections and have zero dependencies.

