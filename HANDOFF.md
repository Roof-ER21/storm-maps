# Storm Maps — Codex Handoff

## What We're Building

A standalone hail storm intelligence app for roofing professionals that replaces $8,000/year in IHM ($999-1,999/yr) + HailTrace ($50-99/mo) subscriptions. Reps use it to find where hail hit, when, how big, and knock doors in those neighborhoods.

Think: Interactive Hail Maps + HailTrace + GPS canvassing — all in one app at $0/year.

## Where Everything Lives

| Component | Location | Stack |
|-----------|----------|-------|
| **Standalone Storm Maps App** | `/Users/a21/Desktop/storm-maps/` | React 19 + TypeScript + Vite + Google Maps API + Tailwind |
| **GitHub** | `https://github.com/Roof-ER21/storm-maps` | |
| **Production** | `https://appealing-bravery-production-d7d6.up.railway.app` | Railway |
| **Field Assistant (data source)** | `/Users/a21/gemini-field-assistant/` | React + Vite + Express + PostgreSQL |
| **Field Assistant Production** | `https://sa21.up.railway.app` | Railway |
| **MRMS Tile Server** | `129.159.190.3:8080` (Oracle Cloud Free Tier) | Python + systemd |
| **MRMS Pipeline** | `/Users/a21/gemini-field-assistant/mrms-pipeline/` | Python (download_mrms.py, serve_tiles.py) |

## Architecture

```
[Storm Maps App (React)]
    |
    |-- Google Maps API (base map, markers, geocoding)
    |-- sa21.up.railway.app/api/hail/search (NOAA storm events - primary data)
    |-- sa21.up.railway.app/api/mrms/*.png (MRMS hail overlay - proxied from Oracle)
    |-- NHP FeatureServer (ArcGIS - MESH hail swath lines)
    |-- IEM WMS (NEXRAD radar tiles)
    |-- NCEI SWDI (fallback hail data)
```

### Data Flow
1. App loads → `useStormData` hook fetches from sa21 API (`/api/hail/search?lat=X&lng=Y&months=12&radius=75`)
2. sa21 server parses NOAA Storm Events bulk CSVs (yearly gzip files from ncei.noaa.gov)
3. Returns hail + wind events as JSON → app filters to hail only
4. Events grouped by date in sidebar, rendered as colored markers on Google Maps
5. NHP swath lines overlay shows storm paths (where available)
6. MRMS overlay shows real-time radar-derived hail detection (refreshes every 5 min)

## What Works

- [x] Google Maps rendering with API key (project: gen-lang-client on Google Cloud)
- [x] Sidebar with Recent/Impact tabs, storm date cards, severity badges
- [x] Address search (Google Geocoder, no Places API)
- [x] Storm data loading from field assistant API (CORS configured)
- [x] 53 hail events across 12 dates for DMV area (12-month range)
- [x] Colored AdvancedMarker dots on map (sized/colored by hail magnitude)
- [x] Date click → filters map to only that date's markers
- [x] InfoWindow popup on marker click (date, size, location, narrative)
- [x] NEXRAD radar tile overlay toggle
- [x] MRMS MESH hail overlay (proxied through sa21 to avoid mixed content)
- [x] NHP hail swath line rendering (LineString/MultiLineString support)
- [x] GPS blue dot tracking with pulsing animation
- [x] GPS "Center" button (appears when tracking)
- [x] Hail size legend (7-tier color scale, collapsible)
- [x] Satellite/roadmap toggle
- [x] Canvassing alert hook (detects when near hail zone)
- [x] Xactimate roofing codes database (103 codes in `src/data/xactimate-codes.ts`)
- [x] 253KB bundle (80KB gzip), builds in 77ms

## What Needs Work

### Priority 1 — Core UX
- [ ] **Territory squares**: Ahmed will draw custom territory boundaries (smaller than DMV/PA/RA). No data should display outside these squares. Waiting for his drawing → developer copies coordinates to the map.
- [ ] **No data outside territories**: When territories are defined, clip/filter events to only show inside territory bounds.
- [ ] **Push notifications for hail zones**: When GPS detects rep entering a hail-impacted area, send a native push notification (not just in-app toast). Needs service worker + Notification API.

### Priority 2 — Polish
- [ ] **Storm report generation**: Date of loss picker → generate PDF report for a specific address/date. The field assistant already has this at `/api/hail/generate-report` — needs to be wired up in the standalone app.
- [ ] **Swath visualization quality**: Current NHP swaths are thin polylines. Need thicker, gradient-filled paths like IHM/HailTrace. Consider rendering multiple overlapping polylines at different widths/opacities.
- [ ] **Historical date lookup**: Pick any date → load NEXRAD radar for that day, show what storms hit.
- [ ] **Remove "Invalid Date" entries**: If any event has a malformed date, skip it instead of showing "Invalid Date" in sidebar.

### Priority 3 — Data
- [ ] **SWDI data**: NCEI SWDI API returns 500 on large date ranges and has no data for some regions. Currently falls back to sa21 API which works. Could add more data sources.
- [ ] **NHP coverage**: The NHP HailSwathMESH_Lines_view dataset is primarily Canadian. US DMV coverage is sparse. The sa21 API's NOAA Storm Events data is the reliable source for US events.

## Key Files

