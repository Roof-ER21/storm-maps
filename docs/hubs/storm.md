# Storm Hub

View id: `storm-hub`
Deep-link: `/?view=storm-hub&tab=<tabId>`
Roles: admin, exec, employee, analytics

Consolidates all storm-response workflows. Replaced three standalone HTML pages.

---

## Tabs

### playbook — Storm Playbook
File: `src/components/hubs/native/storm/StormPlaybook.tsx`

Pick a storm event, get a trade-by-trade call list of affected customers with trade gaps.

Endpoints:
- `GET /api/intel/storm-playbook` — array of PlaybookStorm objects; each includes the storm event metadata + per-trade customer buckets with trade-gap flags

Key flow: storm picker on the left (sorted by recency); selecting a storm shows the trade breakdown grid. Each trade cell links to the matching customer list for that storm × trade.

### intel — By Storm
File: `src/components/hubs/native/storm/StormIntel.tsx`

Browse all 48k IEM storm events on a Leaflet map. Filter by date range, type (hail/wind/tornado), and magnitude. Selecting a storm fires a radius query to show nearby jobs.

Endpoints:
- `GET /api/intel/storms-light` — full IEM event set (VA MD PA DC DE NJ WV, 2018–2026); parsed client-side into a flat array of `{ type, mag, valid, city, state, lat, lng }`
- `GET /api/intel/jobs-nearby?lat=<lat>&lng=<lng>&radius=<radius>` — on storm select; returns jobs within radius

Notable: storm data is GeoJSON (`FeatureCollection`) from the API but the component normalizes it to a flat array. Filters: hail ≥1 in, wind ≥60 mph, or tornado.

### exposure — Storm Exposure
File: `src/components/hubs/native/storm/StormExposure.tsx`

2.5k customers whose homes were hit by a qualifying storm event since their first contact with the company. Pre-built outreach list.

Endpoints:
- `GET /api/intel/storm-exposure` — full list on mount; all filtering (carrier, rep, ZIP, storm strength) is client-side

---

## Notable Behavior

- The Playbook tab is the primary field-rep tool for post-storm outreach. It is linked from the `HomePane` quick-launch grid, the `ExecPage` opportunity cards, and the `WeeklyRecap` action items.
- The Intel tab is the only surface that renders a Leaflet map overlaid on live storm events (distinct from the job-pin map in `ops/RoofdocsMap`).
