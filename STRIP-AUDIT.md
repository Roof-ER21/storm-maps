# RIQ 21 Storm-Map Strip Audit (next-session cleanup)

Generated 2026-05-12. Source-file deletion plan for fully retiring the legacy
storm-map UI now that RIQ 21 is the front door + feeds storm data from Hail Yes.

## Stage A — App.tsx surgery (the unblocker)

App.tsx is 3,200+ lines and currently imports + renders:
- `<StormMap>` when `activeView === 'map'` (the heavy one)
- `<HeatmapLayer>`, `<Legend>` as map children
- `<DashboardPage>`, `<PipelinePage>`, `<ReportsPage>`, `<EvidencePage>`, `<TeamPage>` for other legacy views
- A LOT of derived state (`stormDates`, `events`, `selectedDate`, `searchSummary`, `evidenceItems`, `routeStops`, etc.) feeding into all of the above

**Plan:** split `App.tsx` into two:
1. `AppShell.tsx` — minimal: AppHeader + `<IntelligenceHub />` when activeView==='intel'
2. `LegacyApp.tsx` — everything else, loaded ONLY via `#legacy` or `#admin` hash escape

Smoke test: ensure `http://localhost:5180/` lands directly in IntelligenceHub
with zero storm-map state initialization (no `/api/storm/*` calls, no
`/api/ai/*` calls, no Mapbox SDK download, etc.).

## Stage B — Source files safe to delete (~4,491 lines)

After Stage A, the following are no longer reachable and can be deleted:

```
src/components/
  ActiveStormsPanel.tsx       145
  CocorahsLayer.tsx           121
  HailSwathLayer.tsx          346
  HeatmapLayer.tsx            106
  Legend.tsx                  109
  LiveStormCellsLayer.tsx     134
  MesocycloneLayer.tsx        116
  MpingLayer.tsx              195
  MRMSOverlay.tsx              92
  NexradOverlay.tsx           203
  ParcelLayer.tsx              92
  SketchLayer.tsx             280
  StormMap.tsx              1,877
  SynopticLayer.tsx           123
  WindLegend.tsx               86
  WindSwathLayer.tsx          266
                            -----
                            4,491 lines

src/hooks/
  useConsilienceFlags.ts
  useHailAlert.ts
  useStormAlerts.ts
  useStormData.ts

src/services/
  aiApi.ts
  consilienceApi.ts
  demoEvidence.ts
  evidenceApi.ts
  evidencePackService.ts
  evidenceProviders.ts
  evidenceStorage.ts
  liveCellsApi.ts
  mrmsApi.ts
  nhpApi.ts
  nwsAlerts.ts
  propertyLookup.ts
  regionalEvidenceSeeds.ts
```

**Keep:** `notificationService.ts`, `geocodeApi.ts`, `geoUtils.ts`,
`dateUtils.ts`, `backendConfig.ts`, `api.ts` — intel uses some of these.
`exifGps.ts` is questionable; check usage.

## Stage C — Server route deletion

```
server/storm/      → 46 files (radar, MRMS, NEXRAD, hail, wind, swath, etc.) — DELETE
server/property/   →  1 file  (property-lookup) — DELETE if intel doesn't use
server/sa-port/    → 15 files (consilience/Susan integration) — DELETE
server/ai/         → 31 files — REVIEW: some may be useful for RIQ AI features
```

After deletion, remove from `server/index.ts`:
- Imports for any deleted router
- `app.use(stormRouter)` etc. mount lines

## Stage D — Heavy deps to uninstall

Deps that were only used by storm-map after Stage B/C:

| Dep | Saves | Notes |
|---|---|---|
| `@vis.gl/react-google-maps` | ~5MB | only StormMap.tsx + map layers |
| `@googlemaps/markerclusterer` | ~500KB | only StormMap |
| `d3-contour` | ~200KB | only MRMS/wind overlays |
| `pako` | ~120KB | only GRIB decoding |
| `pngjs` | ~80KB | only radar synthesis |
| `web-push` | ~70KB | live storm alerts (Hail Yes does this) |
| `compression` | ~30KB | storm-data endpoints |
| `jszip` | ~110KB | evidence packs |
| `pdfkit` | ~750KB | KEEP — RIQ may use for intel PDFs |

Run: `npm uninstall @vis.gl/react-google-maps @googlemaps/markerclusterer d3-contour pako pngjs web-push compression jszip`

Expected build-size shrink: **~7MB JS bundle**.

## Stage E — Data cleanup

Already done this session:
- ✓ Deleted `data/storms/iem-lsr-monthly-2018-2026.json` (133MB intermediate)

Still pending:
- `data/storms/iem-hail-wind-2018-2026.json` (38MB) — KEEP, used by intel pipeline
- `data/roofdocs-pull/` (131MB raw job JSONs) — KEEP for delta-pull skip logic
- `data/roofdocs-invoices/` (81MB raw invoices) — KEEP for same reason
- Compression of raw pulls is a potential next-next optimization (gzip → ~30% size)

Also can delete after Stage B/C:
- Any radar/cache directories created by `server/storm/*`
- Any prewarm-* output files

## Stage F — package.json scripts cleanup

After Stage D, remove from `package.json`:
- `cache:prewarm`, `prewarm:hail` (storm-map prewarm)
- `consilience` (sa-port debug)
- `backfill:ncei`, `backfill:iem-lsr`, `ops:refresh-storm-data` (storm pipeline)
- `test:display-cap` (storm-map test)
- `worker` script (`server/worker.ts` — storm push fan-out)

## What's NOT being deleted (keep)

- `src/services/notificationService.ts` — base notification API
- `data/projects.json` + all derived intel JSONs
- `scripts/roofdocs/` — entire intel pipeline
- `server/intel/` — RIQ API
- `server/auth/`, `server/db.ts`, `server/migrate.ts`, `server/schema.ts` — needed
- `src/components/IntelligenceHub.tsx` + `src/components/intel/*` — RIQ UI
- `src/main.tsx`, `index.html`, `vite.config.ts`, `tsconfig*` — base

## Execution order for next session

1. Stage A (App.tsx split) — biggest risk, biggest unblocker
2. Stage B (delete source files) — fast once A is done
3. Stage C (server routes)
4. Stage D (deps uninstall)
5. Stage E (data leftover sweep)
6. Stage F (package.json scripts)
7. Verify with `npm run build` + `npm run dev` smoke
8. Commit as one big "strip legacy storm-map" PR
