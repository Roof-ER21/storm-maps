# Hail Yes!

Property-level storm intelligence and adjuster-grade hail reporting for roofing teams.

Hail Yes! helps reps move from "was there a storm?" to a credible, property-specific answer: direct-hit swaths, nearby hail/wind reports, MRMS/NEXRAD context, NWS warnings, and a polished PDF that can be shared with homeowners or adjusters.

Production: https://hailyes.up.railway.app

## Positioning

The product is built to replace rep dependence on expensive hail-map tools while keeping the evidence standard high.

- **Rep-fast workflow:** search an address, review storm dates, inspect swaths, route/knock, and generate a PDF from the same workspace.
- **Official-source credibility:** NOAA, NWS, NEXRAD/MRMS, SPC, NCEI, IEM LSR, mPING, CoCoRaHS, Synoptic, and related federal weather datasets are prioritized over black-box claims.
- **Property-level impact:** DIRECT HIT, NEAR MISS, AREA IMPACT, and NO IMPACT classifications are based on swath/point distance bands around the searched property.
- **Adjuster-grade output:** PDFs use rounded standard hail sizes, clear distance bands, source methodology, disclaimers, NEXRAD/MRMS map context, and a concise storm narrative.

Focus territory: VA, MD, PA, DE, NJ, DC, and WV.

## Core Capabilities

- **Storm Map:** Google Maps + MRMS/NEXRAD overlays, live storm cells, historical swaths, NWS warnings, hail/wind points, property pin, and field sketch mode.
- **Storm Dates:** cached server-side event search with verified archive rows, SPC/IEM live reports, distance filtering, dedupe, and source labels.
- **Forensic Consilience:** multi-source verification that scores whether a storm date is supported by independent official signals.
- **Rep Workflow:** geofence knock logging, Maps deep links, web push storm alerts, lead/pipeline views, evidence management, and mobile-first forms.
- **PDF Reports:** property hail hit history, storm impact narrative, NEXRAD + hail footprint map, source methodology, and limitations language.
- **Admin Ops:** cache visibility, worker hooks, migration-backed tables, and scripts for backfill/prewarm workflows.

## Architecture

```text
React 19 + Vite frontend
  StormMap, Sidebar, ReportsPage, DashboardPage, EvidencePage, AdminPage
        |
        v
Express + TypeScript backend
  /api/storm/events
  /api/storm/live-cells
  /api/storm/consilience
  /api/storm/cocorahs
  /api/storm/mesocyclones
  /api/storm/synoptic-stations
  /api/storm/mping
  /api/hail/storm-report-pdf
        |
        v
Postgres
  verified_hail_events
  swath_cache
  consilience_cache
  event_cache
  storm_days
  push_subscriptions
  app workflow tables
```

## Data Sources

| Source | Use |
| --- | --- |
| NOAA MRMS / MESH | Hail swath polygons, hourly scrubber, live hail intensity |
| NEXRAD / IEM WMS | Radar context and report-map overlay |
| NWS alerts | Severe thunderstorm/tornado warning context |
| SPC reports | Hail and severe wind point reports |
| IEM LSR | Local storm reports for hail/wind |
| NCEI Storm Events / SWDI | Official historical archive and NEXRAD-derived signatures |
| mPING / CoCoRaHS / Synoptic | Additional corroborating field and station observations |

## Local Development

```bash
npm install
cp .env.example .env.local
npm run dev:server
npm run dev
```

Frontend: http://localhost:5180

Backend: http://localhost:3100

The Vite dev server proxies `/api` to the local Express server.

## Useful Commands

```bash
npm run build
npm run lint
npm run db:migrate
npm run backfill:ncei
npm run backfill:iem-lsr -- --days 45
npm run cache:prewarm
npm run prewarm:hail -- --days 90
npm run consilience
```

Generate a production PDF smoke test:

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
```

## Deployment

```bash
railway up --detach
```

Health check:

```bash
curl -s https://hailyes.up.railway.app/api/health
```

## Current Priorities

- Backfill `verified_hail_events` across VA/MD/PA/DE/NJ/DC/WV for 2024-present using official NOAA/NWS/NEXRAD-aligned sources.
- Prewarm `swath_cache` for high-value dates and territories so PDFs do not depend on organic map views.
- Add historical NWS warning archive ingestion from IEM shapefile ZIPs instead of relying only on the short-retention `api.weather.gov/alerts` endpoint.
- Remove remaining plan/paywall language from non-billing AI scan limits if the product is intended to be admin-default and non-paywalled.
- Keep Hail Yes! lighter than SA21: reps should get faster storm answers, cleaner PDFs, and fewer enterprise-only controls.
