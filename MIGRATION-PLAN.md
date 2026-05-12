# Roof Docs Intelligence Layer — Production Migration Plan

**Status:** Phase 1 of 4 in progress (foundation laid 2026-05-12)
**Repo:** `/Users/a21/Desktop/storm-maps`
**Outcome:** Promote the 29-page static HTML intelligence layer into the existing storm-maps React app with auth, role-based access, and proper server-side data.

---

## Context

The static-HTML intelligence layer was built over a single session in May 2026. It currently lives at `/public/*.html`, served by a local Python `http.server` on port 8765, fetching data from `/public/*.json` files mined from the Roof Docs portal API + IEM storm correlation.

**29 static pages built:**
- Executive: index, exec, analytics, lead-score, weekly-recap, field-guide, predictor
- Maps & Geo: roofdocs-map, hot-zips, zip-intel, property-lookup
- Outreach: resurrection, storm-exposure, storm-playbook, storm-intel, upgrade-campaigns, solar, customers, customer-detail
- Intelligence: adjusters, adjuster-detail, carrier-detail, carrier-trades, reps, rep-response, ops-team, notes
- Operations: receivables, sms-reminders

**Data foundation (data/ at repo root):**
- `projects.json` (37 MB) — 16,235 flattened jobs with carrier, adjuster, deductible, trades, dates, financials, storm-of-record
- `patterns.json` — mined statistical patterns (557 carriers × 364 adjusters × 332 zips × 220 reps × hail tiers × time buckets)
- `resurrection.json` — 700 dead-insurance-jobs-with-new-storms candidates
- `storm-exposure.json` — 2,495 customers hit by strong storms since first contact
- `storm-playbook.json` — 112 recent storms × trade-gap call lists
- `receivables.json` — open AR + downpayments
- `notes.json` — 9,775 free-text notes
- `job-storms.json` — 5,732 job→storm-of-record matches
- `geocoded.json` — 3,784 Census-geocoded coords for jobs missing portal lat/lng
- `storms/iem-hail-wind-2018-2026.json` — 48,449 strong storm events

---

## Phase 1 — Foundation (THIS SESSION, DONE)

✅ **`server/intel/routes.ts` — Auth-gated JSON endpoints**
- `GET /api/intel/manifest` — file inventory + freshness
- `GET /api/intel/projects` — full project data
- `GET /api/intel/patterns` — mined statistical patterns
- `GET /api/intel/resurrection`
- `GET /api/intel/storm-exposure`
- `GET /api/intel/storm-playbook`
- `GET /api/intel/receivables`
- `GET /api/intel/notes`
- `GET /api/intel/job-storms`
- `GET /api/intel/storms-light`
- `POST /api/intel/refresh` — returns shell-script run instructions
- Mounted in `server/index.ts` via `app.use(intelRouter)`

✅ **`src/components/IntelligenceHub.tsx` — React hub component**
- Sidebar nav grouped by 5 categories matching the static dashboard
- Hosts the native React Predictor + iframes the remaining 28 static pages for now
- Auth handled by the parent React app's existing JWT/session flow

✅ **`src/components/intel/Predictor.tsx` — First native React component**
- Fully typed
- Loads patterns via `/api/intel/patterns`
- Mirrors the public/predictor.html algorithm with the same factor blending
- Acts as the template for porting the remaining 28 pages

✅ **`scripts/roofdocs/refresh-all.sh` — One-command data refresh**
- Re-pulls portal export → details → invoices → reference data
- Re-runs geocoding → flatten → storm correlation → derived datasets
- Copies output to public/

---

## Phase 2 — Wire IntelligenceHub into App.tsx (NEXT)

App.tsx uses panel-based routing (not React Router). The intelligence hub needs to register as a panel.

**Steps:**

1. **Add panel ID** to `RoofERApp.tsx` panel registry:
   - Add `intel` to the panel union type
   - Add to `ALL_PANELS` in `src/hooks/useRole.ts`
   - Add to `BREADCRUMB_MAP` and `PANEL_TO_HASH` in `src/components/app-layout/`

2. **Add nav entry** to the sidebar component:
   - Icon: 🧠
   - Label: "Intelligence"
   - Role gating: admin + manager + lead-rep (canvasser-rep may have read-only on a subset)

3. **Mount IntelligenceHub** in the main panel switch:
   ```tsx
   {currentPanel === 'intel' && <IntelligenceHub />}
   ```

4. **Iframe security**:
   - The static HTML pages are served via Express alongside the React app's `dist/`
   - Need to ensure auth cookies pass through to iframe loads
   - Add CSP headers explicitly allowing the iframe source

**Estimated effort:** 2-4 hours

---

## Phase 3 — Port static pages to native React components

Currently 1 of 29 ported (Predictor). Priority order for remaining:

### Tier A (highest value — port first)
1. **Field Guide** — `src/components/intel/FieldGuide.tsx`
   - 9 tabs, each renders patterns from /api/intel/patterns
   - Heaviest data-bound logic, biggest UX gains in React
2. **Customer Detail** — `src/components/intel/CustomerDetail.tsx`
   - Native React: leverage existing Map components, evidence pipeline
   - Connect to portal deep-links AND embed the existing photo viewer
3. **Resurrection** — `src/components/intel/ResurrectionList.tsx`
   - Already has Leaflet map; port to use the existing StormMap component
4. **Storm Playbook** — `src/components/intel/StormPlaybook.tsx`
   - Pick storm → trade-gap call list

### Tier B (high value but bigger lift)
5. Lead Score · 6. Storm Intel · 7. Adjuster Detail · 8. Carrier Detail · 9. Customer Rollup · 10. Exec Snapshot

