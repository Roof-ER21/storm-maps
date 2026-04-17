# HANDOFF: MRMS Vector Swath Polygon Pipeline

**Date:** 2026-04-16
**Author:** Claude (web-recon competitive analysis → implementation)
**Status:** Code complete, TypeScript clean, NOT yet committed/deployed
**Goal:** Replace blurry raster hail overlays with crisp, clickable vector polygons matching IHM/HailTrace quality

---

## CONTEXT

### Why This Exists

The user (Ahmed, Roof-ER21) runs a roofing company. Reps currently use **Hail Recon ($999-1,999/yr)** and **HailTrace ($600-1,200/yr)** for hail storm maps. We built a free alternative using the same federal NEXRAD/MRMS radar data, but our swath visualization renders as a **blurry raster PNG overlay** (ImageOverlay on the map). Competitors render **crisp vector polygons** with 10 forensic hail size levels that are clickable and stay sharp at any zoom.

This implementation converts our existing MRMS GRIB data pipeline into vector polygon output using d3-contour (marching squares algorithm). Same data source, better rendering.

### Competitive Intelligence (Full Reports)

All research at `~/web-recon/data/reports/hailmaps/FINAL/`:
- `01_COMPLETE_SYSTEM_MAP.md` — Interactive Hail Maps (50+ API endpoints, full JS reverse-engineered)
- `02_STORM_MAPS_COMPARISON.md` — Our system vs IHM side-by-side
- `03_HAILTRACE_SYSTEM_MAP.md` — HailTrace (16 meteorologists, Cole Information data)
- `04_SUPERCHARGE_PLAN.md` — 10-upgrade roadmap with priorities

### Architecture

```
Two projects involved:

1. Susan21 Backend (~/gemini-field-assistant/)
   - Hosts the MRMS/hail API endpoints
   - Production: sa21.up.railway.app
   - The Hail Yes frontend calls this backend

2. Hail Yes Frontend (~/Desktop/storm-maps/)
   - Standalone storm maps app (Google Maps)
   - Production: hailyes.up.railway.app
   - GitHub: Roof-ER21/storm-maps
```

---

## CHANGES MADE

### Project 1: Susan21 Backend (`~/gemini-field-assistant/`)

#### NEW: `server/services/meshVectorService.ts`
- **Purpose:** Converts MRMS MESH Float32Array grid → GeoJSON FeatureCollection
- **Algorithm:** d3-contour (marching squares) at 10 threshold levels
- **Input:** `GridInput` with mmGrid, width, height, geographic bounds
- **Output:** `SwathPolygonCollection` (GeoJSON FeatureCollection with metadata)
- **10 Levels:** 0.50" to 3.00"+ in 0.25" increments, colors #FFFF99→#9900FF (matching IHM exactly)
- **Simplification:** Points within 1.5px of each other are deduplicated (~60-80% reduction)
- **Dependencies:** `d3-contour` (installed via npm, no DOM dependency)

#### MODIFIED: `server/services/historicalMrmsService.ts`
- **Added:** `getHistoricalMrmsSwathPolygons()` function (lines 953-1055)
- **What it does:**
  1. Reuses existing GRIB fetch + decode + composite pipeline (no duplication)
  2. Reuses `compositeGridCache` from the existing point query feature
  3. Crops the CONUS-wide grid to the requested bounds + 50km padding
  4. Passes cropped grid to `meshGridToPolygons()`
  5. Caches results for 6 hours (same as raster overlay)
- **Import added:** `meshVectorService.ts` (meshGridToPolygons, types)
- **Risk:** Low — only adds a new export function, doesn't modify existing functions

#### MODIFIED: `server/routes/hailRoutes.ts`
- **Added:** `GET /api/hail/mrms-swath-polygons` endpoint (line 1535)
- **Parameters:** Same as existing mrms-historical-image: `date, north, south, east, west, anchorTimestamp`
- **Response:** GeoJSON FeatureCollection with 10-level swath polygons
- **Import added:** `getHistoricalMrmsSwathPolygons` from historicalMrmsService

#### MODIFIED: `vite.config.ts`
- **Changed:** Dev proxy target from hardcoded `http://localhost:8080` to `http://localhost:${process.env.PORT || 3001}`
- **Added:** `/socket.io` proxy entry
- **Reason:** Port 8080 was taken by Docker; backend runs on PORT env var (default 3001)

