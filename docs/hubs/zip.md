# ZIP Hub

View id: `zip-hub`
Deep-link: `/?view=zip-hub&tab=<tabId>`
Roles: admin, exec, employee, analytics

Two-tab ZIP code intelligence hub. Replaced two standalone HTML pages.

---

## Tabs

### hot — Hot ZIPs
File: `src/components/hubs/native/zip/ZipHot.tsx`

Filterable leaderboard of ZIPs ranked by recent activity (signed jobs, completed jobs, revenue). Users can adjust the time window, minimum job threshold, and state filter.

Endpoints:
- `GET /api/intel/zip-stats?window=<days>&min_jobs=<n>&state=<s>` — reloads on filter change; response `{ zips: [{ zip, city, state, signed, completed, dead, revenue, recentStorms, recentHail, closeRate, avgApprovedJob, score }], total, window, state, took_ms, computed_at }` sorted by score descending

### intel — ZIP Detail
File: `src/components/hubs/native/zip/ZipIntel.tsx`

Full ZIP directory with client-side search. Selecting a ZIP loads a detail panel with a knock-door script and nearby storm history.

Endpoints:
- `GET /api/intel/zip-stats?window=0&state=<s>` — all-time stats for all ZIPs on mount (window=0 means no time filter); used to populate the directory list
- `GET /api/intel/zip-deep?zip=<zip>` — on ZIP select; response `{ zip, city, summary: { signed, completed, dead, revenue, completedRev, closeRate, avgApprovedJob, medianDeductible, stormCount }, carriers: [{ name, signed, completed, dead, rev, closeRate }], trades, reps, adjusters, recentStorms: [{ stormDate, stormType, stormMagnitude, stormUnit, stormDistanceMiles }], took_ms }`; `trades`, `reps`, and `adjusters` are `[{ name, count }]` arrays

---

## Notable Behavior

- The Hot ZIPs tab is parameterized — the time window and min-jobs filter both trigger a server-side re-fetch (not client-side filtering). This keeps the response size manageable.
- The ZIP Detail panel description in the tab header references a knock-door script, but the `zip-deep` endpoint does not return a script field — the component builds any field guidance from the structured stats (dominant carrier, approval rate, storm count) returned in the response.
