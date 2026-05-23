# RIQ 21 — Architecture (Phase 2e Canonical)

Internal sales and operations intelligence platform for The Roof Docs.
16k jobs + 48k storm events. Data refreshes nightly from the portal.

---

## Table of Contents

1. [SPA Shell — IntelligenceHub](#spa-shell--intelligencehub)
2. [Render Pipeline](#render-pipeline)
3. [4-Role Model](#4-role-model)
4. [Hub System (NATIVE_HUB_TABS)](#hub-system-native_hub_tabs)
5. [Standalone View System (NATIVE_VIEWS)](#standalone-view-system-native_views)
6. [Deep-Link Protocol](#deep-link-protocol)
7. [301 Legacy Redirects](#301-legacy-redirects)
8. [Data Layer — /api/intel/*](#data-layer--apiintel)
9. [Phase 6 AI Assistant](#phase-6-ai-assistant)
10. [Auth Layer](#auth-layer)
11. [Build & Deploy](#build--deploy)
12. [Component / Route Map](#component--route-map)

---

## SPA Shell — IntelligenceHub

`src/components/IntelligenceHub.tsx`

The entire app is a single-page application. The shell renders:

- **Left sidebar** (240px): pinned "Master Guide" button + role-filtered `NAV_GROUPS` (9 section groups). Nav visibility is computed from `canAccess(viewId, user)` via `useMemo`.
- **Top bar**: optional back-button strip (appears when `history.length > 0`).
- **Main content area**: output of `renderView(view, navigate)`.
- **OnboardingInterstitial**: one-time welcome modal; redirects to `master-guide` on dismiss.
- **Phase 6 AI**: `<ChatDrawer pageContext={view} />` (right slide-in) + floating "Ask AI" FAB (bottom-right, fires `dispatchDrawerToggle()`).

State:

| State variable | Type | Purpose |
|---|---|---|
| `view` | `IntelView` | Currently active view id |
| `history` | `IntelView[]` | Back-button stack |
| `didLandOnRoleHome` | `boolean` | Prevents double-redirect to role home |

**Role-home landing**: on first user load, if `view === 'home'` the shell redirects to `ROLE_HOME[user.role]`.

---

## Render Pipeline

`renderView(view, navigate)` in `IntelligenceHub.tsx` applies checks in this exact order:

```
1. Literal view ids: 'home', 'predictor', 'admin-home', 'exec-home', 'my-day', 'data-room'
   → inline React components

2. getHub(view)  (from hubs/hubs.ts — returns HubConfig if view is a hub id)
   → <HubWrapper hub={hub} />
       └── HubWrapper reads ?tab= from URL
       └── checks NATIVE_HUB_TABS[hub.view][tab.id] → native React component, else iframe of tab.src

3. NATIVE_VIEWS[view]  (Phase 2d registry)
   → <NativeView navigate={navigate} />

4. VIEW_FILES[view]  (legacy static HTML pages in /public/)
   → <iframe src={`/${file}`} />

5. Fallback: "view X not yet wired" message
```

Adding a new view requires only:

- **New hub tab**: add a `HubTab` entry to the hub in `hubs.ts` + optionally a component in `hubs/native/<hub>/` + register it in `hubs/native/registry.ts`.
- **New standalone page**: create a `NativeViewComponent` + register it in the appropriate barrel (`exec/`, `field/`, or `ops/` `index.ts`). The `NATIVE_VIEWS` registry in `views/native/registry.ts` auto-merges all three barrels.
- **New iframe-backed page**: add to `VIEW_FILES` in `IntelligenceHub.tsx` + add the HTML file to `/public/`.

---

## 4-Role Model

`src/auth/roles.ts` (client-side) mirrors `server/auth/services.ts` (server-side enforcement).

| Role | Default home | Description |
|---|---|---|
| `admin` | `admin-home` | Full access; `is_root_admin` flag bypasses all checks |
| `exec` | `exec-home` | Executive dashboards + rep/carrier reporting |
| `employee` | `my-day` | Field rep day view; sees own leads only |
| `analytics` | `data-room` | Analytics surfaces; no write operations |

**`canAccess(viewId, user)`**: returns `true` if `user.is_root_admin`, or if `viewId` is in `VIEW_ROLES[viewId]` for the user's role. Unknown view ids default to admin-only.

`VIEW_ROLES` in `roles.ts` is the authoritative client-side access map. `requireRole` middleware in `server/auth/middleware.ts` enforces access server-side on every API call.

**`UserContext`** (`src/auth/UserContext.tsx`): fetches `GET /api/auth/me` on mount, exposes `{ user, loading, refresh, markWelcomeSeen }` via `useUser()`. The `User` shape includes `id`, `email`, `display_name`, `role`, `is_root_admin`, `pin_length`, `welcome_seen_at`.

---

## Hub System (NATIVE_HUB_TABS)

Hubs are tabbed containers that group related views. Phase 2c migrated 24 standalone HTML pages into 9 hubs.

### Hub Config (`src/components/hubs/hubs.ts`)

```ts
interface HubConfig {
  view: string;   // IntelView id, e.g. "carrier-hub"
  title: string;  // shown above tab bar
  tabs: HubTab[]; // first entry = default tab
}
interface HubTab {
  id: string;     // used by ?tab= deep-link and NATIVE_HUB_TABS key
  label: string;
  src: string;    // HTML filename in /public/ (fallback when no native component)
}
```

### HubWrapper (`src/components/hubs/HubWrapper.tsx`)

- Reads `?tab=` from the URL on mount to support deep-linking.
- Checks `NATIVE_HUB_TABS[hub.view][tab.id]` — if a native React component exists it renders it; otherwise renders `<iframe src={`/${tab.src}`}>`.

### Native Hub Registry (`src/components/hubs/native/registry.ts`)

```ts
NATIVE_HUB_TABS: Record<hubViewId, Record<tabId, ComponentType>>
```

All 9 hubs have native components for all their tabs as of Phase 2c.

### The 9 Hubs

| Hub id | Title | Tabs |
|---|---|---|
| `carrier-hub` | Carrier Intelligence | `overview`, `trades`, `playbook`, `algorithms` |
| `storm-hub` | Storm Response | `playbook`, `intel`, `exposure` |
| `denial-hub` | Denial Combat | `analyze`, `archive`, `stats` |
| `adjuster-hub` | Adjusters | `directory`, `detail`, `twin` |
| `rep-hub` | Sales Reps | `overview`, `response` |
| `customer-hub` | Customers | `list`, `detail`, `lookup` |
| `leads-hub` | Leads Funnel | `intel`, `funnel` |
| `pricing-hub` | Pricing | `margins`, `library` |
| `zip-hub` | ZIPs | `hot`, `intel` |

See `docs/hubs/<hub>.md` for per-hub detail.

---

## Standalone View System (NATIVE_VIEWS)

Phase 2d migrated standalone views from legacy iframe HTML pages into native React components.

### Registry (`src/components/views/native/registry.ts`)

```ts
NATIVE_VIEWS = {
  ...execViews,   // exec/, owner: dcc
  ...fieldViews,  // field/, owner: dcc
  ...opsViews,    // ops/, owner: mac
}
```

### Registered Views

**exec barrel** (`exec/index.ts`):

| View id | Component | Notes |
|---|---|---|
| `exec` | `ExecPage` | Board-level snapshot |
| `weekly-recap` | `WeeklyRecap` | Printable/exportable recap |
| `analytics` | `Analytics` | Full client-side analytics over 16k jobs |
| `insurance-intel` | `Market` | Carrier market intelligence |
| `pipeline-intel` | `Pipeline` | Pipeline DNA + automation triggers |
| `carrier-orphans` | `CarrierOrphans` | 165 insurance jobs missing carrier |

**field barrel** (`field/index.ts`):

| View id | Component | Notes |
|---|---|---|
| `lead-score` | `LeadScore` | AI-scored lead queue |
| `field-guide` | `FieldGuide` | Pattern-backed field playbook |
| `cheat-sheet` | `CheatSheet` | Per-entity math cheat sheets |
| `lifetime-touch` | `LifetimeTouch` | Re-engagement queue |
| `campaigns` | `Campaigns` | Upsell campaign lists |
| `solar` | `Solar` | Solar upsell candidates |
| `sms-reminders` | `SmsReminders` | SMS outreach queue |

**ops barrel** (`ops/index.ts`):

| View id | Component | Notes |
|---|---|---|
| `ops-surveillance` | `OpsSurveillance` | Open supplements + cross-sell tracker |
| `scheduling` | `Scheduling` | Install schedule pipeline |
| `active-work` | `ActiveWork` | Active jobs intel |
| `receivables` | `Receivables` | AR aging + credits + PA cases |
| `ops-team` | `OpsTeam` | Per-role employee dashboard |
| `notes` | `Notes` | 9.7k job notes full-text search |
| `map` | `RoofdocsMap` | Leaflet map + job pins |

**Views still iframe-backed** (in `VIEW_FILES`, not in `NATIVE_VIEWS`):

`master-guide`, `denial-analyzer`, `denial-archive`, `denial-stats`, `carrier-playbook`, `carrier-algorithms`, `adjuster-twin`, `lifetime-touch`, `hot-zips`, `zip-intel`, `property-lookup`, `resurrection`, `storm-exposure`, `storm-playbook`, `storm-intel`, `campaigns`, `solar`, `customers`, `customer-detail`, `leads`, `leads-intel`, `adjusters`, `adjuster-detail`, `carrier-detail`, `carrier-trades`, `reps`, `rep-response`, `pricing-margins`, `pricing-library`, `sms-reminders`, `carrier-orphans` (those not in `NATIVE_VIEWS` fall back to iframe).

---

## Deep-Link Protocol

`?view=<viewId>` — consumed by `readViewFromUrl()` in `IntelligenceHub.tsx`. Only hub view ids are honored (validated via `getHub(v)`). Sets the initial view on load, bypassing the role-home landing effect.

`?tab=<tabId>` — consumed by `HubWrapper` to select the default sub-tab within a hub.

Example: `/?view=carrier-hub&tab=algorithms` lands on the Carrier Algorithms tab.

---

## 301 Legacy Redirects

`server/index.ts` — `HUB_REDIRECTS` map. 24 GET routes redirect retired `/page.html` paths to their hub deep-links with HTTP 301. This preserves all existing bookmarks and external links.

| Retired URL | New URL |
|---|---|
| `/carrier-detail.html` | `/?view=carrier-hub&tab=overview` |
| `/carrier-trades.html` | `/?view=carrier-hub&tab=trades` |
| `/carrier-playbook.html` | `/?view=carrier-hub&tab=playbook` |
| `/carrier-algorithms.html` | `/?view=carrier-hub&tab=algorithms` |
| `/storm-playbook.html` | `/?view=storm-hub&tab=playbook` |
| `/storm-intel.html` | `/?view=storm-hub&tab=intel` |
| `/storm-exposure.html` | `/?view=storm-hub&tab=exposure` |
| `/denial-analyzer.html` | `/?view=denial-hub&tab=analyze` |
| `/denial-archive.html` | `/?view=denial-hub&tab=archive` |
| `/denial-stats.html` | `/?view=denial-hub&tab=stats` |
| `/adjusters.html` | `/?view=adjuster-hub&tab=directory` |
| `/adjuster-detail.html` | `/?view=adjuster-hub&tab=detail` |
| `/adjuster-twin.html` | `/?view=adjuster-hub&tab=twin` |
| `/reps.html` | `/?view=rep-hub&tab=overview` |
| `/rep-response.html` | `/?view=rep-hub&tab=response` |
| `/customers.html` | `/?view=customer-hub&tab=list` |
| `/customer-detail.html` | `/?view=customer-hub&tab=detail` |
| `/property-lookup.html` | `/?view=customer-hub&tab=lookup` |
| `/leads-intel.html` | `/?view=leads-hub&tab=intel` |
| `/leads.html` | `/?view=leads-hub&tab=funnel` |
| `/pricing-margins.html` | `/?view=pricing-hub&tab=margins` |
| `/pricing-library.html` | `/?view=pricing-hub&tab=library` |
| `/hot-zips.html` | `/?view=zip-hub&tab=hot` |
| `/zip-intel.html` | `/?view=zip-hub&tab=intel` |

---

## Data Layer — /api/intel/*

`server/intel/routes.ts` — all data endpoints. Mounts at `/api/intel/`.

**Auth**: every endpoint below `requireIntelAuth` requires either a valid session cookie or an `x-riq-api-key` header. The `/api/intel/share/:slug` (public share viewer) is the only exception.

**Storage**: Postgres `intel_blobs` table is tried first (Railway production); falls back to `/data/*.json` files (local dev). `X-RIQ-Source: db|file` header indicates which path was used.

**Rate limit**: 2000 requests / 15 minutes (shared across all `/api/` routes).

### Blob Endpoints (GET /api/intel/:key)

| Key | Description |
|---|---|
| `projects` | 16k flattened jobs (37 MB) |
| `patterns` | Mined carrier × adjuster × zip × hail patterns |
| `resurrection` | ~700 dead-insurance jobs with new storm activity |
| `storm-exposure` | 2.5k customers with storm exposure since first contact |
| `storm-playbook` | 116 recent strong storms × trade-gap call lists |
| `receivables` | Open AR + downpayments + collections |
| `notes` | 9.7k free-text job notes |
| `job-storms` | Job → storm-of-record matches (5.7k pairs) |
| `geocoded` | Census-geocoded coords for jobs missing lat/lng |
| `carrier-orphans` | 165 Insurance-typed jobs missing carrier on file |
| `cheat-sheets` | Per-entity math-backed cheat sheets |
| `carrier-patents` | Carrier AI decoder — patent-disclosed decision rules |
| `lifetime-touch` | Per-rep re-engagement queue |
| `denial-corpus` | Real denial archive for few-shot prompting |
| `carrier-boilerplate` | Per-carrier n-gram denial phrase library |
| `employee-roster` | UUID → display-name map |
| `adjustments-open` | Open public-adjuster cases |
| `active-work` | Active-jobs intel (supplements, cross-sell, install readiness) |
| `credits` | Vendor credits — 138 records, $22.8K unrequested |
| `pricing-margins` | Subcontractor margin analysis — 718 line matches |
| `pricing-templates` | 48 estimate templates by trade |
| `pricing-library` | 14 trades + 72 components + 227 materials |
| `denial-sources-full` | 29 annotated denial cases with patent mappings |
| `naic-complaint-index` | NAIC complaint ratios per carrier |
| `leads-rollup` | Leads funnel summary snapshot |
| `leads-employees` | Per-employee lead assignments + conversion rates |
| `portal-kpi-profit` | Portal profit KPIs snapshot |
| `portal-kpi-summary` | Portal KPI summary snapshot |
| `portal-insurance-names` | Canonical carrier name mapping |
| `finance-plans` | Finance plan options |
| `storms-light` | IEM hail/wind/tornado events 2018–2026 (VA MD PA DC DE NJ WV) |
| `insurer-rankings` | Carrier composite scores — AM Best, market share, NOAA risk |
| `live-market-intel` | OH Top 70 HO carriers 2024 + MD Market Hardening Survey |
| `scheduling` | Overdue installs, unscheduled ready jobs, stale pipeline |
| `pipeline-intel` | Pipeline DNA: supplement signal, bottlenecks, automation triggers |

### Aggregate / Query Endpoints

| Endpoint | Description |
|---|---|
| `GET /api/intel/projects-query` | Filtered + paginated job query |
| `GET /api/intel/projects-aggregate` | Job counts grouped by dimension |
| `GET /api/intel/zip-stats` | ZIP performance stats |
| `GET /api/intel/zip-deep` | Single-ZIP detail + knock script |
| `GET /api/intel/carriers-summary` | Carrier list + approval rates |
| `GET /api/intel/carrier-deep` | One-carrier deep dive |
| `GET /api/intel/carrier-trade-matrix` | Carrier × trade heatmap |
| `GET /api/intel/carrier-complaints` | NAIC complaint index |
| `GET /api/intel/map-pins` | Slim location layer for maps |
| `GET /api/intel/customer-leads` | Leads tied to a customer |
| `GET /api/intel/customers-list` | All customers with summary |
| `GET /api/intel/customer-deep` | Single customer + full job history |
| `GET /api/intel/adjusters-summary` | Adjuster directory + approval rates |
| `GET /api/intel/adjuster-deep` | Adjuster detail |
| `GET /api/intel/reps-summary` | Rep list with metrics |
| `GET /api/intel/rep-deep` | Rep detail |
| `GET /api/intel/rep-response` | Rep storm-to-signed response time |
| `GET /api/intel/ops-team-summary` | Employee-role summary |
| `GET /api/intel/ops-team-deep` | Single employee deep dive |
| `GET /api/intel/solar-candidates` | Roofs ready for solar upsell |
| `GET /api/intel/jobs-nearby` | Geo-radius job query |
| `GET /api/intel/weekly-recap` | 7/14/30-day recap |
| `GET /api/intel/exec-summary` | Board-level snapshot |
| `GET /api/intel/dashboard-kpis` | Top-line KPIs |
| `GET /api/intel/lifetime-touch-query` | Re-engagement queue per rep |
| `GET /api/intel/leads-summary` | Lead funnel KPIs |
| `GET /api/intel/leads-query` | Filtered lead list |
| `GET /api/intel/lead-deep` | Single lead + nearby projects |
| `GET /api/intel/lead-pipeline` | Rep funnel |
| `GET /api/intel/portal-kpis` | Portal + RIQ drift |
| `GET /api/intel/receivables/rollup` | AR aging + carrier breakdown |
| `GET /api/intel/geocode` | US Census geocoder proxy |
| `GET /api/intel/quick-search` | Typeahead across all entities |
| `GET /api/intel/health` | Data freshness + blob status |
| `GET /api/intel/manifest` | Available files + mtimes |
| `GET /api/intel/_meta` | Discovery doc |
| `GET /api/intel/_config` | Client config (Google Maps key) |
| `GET /api/intel/refresh/status` | Current refresh job state |
| `POST /api/intel/refresh` | Trigger stealth refresh |

### AI Analysis Endpoints

| Endpoint | Description |
|---|---|
| `POST /api/intel/analyze-denial` | Gemini 2.0 Flash denial analysis → patent match + counter-letter |
| `POST /api/intel/transcribe-denial` | Gemini multimodal OCR of PDF/image denial |
| `GET /api/intel/adjuster-twin/list` | Adjusters with cheat-sheet data |
| `POST /api/intel/adjuster-twin/predict` | AI adjuster response prediction |
| `GET /api/intel/predictor/score` | Lead score 0-100 |
| `POST /api/intel/predictor/webhook` | CC21 lead-pipeline webhook |

### Denial Intake CRUD

| Endpoint | Description |
|---|---|
| `GET /api/intel/denial-intake/stats` | Aggregated outcomes |
| `GET /api/intel/denial-intake/list` | Browse archive (filterable) |
| `GET /api/intel/denial-intake/:id` | Single intake record |
| `POST /api/intel/denial-intake/:id/outcome` | Log appeal outcome |

### Sharing

| Endpoint | Auth | Description |
|---|---|---|
| `POST /api/intel/share` | required | Create public snapshot link |
| `GET /api/intel/share` | required | List my shares |
| `DELETE /api/intel/share/:slug` | required | Revoke a share |
| `GET /api/intel/share/:slug` | none | Public share viewer |

### Refresh Cadence

Nightly via Windows Task Scheduler (Mon–Fri 9 AM ET). Manual trigger: `POST /api/intel/refresh` from the Admin Home, or `node scripts/roofdocs/import-to-postgres.mjs` locally.

---

## Phase 6 AI Assistant

### Frontend (`src/ai/`)

| File | Role |
|---|---|
| `ChatDrawer.tsx` | Right slide-in overlay (420px). Toggle via `dispatchDrawerToggle()` window event or FAB. Escape key closes. |
| `ChatPage.tsx` | Scrollable message thread + input bar. Sends `POST /api/ai/chat`. |
| `ThreadList.tsx` | Collapsible thread picker. Fetches `GET /api/ai/threads`. |
| `ContextPill.tsx` | Shows current `pageContext` (the active view id) in the drawer header. |
| `ProposalCard.tsx` | Renders proposed act-tool calls awaiting user confirmation. Fires `POST /api/ai/confirm`. |
| `ToolBadge.tsx` | Inline badge showing tool name used in a message. |

`pageContext` (the current `view` string from the shell) is passed through to the chat payload so the system prompt can reference what page the user is on.

### Backend (`server/ai/`)

| File | Role |
|---|---|
| `router.ts` | Express router, mounts all `/api/ai/*` routes |
| `registry.ts` | Declarative tool catalog: `READ_TOOLS` (53 tools) + `ACT_TOOLS` (9 tools) |
| `chat.ts` | Main chat handler — tool-calling loop up to 5 turns |
| `confirm.ts` | Executes a user-confirmed act tool |
| `model.ts` | Model layer: Gemini 2.0 Flash (default) or Ollama qwen2.5 (local/fallback) |
| `prompts.ts` | System prompt generator (role-aware) |
| `invoke.ts` | Self-fetches tool endpoints server-side; `summarize()` truncates large responses |
| `audit.ts` | Writes every tool call to `ai_tool_log` |

### API Contract

| Endpoint | Body / Params | Response |
|---|---|---|
| `POST /api/ai/chat` | `{ message, threadId?, pageContext?, localOnly?, bypassMode? }` | `{ threadId, reply, proposals, toolsUsed, model }` |
| `POST /api/ai/confirm` | `{ tool, args, threadId? }` | `{ ok, tool, data }` |
| `GET /api/ai/threads` | — | `{ threads: [{ id, title, updated_at }] }` |
| `GET /api/ai/thread/:id` | — | `{ thread, messages }` |
| `DELETE /api/ai/thread/:id` | — | `{ ok, deleted }` |
| `GET /api/ai/audit` | `?limit=N` (admin only) | `{ log }` |

### Tool Registry

The AI has access to 53 read tools (no confirmation needed) and 9 act tools (propose-then-confirm by default).

**Read tools** map 1:1 to existing `/api/intel/*` endpoints. Examples: `search_quick`, `get_dashboard_kpis`, `query_projects`, `get_carrier_deep`, `get_adjuster_deep`, `get_predictor_score`, `list_denials`.

**Act tools** hit mutating endpoints. `danger: 'safe'` acts can auto-execute under admin bypass; `danger: 'destructive'` acts always require explicit confirmation.

| Act tool | Endpoint | Danger |
|---|---|---|
| `create_share_link` | `POST /api/intel/share` | destructive |
| `revoke_share_link` | `DELETE /api/intel/share/:slug` | destructive |
| `trigger_refresh` | `POST /api/intel/refresh` | safe |
| `analyze_denial` | `POST /api/intel/analyze-denial` | safe |
| `transcribe_denial` | `POST /api/intel/transcribe-denial` | safe |
| `predict_adjuster` | `POST /api/intel/adjuster-twin/predict` | safe |
| `mark_denial_outcome` | `POST /api/intel/denial-intake/:id/outcome` | destructive |
| `set_user_role` | `PATCH /api/admin/users/:id/role` | destructive |
| `webhook_score_lead` | `POST /api/intel/predictor/webhook` | safe |

### Confirm / Bypass Model

- All users: act tools produce proposals by default.
- Admin / `is_root_admin`: can set `bypassMode` in request body:
  - `'confirm'` (default): all act tools propose.
  - `'smart'`: auto-execute `danger: 'safe'` acts; propose `danger: 'destructive'` acts.
  - `'full'`: auto-execute all act tools.

### Rate Limits (in-memory, resets on restart)

| Role | Requests/hour |
|---|---|
| `employee` | 200 |
| `exec` | 500 |
| `analytics` | 500 |
| `admin` | unlimited |

### Model Selection

`selectModel()` in `model.ts`: uses `gemini-2.0-flash` if `GEMINI_API_KEY` is set; falls back to Ollama `local-qwen25:32b` at `OLLAMA_BASE_URL` (default `http://shadow21:4001`). Client can force local with `localOnly: true`.

---

## Auth Layer

`server/auth/`

Session-based auth (cookie `riq_session`). PIN is hashed with bcrypt.

| Endpoint | Description |
|---|---|
| `POST /api/auth/login` | Email + PIN → session cookie |
| `POST /api/auth/logout` | Revoke current session |
| `POST /api/auth/logout-all` | Revoke all sessions |
| `GET /api/auth/me` | Current user profile |
| `POST /api/auth/enroll/start` | Set initial PIN from invite token |
| `POST /api/auth/change-pin` | Change PIN (requires current PIN) |
| `GET /api/auth/sessions` | List active sessions |
| `POST /api/auth/sessions/:id/revoke` | Revoke a specific session |
| `POST /api/auth/welcome-seen` | Mark onboarding interstitial as seen |
| `PATCH /api/admin/users/:id/role` | Admin-only: change user role |
| `GET /api/auth/admin-bootstrap` | Mint JWT for seeded admin (legacy) |
| `GET /api/auth/bootstrap-config` | Whether `BOOTSTRAP_PIN` is required |

Sessions last 30 days. Account lockout after repeated wrong PINs (15-minute lockout).

---

## Build & Deploy

**Build gate**: `npm run build` (Vite + TypeScript; both must pass). Static HTML pages in `/public/` are copied to `dist/` during the build.

**Deploy**: `railway up --service riq21`

**Static serving**:

- `/dist/assets/*`: `Cache-Control: immutable, max-age=31536000`
- `index.html`, `sw.js`: `Cache-Control: no-cache`
- Everything else: `Cache-Control: max-age=300`

**Vercel**: `vercel.json` present; `VERCEL=1` skips `app.listen()` and the refresh scheduler. All data reads go through Postgres on Vercel (no file fallback).

**Data refresh** (non-Vercel): `startRefreshScheduler()` in `server/intel/scheduler.ts` runs nightly.

---

## Component / Route Map

```
IntelligenceHub
├── sidebar
│   ├── "Master Guide" button → view: master-guide (iframe: master.html)
│   └── NAV_GROUPS (role-filtered)
│       ├── My View
│       │   ├── admin-home   → AdminHome
│       │   ├── exec-home    → ExecHome
│       │   ├── my-day       → MyDay
│       │   ├── data-room    → DataRoom
│       │   └── home         → HomePane (legacy)
│       ├── Hubs (9)
│       │   └── <hub>-hub    → HubWrapper → NATIVE_HUB_TABS or iframe
│       ├── Executive
│       │   ├── exec         → ExecPage
│       │   ├── weekly-recap → WeeklyRecap
│       │   └── analytics    → Analytics
│       ├── Smart Brain
│       │   ├── predictor    → Predictor (native, not in NATIVE_VIEWS)
│       │   ├── cheat-sheet  → CheatSheet
│       │   ├── field-guide  → FieldGuide
│       │   ├── lead-score   → LeadScore
│       │   └── pipeline-intel → Pipeline
│       ├── AI Combat Suite  (iframe-backed)
│       ├── Maps & Geo
│       │   └── map          → RoofdocsMap (Leaflet)
│       ├── Outreach         (mixed: Campaigns/Solar/SmsReminders native; others iframe)
│       ├── Intelligence     (OpsTeam/Notes native; others iframe)
│       └── Operations       (OpsSurveillance/Scheduling/ActiveWork/Receivables native)
├── main content → renderView()
├── OnboardingInterstitial
└── ChatDrawer (Phase 6 AI)
    ├── ContextPill
    ├── ThreadList
    └── ChatPage
        └── ProposalCard (act-tool confirmations)

server/
├── index.ts           — Express app, static serving, 24 HUB_REDIRECTS, SPA fallback
├── intel/routes.ts    — /api/intel/* (data + AI analysis + sharing)
├── ai/router.ts       — /api/ai/* (chat, confirm, threads, audit)
├── auth/routes.ts     — /api/auth/* + /api/admin/*
└── db.ts              — postgres.js connection pool
```