### Standalone App (`/Users/a21/Desktop/storm-maps/src/`)
```
App.tsx                          — Main wiring: GPS + data + search + layout
components/
  StormMap.tsx                   — Google Maps with markers, overlays, date filtering
  Sidebar.tsx                    — Storm dates list, tabs, search, canvassing alerts
  SearchBar.tsx                  — Google Geocoder search (no Places API)
  HailSwathLayer.tsx             — NHP MESH swath polylines/polygons on Google Maps
  NexradOverlay.tsx              — IEM WMS NEXRAD radar tile overlay
  MRMSOverlay.tsx                — Oracle Cloud MRMS MESH ground overlay
  GpsTracker.tsx                 — Blue dot AdvancedMarker with pulse
  Legend.tsx                     — 7-tier hail size color legend
  DatePicker.tsx                 — (placeholder, not yet implemented)
services/
  stormApi.ts                    — Primary: sa21 API, fallback: NCEI SWDI
  nhpApi.ts                      — National Hail Project ArcGIS FeatureServer
  mrmsApi.ts                     — MRMS overlay from Oracle (via sa21 proxy)
  geocodeApi.ts                  — Google Maps Geocoder + Census Bureau fallback
hooks/
  useStormData.ts                — Central data hook (fetch + group + dedupe)
  useGeolocation.ts              — GPS watchPosition hook
  useHailAlert.ts                — Canvassing proximity alert (0.5mi threshold)
types/
  storm.ts                       — All TypeScript interfaces (StormEvent, MeshSwath, etc.)
data/
  xactimate-codes.ts             — 8 common roofing supplement codes
```

### Field Assistant Storm Map (`/Users/a21/gemini-field-assistant/`)
```
components/
  TerritoryHailMap.tsx           — Main storm map (Leaflet-based, 3000+ lines)
  HailSwathLayer.tsx             — NHP swath layer for Leaflet
  NexradRadarLayer.tsx           — NEXRAD WMS overlay for Leaflet
  MRMSHailOverlay.tsx            — MRMS ImageOverlay for Leaflet
  DocumentAnalysisPanel.tsx      — Supplement Finder (estimate analysis)
server/
  index.ts                       — Express server (CORS configured for storm-maps)
  services/noaaStormService.ts   — NOAA bulk CSV parser (the real data source)
  services/hailMapsService.ts    — IHM API integration (being replaced)
  routes/hailRoutes.ts           — /api/hail/search, /api/hail/generate-report
src/data/
  xactimate-roofing-codes.ts     — Full 103-code Xactimate database
mrms-pipeline/
  download_mrms.py               — Downloads GRIB2 from NOAA every 5 min
  serve_tiles.py                 — HTTP server for colored PNG overlays
  deploy.sh                      — Oracle Cloud deployment script
```

### Oracle Cloud MRMS Server (`129.159.190.3`)
```
/opt/mrms/                       — Python venv + scripts
/opt/mrms-tiles/overlays/        — Generated PNG overlays (mesh60.png, mesh1440.png)
/etc/systemd/system/
  mrms-server.service            — Tile server on port 8080
  mrms-downloader.service        — GRIB2 downloader
  mrms-downloader.timer          — Runs every 5 minutes
```

## Environment Variables

### Storm Maps (Railway)
```
VITE_GOOGLE_MAPS_API_KEY=AIzaSyCg-jPE-gmNi2pebICkOwEb5EZC7RgNxA4
```

### Field Assistant (Railway) — relevant vars
```
IHM_API_KEY=***          # Being replaced by this app
IHM_API_SECRET=***       # Being replaced by this app
IHM_BASE_URL=***         # Being replaced by this app
```

## Google Cloud
- Project: `gen-lang-client-0990957487` (Susan AI-21)
- APIs enabled: Maps JavaScript API, Geocoding API, Places API
- API key referrer: `https://appealing-bravery-production-d7d6.up.railway.app/*`

## Testing Notes from User Sessions

### What the user wants it to look/work like:
- Interactive Hail Maps (maps.interactivehailmaps.com) — sidebar with storm dates on left, click date → colorful hail swaths on map
- HailRecon mobile app — GPS tracking, push notifications when entering hail zones
- Clean, professional, fast

### Design decisions (confirmed):
- No territory filter buttons (DMV/PA/RA) — data driven by address/date only
- No hot zones — reps avoid "cold" zones but those still have claimable damage
- No damage risk score — reps misuse it
- No time-of-day slider — everything is "all day"
- Only hail events (no wind/tornado in the map view)
- Date click should filter map, NOT zoom/jump to a different location
- Hail swaths should NEVER show wind — only hail
- Single "since" date picker for custom time range (not start+end)

### Known issues:
- NHP hail swath data is sparse for US East Coast (primarily Canadian dataset)
- SWDI API is unreliable (500 errors on large date ranges)
- The MRMS overlay shows current/24hr data only — no historical MRMS

## Commands

```bash
# Standalone app
cd /Users/a21/Desktop/storm-maps
npm run dev          # Dev server on localhost:5180
npm run build        # Production build (77ms)
railway up --detach  # Deploy to Railway

# Field assistant
cd /Users/a21/gemini-field-assistant
npm run dev          # Dev server on localhost:4000
git push origin main # Auto-deploys to Railway

# MRMS pipeline (Oracle Cloud)
ssh -i ~/.ssh/id_ed25519 ubuntu@129.159.190.3
sudo systemctl status mrms-server mrms-downloader.timer
sudo journalctl -u mrms-server -f
```

## Cost

| Service | Monthly Cost |
|---------|-------------|
| Storm Maps (Railway) | $0 (free tier) |
| Field Assistant (Railway) | Already running |
| MRMS Pipeline (Oracle Cloud) | $0 (free tier) |
| Google Maps API | $0 ($200/mo free credit, ~28K loads) |
| NOAA data | $0 (public) |
| NHP data | $0 (public) |
| **Total** | **$0/month** |

**Replaces**: IHM ($999-1,999/yr) + HailTrace ($600-1,200/yr) = **$8,000/year savings**