#### NEW (but only for Susan21, not used by Hail Yes): `components/MRMSSwathPolygonLayer.tsx`
- Leaflet-based vector polygon renderer (for Susan21's React-Leaflet map)
- Not relevant to the Hail Yes deployment — Hail Yes uses Google Maps

#### INSTALLED: `d3-contour`, `d3-geo`, `@types/d3-contour`, `@types/d3-geo`

---

### Project 2: Hail Yes Frontend (`~/Desktop/storm-maps/`)

#### MODIFIED: `src/services/mrmsApi.ts`
- **Added:** `fetchSwathPolygons()` function and types (`SwathPolygonFeature`, `SwathPolygonCollection`)
- **Calls:** `${HAIL_YES_HAIL_API_BASE}/mrms-swath-polygons?${query}` (hits Susan21 backend)
- **Timeout:** 45 seconds (GRIB decode can be slow first time)

#### MODIFIED: `src/components/StormMap.tsx`
- **Added:** `vectorSwaths` state (`useState<MeshSwath[]>([])`)
- **Added:** useEffect that fetches vector polygons when `mrmsHistoricalMode && historicalMrmsParams && selectedDate`
- **Modified:** `swathsToRender` memo — when `vectorSwaths.length > 0`, uses those instead of NHP swaths or hiding swaths for MRMS raster
- **How it renders:** Converts `SwathPolygonFeature` → `MeshSwath` format → feeds into existing `HailSwathLayer` component (which already handles MultiPolygon geometry on Google Maps with click info, color coding, opacity)

---

## VERIFIED

### API Endpoint Test (Aug 29, 2024 storm near DC)
```
curl "http://localhost:3001/api/hail/mrms-swath-polygons?date=2024-08-29&north=39.5&south=38.5&east=-76.5&west=-77.5"

Results:
- 9 hail levels detected (½" through 2½")
- Max hail: 2.81 inches
- 28 polygons at trace level → 1 polygon at extreme
- 1,703 hail cells from 3 composite GRIB files
- Response size: ~40KB GeoJSON
```

### TypeScript
- Both projects compile clean (`npx tsc --noEmit` = 0 errors in modified files)
- Susan21: pre-existing errors only in `examples/susan-chat-example.ts` (unrelated)

### Vite Build
- `npx vite build` succeeds in 7 seconds
- TerritoryHailMap bundle: 106KB

---

## NOT YET DONE

### What Needs Review Before Deploying

1. **The vector polygons render alongside the raster overlay.** When `vectorSwaths` exist, they take priority in `swathsToRender`. But the MRMS raster `GroundOverlay` still renders underneath. Should the raster be hidden when vectors are available? Currently it provides a fallback/background. May want to set raster opacity lower or hide it entirely when vectors load successfully.

2. **The MeshSwath conversion is minimal.** The `areaSqMiles` is set to 0 and `statesAffected` is empty. The `HailSwathLayer` info popup will show "Approx. Area: 0.0 sq mi" for vector swaths. Either calculate area from polygon coordinates or suppress those fields when source is vector.

3. **No persistent storage yet.** The vector polygon results are cached in server memory (6h TTL). If the server restarts, cache is lost. The user specifically asked for data persistence — storing fetched storms and swath polygons in PostgreSQL so "when a rep looks it up again it's not lost." This needs a DB migration + caching layer.

4. **Storm freshness.** The user wants storms to show up "as soon as they happen." The current pipeline:
   - SPC Recent Reports: same-day (today + yesterday + 7-day archive) — **this works**
   - MRMS GRIB from IEM: available within ~1-2 hours — **this works**
   - NOAA Storm Events: multi-WEEK delay — **this is the gap between day 8 and whenever NOAA publishes**
   - The 7-day SPC + instant MRMS covers the critical "first week" window. Beyond that, there's a gap until NOAA publishes historical data.

5. **PDF reports.** The user also wants PDFs "on point." The contour overlay in PDFs (`contourOverlayService.ts`) still uses the old convex-hull-from-ground-reports approach. Could be upgraded to use the new vector polygons for much better accuracy. Not done yet.

6. **10 vs 7 color levels in Hail Yes legend.** The `Legend.tsx` component in Hail Yes shows 7 hail size categories. The new vector data has 10 levels. The legend should be updated to show all 10 for consistency.

7. **d3-contour `smooth` option.** Currently set to `true` which applies Laplacian smoothing. This makes polygons look organic/natural. If the user prefers harder edges (more like IHM), set `smooth(false)`.

---

## DATA FLOW DIAGRAM

```
Rep searches address in Hail Yes
       │
       ▼
Sidebar shows storm dates (SPC + NOAA data)
       │
       ▼
Rep clicks a storm date
       │
       ▼
StormMap.tsx sets mrmsHistoricalMode=true
       │
       ├──→ fetchHistoricalMrmsMetadata()  →  MRMS raster overlay loads (existing)
       │
       └──→ fetchSwathPolygons()           →  NEW: Vector polygons load
                │
                ▼
        Backend: getHistoricalMrmsSwathPolygons()
                │
                ├──→ Check compositeGridCache (reuse if available)
                │
                ├──→ Download 1-3 GRIB files from IEM MTArchive
                │
                ├──→ Decode GRIB → Float32Array mmGrid
                │
                ├──→ Composite (max MESH across time snapshots)
                │
                ├──→ Crop to requested bounds + 50km padding
                │
                ├──→ d3-contour at 10 thresholds (marching squares)
                │
                ├──→ Convert pixel coords → lat/lng
                │
                ├──→ Simplify (deduplicate close points)
                │
                └──→ Return GeoJSON FeatureCollection
                        │
                        ▼
        Frontend converts to MeshSwath[] format
                        │
                        ▼
        HailSwathLayer renders as Google Maps Polygons
        (clickable, colored, with InfoWindow on click)
```

---

## FILES CHANGED (Complete List)

### Susan21 Backend (`~/gemini-field-assistant/`)
| File | Action | Lines |
|------|--------|-------|
| `server/services/meshVectorService.ts` | NEW | ~180 |
| `server/services/historicalMrmsService.ts` | MODIFIED | +100 (new function at end) |
| `server/routes/hailRoutes.ts` | MODIFIED | +25 (new endpoint) |
| `components/MRMSSwathPolygonLayer.tsx` | NEW | ~220 (Leaflet version, Susan21 only) |
| `components/TerritoryHailMap.tsx` | MODIFIED | +6 (import + render) |
| `vite.config.ts` | MODIFIED | +4 (proxy fix) |
| `package.json` / `package-lock.json` | MODIFIED | d3-contour deps |

### Hail Yes Frontend (`~/Desktop/storm-maps/`)
| File | Action | Lines |
|------|--------|-------|
| `src/services/mrmsApi.ts` | MODIFIED | +56 |
| `src/components/StormMap.tsx` | MODIFIED | +40 |

---

## HOW TO TEST LOCALLY

```bash
# 1. Start Susan21 backend (the API)
cd ~/gemini-field-assistant
PORT=3001 npx tsx watch server/index.ts

# 2. Test the vector polygon endpoint directly
curl "http://localhost:3001/api/hail/mrms-swath-polygons?date=2024-08-29&north=39.5&south=38.5&east=-76.5&west=-77.5" | python3 -m json.tool | head -30

# 3. Start Hail Yes frontend (if testing frontend locally)
cd ~/Desktop/storm-maps
# Update .env.local to point to local backend:
#   VITE_HAIL_YES_API_BASE=http://localhost:3001/api
npm run dev

# 4. OR test against production backend
# The Hail Yes frontend defaults to sa21.up.railway.app/api
# So deploy Susan21 first, then Hail Yes will automatically use the new endpoint
```

## DEPLOY ORDER

1. **Deploy Susan21 first** (backend with new endpoint)
2. **Then deploy Hail Yes** (frontend that calls the new endpoint)
3. Test on hailyes.up.railway.app — search an address, click a storm date, verify vector polygons render

---

## KEY DECISIONS TO MAKE

1. **Hide raster when vectors load?** Currently both render. Raster provides fallback but is visual clutter.
2. **Add DB persistence now or later?** User specifically asked for it. Needs a `storm_swaths` table.
3. **Update legend to 10 levels?** Currently 7 categories in Legend.tsx.
4. **Upgrade PDF contours?** Use vector polygons instead of convex-hull approximation.
5. **Commit strategy?** One commit per project, or should we review/adjust first?