### Tier C (port last — least dynamic)
11-29: rest of the pages (analytics, ops-team, notes search, weekly recap, etc.)

**Estimated effort:** ~2 hours per page × 28 pages = 56 hours of focused work. Realistically 3-4 weeks part-time.

---

## Phase 4 — Production Polish

### 4.1 Role-based access (RBAC)

Existing roles in storm-maps (from `src/hooks/useRole.ts`):
- `admin` (full access)
- `manager` (most views)
- `lead-rep` (canvasser with extended privileges)
- `rep` (basic canvasser)
- `viewer` (read-only)

Map intelligence views to roles:
| View | admin | manager | lead-rep | rep | viewer |
|---|---|---|---|---|---|
| Predictor | ✅ | ✅ | ✅ | ✅ | ❌ |
| Field Guide | ✅ | ✅ | ✅ | ✅ | ✅ |
| Customer Detail | ✅ | ✅ | ✅ (own customers) | ✅ (own) | ✅ (own) |
| Resurrection | ✅ | ✅ | ✅ | ❌ | ❌ |
| Carrier Deep Dive | ✅ | ✅ | ❌ | ❌ | ❌ |
| Receivables | ✅ | ✅ | ❌ | ❌ | ❌ |
| Adjuster Directory | ✅ | ✅ | ✅ | ❌ | ❌ |
| Storm Playbook | ✅ | ✅ | ✅ | ❌ | ❌ |
| Exec Snapshot | ✅ | ✅ | ❌ | ❌ | ❌ |
| SMS Reminders | ✅ | ✅ | ❌ | ❌ | ❌ |
| Patterns / Predictor source | ✅ | ✅ | ❌ | ❌ | ❌ |

Implementation: wrap intelligence routes in a role check via the existing `requireRole(role)` middleware (TBD — currently `requireAdmin` exists in `server/storm/adminAuth.ts`).

### 4.2 Server-side data layer

Move static JSON to Postgres for proper concurrent access + faster queries:

**New Drizzle schema additions** (server/schema.ts):
- `intel_projects` (mirrors projects.json structure)
- `intel_patterns` (mined output)
- `intel_resurrection`
- `intel_storm_exposure`
- `intel_carrier_zip_patterns`
- `intel_adjuster_patterns`

**Refresh job:** nightly cron that runs `refresh-all.sh` then upserts JSON → Postgres.

Routes change from `res.sendFile(json)` to `res.json(await db.query(...))`.

### 4.3 Sharing / link-based access

For sharing specific views (e.g. "send this resurrection list to the team"):
- Reuse existing `shared_reports` table pattern (from `SharedReportPage.tsx`)
- Each intel view that supports sharing generates a short-code URL: `/shared/intel/{type}/{id}`
- Shared views are read-only and don't require login
- Optional: per-view expiration

### 4.4 Deploy

Existing production target is Railway (per `DEPLOY.md`):
- Service: hailyes (Express + Vite SPA)
- Worker service: Hail Yes Worker (push fan-out + prewarm)
- Postgres: Railway-managed

New env vars needed:
- `INTEL_ENABLED=true` (feature flag)
- `INTEL_DATA_DIR` (optional override; defaults to ./data)
- `INTEL_RBAC_MODE=strict` (or `permissive` for staged rollout)

Deploy steps:
1. Add `data/*.json` to Railway service volume (or commit to repo if size acceptable; current total ~75 MB)
2. Run migrations
3. Deploy via `railway up` (per existing DEPLOY.md)

---

## Phase 5 — Beyond Production

- **Live data refresh** triggered by portal webhooks (currently nightly script)
- **In-app refresh button** for admins (runs refresh-all.sh via API)
- **Mobile-optimized views** — current pages render but aren't tuned for phone
- **Push notifications** for resurrection alerts (already have web-push infrastructure)
- **Machine learning** — replace rule-based Predictor with XGBoost + SHAP per the research findings (Google `lifetime_value` library for CLV; xView2 for damage classification)

---

## Open questions for product

1. **Photo strategy**: Portal photos endpoint returns empty for our role. Options:
   - (a) Deep-link only (current): "Open in Portal" button on customer-detail. Reps view photos in portal directly.
   - (b) On-demand single-customer pull: rep clicks "analyze evidence" → fetch + AI-summarize photos for that one customer.
   - (c) Bulk overnight pull (~10-50 GB) — only for top-priority customers.
   - **Current default: (a)** — added to customer-detail / resurrection / storm-intel.

2. **Data retention**: how often do we re-pull from portal?
   - Current: manual `refresh-all.sh` when needed.
   - Recommend: nightly cron in production.

3. **Auth model**: do non-admins see all data or only what they can act on?
   - Suggest: RBAC matrix in §4.1; managers see all, canvasser reps see their own + neighborhood.

4. **Sharing model**: who can generate shareable links?
   - Suggest: admins + managers only; expire after 30 days.

---

## Files added this session (for reference)

```
server/intel/routes.ts                # Auth-gated JSON API
src/components/IntelligenceHub.tsx    # React hub container
src/components/intel/Predictor.tsx    # First native React component
MIGRATION-PLAN.md                     # This file
```

## Files MODIFIED this session

```
server/index.ts                       # Imported + mounted intelRouter
public/customer-detail.html           # Added "Open in Portal" links
public/resurrection.html              # Added portal links column
public/storm-intel.html               # Added portal links in customer rows
```

## Files UNCHANGED (the 29 static pages)

All 29 HTML pages and 10 JSON data files remain in `/public/` and are served by Express. They will continue to function as the iframe-backed views inside IntelligenceHub during Phase 2-3.
