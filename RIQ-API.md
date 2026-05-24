# RIQ 21 Intel API

Internal Roof Docs intelligence layer. Mines portal jobs + IEM storm events into
predictor + field-guide + resurrection + storm-playbook + carrier-orphan datasets.

**Base URL:** `https://riq21.up.railway.app` (when deployed) · `http://localhost:3100` (local dev)
**Refresh cadence:** stealth cron weekday business hours ~2-3x/week (re-derives + IEM storms only, never touches portal). New jobs pulled in via manual `./scripts/roofdocs/refresh-all.sh`.
**Data source:** `portal.theroofdocs.com` + IEM LSR + correlation engine

---

## Authentication

Two paths:

### 1. Session cookie (web SPA + static pages)
The RIQ SPA and the static `/public/*.html` pages authenticate with the user's
Roof Docs session cookie. No extra work needed in-browser.

### 2. API key (external consumers — CC21, Susan, etc.)
Pass an API key in the `x-riq-api-key` header:

```bash
curl -H "x-riq-api-key: riq_xxxxxxxx" https://riq21.example.com/api/intel/health
```

Keys are configured in `.env.local` as `RIQ_API_KEYS` (comma-separated to allow
rotation). Request a key from the admin.

### Auth mode
Server-side `AUTH_REQUIRED` env var:
- `off` / `optional` — anyone can read (default for staged rollout)
- `required` — must have a session OR a valid API key

Flip to `required` once consumers are stable.

---

## CORS

`RIQ_CORS_ORIGINS` env var (comma-separated list) controls which origins get
`Access-Control-Allow-Origin` headers. When unset, all origins are allowed
(intel is internal anyway). Pre-configured for:

- `https://cc21-web-production.up.railway.app` (CC21 Command Center)
- `https://egypt21.up.railway.app` (Susan21)
- Local dev ports (5180, 5174, 3000)

---

## Endpoints

### `GET /api/intel/_meta`
Discovery doc. Lists all endpoints + dataset descriptions. **Hit this first.**

### `GET /api/intel/health`
Service status + data freshness.

```json
{
  "status": "ok",          // "ok" | "stale" | "critical"
  "oldestFileHours": 0.5,
  "refreshedNightly": "3:33 AM ET via launchd",
  "generated": "2026-05-12T15:30:00.000Z",
  "files": { "projects": { "available": true, "bytes": 38194837, "ageHours": 0.5 }, ... }
}
```

Use this for uptime/freshness monitoring. `status` flips to `stale` after 36h
without a refresh, `critical` after 72h.

### `GET /api/intel/manifest`
Inventory of available datasets with bytes + mtime (no descriptions — use `/_meta` for that).

### `GET /api/intel/:key`
Fetch a specific dataset. Keys:

| Key | Size | Description |
|---|---|---|
| `projects` | 37 MB | 16k flattened jobs with carrier, adjuster, storm-of-record |
| `patterns` | ~700 KB | Mined carrier × adjuster × zip × hail × speed patterns |
| `resurrection` | ~900 KB | 700 dead-insurance jobs with new storm activity |
| `storm-exposure` | ~3.6 MB | 2.5k customers with storm exposure since first contact |
| `storm-playbook` | ~3.5 MB | 116 recent strong storms × trade-gap call lists |
| `receivables` | varies | Open AR + downpayments + collections |
| `notes` | ~4.3 MB | 9.7k free-text job notes |
| `job-storms` | ~1.7 MB | Job → storm-of-record matches (5.7k pairs) |
| `geocoded` | varies | Census-geocoded coords for jobs missing portal lat/lng |
| `carrier-orphans` | ~177 KB | 165 Insurance jobs missing carrier on file |
| `storms-light` | 37 MB | Filtered IEM hail/wind events 2018→present (FeatureCollection) |

All responses are JSON. Cache-Control: `private, max-age=600` (10 min).

### `POST /api/intel/refresh`
Returns instructions for triggering a manual refresh. Requires a real session
(API key alone won't do it — refresh is a privileged op).

### Operations surveillance (Phase 8c) — over `intel_fixes` / `intel_tasks` / `intel_punchlist`

| Endpoint | Returns |
|---|---|
| `GET /api/intel/fixes-summary` | `{ total, open, completed, by_trade:[{key,count}], by_rep:[{employee_id,rep,open,completed}], by_age:[{bucket,count}] }` |
| `GET /api/intel/fixes-by-rep?rep=<employee_id>` | `{ rep, open:[{id,job_id,trade,description,created_date,photo_count}], count }` |
| `GET /api/intel/tasks-overdue` | `{ total_overdue, by_rep:[{employee_id,rep,count}], items:[{id,description,priority,due_date,employee_id,customer_id}] }` |
| `GET /api/intel/tasks-by-rep?rep=<employee_id>` | `{ rep, pending:[…], overdue_count, count }` |
| `GET /api/intel/punchlist-active` | `{ total, items:[{id,name,city,state,status_id,substatus_id,work_completed}] }` |

`?rep=` accepts a numeric `employee_id` (exact) or a name (ILIKE fallback). Empty until the ops data pull lands.

### Calendar / scheduling (Phase 8d) — over `intel_events` (sales + production event feeds)

| Endpoint | Returns |
|---|---|
| `GET /api/intel/schedule-today` | `{ date_et, total, by_type:[{key,count}], events:[…] }` (events whose ET calendar day = today) |
| `GET /api/intel/schedule-week?days=N` | `{ days, total, by_day:[{day,count,events:[…]}] }` (default 7) |
| `GET /api/intel/schedule-upcoming?type=&customer=&limit=` | `{ total, events:[…] }` |

Event shape: `{ id, event_type, audience, start_time, end_time, customer_id, lead_id, supplier_id, notes, source }`. Sources the sales + production event feeds only (not the customer/employee directories). Empty until the events pull lands.

### Denial intelligence (Combat suite)

| Endpoint | Returns |
|---|---|
| `GET /api/intel/denial-intake/stats` | `{ total, byCarrier, byOutcome, winRates:[{carrier,total,approved,partial,denied,flipRate}], stanceRollup, carrierStanceMatrix }` |
| `GET /api/intel/denial-intake/list?carrier=&limit=` | recent analyzed denials + latest outcome |
| `GET /api/intel/denial-intake/:id` | full record + outcome history |

---

## Example: pull carrier orphans into CC21

```typescript
const RIQ = 'https://riq21.up.railway.app';
const RIQ_KEY = process.env.RIQ_API_KEY!;

async function getCarrierOrphans() {
  const res = await fetch(`${RIQ}/api/intel/carrier-orphans`, {
    headers: { 'x-riq-api-key': RIQ_KEY },
  });
  if (!res.ok) throw new Error(`RIQ orphans ${res.status}`);
  const data = await res.json();
  return data.actionable; // 71 jobs needing carrier backfill
}
```

## Example: Susan field-guide tab from patterns

```python
import os, requests

resp = requests.get(
    'https://riq21.up.railway.app/api/intel/patterns',
    headers={'x-riq-api-key': os.environ['RIQ_API_KEY']},
)
patterns = resp.json()
# patterns.carriers[i].name, jobs, approvalRate, avgApprovedJob, ...
# patterns.hailTiers[i].bucket, jobs, approvalRate
# patterns.speedToSign[i].bucket, jobs, approvalRate
# patterns.carrierByZip[i].carrier, zip, jobs, approvalRate
```

## Example: build a resurrection email blast

```bash
# Pull jobs that died but had a strong storm since
curl -sH "x-riq-api-key: $RIQ_API_KEY" https://riq21.example.com/api/intel/resurrection \
  | jq '.[] | select(.hailMag >= 1.0) | { customer, address, deathDate, storm: .strongestStorm }' \
  | jq -s 'sort_by(.storm.peak) | reverse | .[:50]'
```

---

## What's NOT in this API

- **Storm radar / MRMS overlays / NEXRAD** — those live in [Hail Yes](https://hailyes.up.railway.app/api/events). RIQ feeds *from* Hail Yes for storm activity.
- **Photo data** — portal photos endpoint returns empty for our token. Use the portal's deep-link instead: `https://portal.theroofdocs.com/jobs/{id}`.
- **Real-time job updates** — RIQ refreshes nightly. For live job state, hit `portal.theroofdocs.com` directly (token rotates).

---

## Operational

- **Refresh log:** `/Users/a21/storm-maps/.logs/cron-refresh.log`
- **Last successful refresh marker:** `/Users/a21/storm-maps/.logs/last-ok.txt` (unix epoch seconds)
- **launchd plist:** `~/Library/LaunchAgents/com.theroofdocs.intel-refresh.plist`
- **Manual run:** `cd /Users/a21/storm-maps && ./scripts/roofdocs/refresh-all.sh`
- **Token expiry tracking:** `/Users/a21/web-recon/data/sessions/theroofdocs.json` (JWT exp claim)

When the portal JWT expires, refresh will fail with a clear error in the log;
re-login via `cd /Users/a21/web-recon && node scripts/login-only.js`.

---

## Roadmap

- **Phase 4 (next):** move JSON files → Postgres tables via Drizzle for concurrent access + faster queries
- **Phase 5:** sharing endpoints (`/api/intel/share` with short-code links)
- **Phase 6:** ML upgrades — XGBoost + SHAP for Predictor, Google `lifetime_value` for CLV
- **Phase 7:** webhook out → CC21 lead pipeline when a resurrection candidate fires
