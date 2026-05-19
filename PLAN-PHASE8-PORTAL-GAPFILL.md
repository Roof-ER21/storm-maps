# RIQ 21 — Phase 8: Portal Gap-Fill Plan

**Status:** Draft 2026-05-19 · pre-execution
**Source:** Cross-referenced today's portal recon (`~/web-recon/data/reports/FINAL/21_GAP_FILL_2026-05-19.md`) against current RIQ 21 datasets
**Goal:** Bring RIQ 21 to feature-parity with portal-known data + add 3 net-new capabilities (leads, ops surveillance, KPI truth sync)

---

## EXECUTIVE SUMMARY

RIQ 21 currently mirrors the **post-conversion** side of the Roof Docs operation (16,355 jobs, 458 carriers, 12,225 customers). Today's portal recon revealed **5 categories of data we don't yet ingest** — collectively the biggest gap is the **pre-conversion lead pipeline** (540 active leads, never seen before).

Three tiers of work:

| Tier | Theme | Effort | Value |
|------|-------|--------|-------|
| **1** | Lead Pipeline (`/admin/leads` + `/admin/leads/employees`) | 2 days | HIGH — net-new revenue forecast |
| **1** | KPI Truth Sync (`/admin/reporting/profit` + `/admin/reporting/kpis`) | 1 day | HIGH — replace computed w/ source-of-truth |
| **2** | Operational Surveillance (fixes / tasks / punchlist / supplements refresh) | 2 days | MEDIUM — ops manager view |
| **2** | Calendar + Scheduling (events × 4 + progress/{jobId}/{customerId}) | 2 days | MEDIUM — appointment intelligence |
| **3** | Pricing v2 (review templates with items + finance plans) | 1 day | LOW-MEDIUM — replace v1 templates |
| **3** | Communication Intelligence (chat threads) | 2 days | LOW-MEDIUM — denial pattern enrichment |
| **3** | Compliance Layer (photo tags + document types) | 1 day | LOW — audit + photo gap detection |

**Total:** ~11 days for full gap-fill; **Tier 1 alone** (3 days) unlocks the biggest single feature.

---

## TIER 1: LEAD PIPELINE + KPI TRUTH (3 days)

### Phase 8a — Lead Pipeline (HIGH PRIORITY)

**Why:** RIQ 21 has zero pre-conversion visibility. The portal has 540 active leads with full PII + carrier + roof age + house type + location. This is the funnel input that becomes our 16K project export 6-12 months later.

**Data to pull:**
- `GET /v1/admin/leads` (540 rows, ~1 MB)
- `GET /v1/admin/leads/employees` (193 rows, ~204 KB)

**Schema (confirmed from today's capture):**
```
leads: leadID, status, priority, appointmentDate, leadStatus,
       firstName, lastName, email, cellPhoneNumber, homePhoneNumber,
       addressLine1, addressLine2, city, state, zipCode, coordinates,
       roofAge, roofAccess, houseType, yearsInHome, ...

leads/employees: userID, firstName, lastName, email, password (bcrypt),
                 servicePassword, roleId, repId, fieldTrainerId,
                 salesManagerId, commissionType,
                 minimumCommissionPercentage, medianCommissionPercentage,
                 maximumCommissionPercentage, trainerThreshold,
                 trainerThresholdMinimumPercentage, ...,
                 salesRepBasePay, allowDrawBasePay, insuranceDownpayment
```

**Implementation:**

1. **Pull script** — `scripts/roofdocs/pull-leads.mjs`
   - Hits 2 endpoints, writes `data/roofdocs-reference/leads.json` + `leads-employees.json`
   - Adds 2 lines to `refresh-all.sh` ep_pair list (replace any pricing slot)

2. **Builder** — `scripts/roofdocs/build-leads.mjs`
   - Reads raw → derives `data/leads.json` with:
     - Funnel: total_leads / by_status / by_priority / by_zip / by_carrier
     - Conversion ladder: leads_with_appointment / leads_in_decision / converted_to_job (cross-ref jobs by phone/email)
     - Lead-to-rep mapping (which employees can receive)
     - Stuck leads: `leadStatus` unchanged 14+ days
     - SCRUB: drop password / servicePassword from `leads-employees.json` before persist

3. **Postgres** — add `intel_leads` table + backfill script
   - Schema mirrors lead fields w/ JSONB `data` fallback
   - Indexes: `(leadStatus, createdAt)`, `(zipCode, status)`, `(repId, leadStatus)`
   - Builder: `scripts/roofdocs/backfill-intel-leads.mjs`

4. **API endpoints** — `server/intel/aggregates.ts`
   - `GET /api/intel/leads-summary` — funnel KPIs (total, conversion %, by_status)
   - `GET /api/intel/leads-query?status=X&zip=Y&limit=N` — filtered list
   - `GET /api/intel/lead-deep?leadID=X` — single lead detail + nearby jobs + carrier intel
   - `GET /api/intel/lead-pipeline?rep=X` — rep-specific pipeline
   - `GET /api/intel/lead-conversion-funnel?period=30d` — time-series

5. **Frontend** — `public/leads.html` (new page)
   - Top: funnel viz (lead → appointment → decision → signed)
   - Middle: filtered list with status badges + appointment date sort
   - Right rail: stuck-leads alert + carrier × zip hot zones
   - Action button: "Mark as Resurrection Target" (sets future custom field)

**Deliverable:** `/api/intel/leads-summary` returning live funnel + `/leads.html` page; ranked stuck-lead alert in exec dashboard.

---

### Phase 8b — KPI Truth Sync (HIGH PRIORITY)

**Why:** RIQ 21 computes close rates, lifecycle days, approval % from raw projects. Portal computes from same source. **They should match to the penny.** Today's capture shows they currently do (close rate 51.23%) — but other KPIs (lifecycle, days-for-install, lead conversion) are computed in only one place. Phase 4 audit hardened this, but we don't have portal's numbers as ground truth.

**Data to pull:**
- `GET /v1/admin/reporting/profit` (returns 13-field profit dict)
- `GET /v1/admin/reporting/kpis` (returns 16-field KPI dict)
- `GET /v1/admin/reporting/kpis/stage` (per-stage breakdown — NEW)
- `GET /v1/admin/reporting/insurance` (insurance company names list)

**Schema (confirmed today):**
```
reporting/profit: jobCount, insuranceTotal, upgrades, addWork, changeOrders,
                  repair, retail, wnd, credits, supplementTotal,
                  overheadExpenseTotal, materialExpenseTotal, laborExpenseTotal

reporting/kpis: retailCount, repairCount, insuranceCount, insuranceConversionCount,
                unknownCount, nonrecoverableCount, addOnCount, publicAdjusterCount,
                roofingSquares, sidingSquares,
                approvalPercentage, projectLifecycle, daysInBalancePending,
                daysForInstall, leadConversion, leadClosed
```

**Implementation:**

1. **Pull** — `scripts/roofdocs/pull-portal-kpis.mjs`
   - Hits 4 endpoints, writes `data/roofdocs-reference/portal-kpis-{profit,kpis,kpis-stage,insurance}.json`
   - Add to `refresh-all.sh` ep_pair list

2. **Comparison report** — `scripts/roofdocs/audit-kpi-drift.mjs`
   - Computes RIQ 21's version of each metric from `intel_projects`
   - Diffs against portal's number; emits drift report
   - Fails CI if drift > 1% (so we know if portal changes definition)

3. **API endpoint** — `GET /api/intel/portal-kpis` (NEW)
   - Returns portal's live numbers + RIQ 21's computed alongside + diff %
   - Surfaces in exec dashboard as "Portal Truth" badges next to our metrics

4. **Predictor calibration** — update `server/intel/predictor.ts`
   - v1 predictor uses 9 close-rate buckets. Recalibrate against portal's lifetime numbers:
     - Insurance: 7,874 jobs lifetime (not just our 16K-job window)
     - approval %: 51.23% as global prior
     - daysForInstall: 40.2 — use as recency multiplier

**Deliverable:** Source-of-truth KPI endpoint, CI gate on drift, predictor recalibrated.

---

## TIER 2: OPS SURVEILLANCE + SCHEDULING (4 days)

### Phase 8c — Operational Surveillance

**Why:** Active-work.json today summarizes supplement tracker only. We have no surveillance on fixes (140 records), tasks (1,995), or punch list (15 jobs). Ops managers fly blind in RIQ 21.

**Data to pull:**
- `GET /v1/admin/fixes/open` (140 records, 1.2 MB)
- `GET /v1/admin/tasks/all` (1,995 records, 2.2 MB)
- `GET /v1/dashboard/punchList/all` (15 records, 41 KB)
- `GET /v1/admin/supplements/open` (348 records, 2.9 MB — RIQ 21 has 288, stale)

**Schema (today's recon):**
```
fixes: jobFixID, trade, description, completed, createdAt, completedAt,
       jobProgressTradeId, jobId, employeeId, photos[],
       jobProgress_trade, employee, job

tasks: taskListID, description, priority, notes, createdAt, dueDate,
       skipEmail, pending, completedAt, archived, employeeId, customerId,
       assignorId, contractorId, user

punchList: jobID, name, addressLine1..zipCode, userId, projectManagerId,
           statusId, substatusId, notes, usingEnhancedPhotos, workCompleted,
           pauseHistory[]
```

**Implementation:**

1. **Pull script** — `scripts/roofdocs/pull-ops.mjs` (one script, 4 endpoints)
2. **Builders:**
   - `build-fixes.mjs` → `data/fixes.json` (rolled up by rep, by trade, by age)
   - `build-tasks.mjs` → `data/tasks.json` (rolled up by assignee, by priority, by overdue)
   - `build-punchlist.mjs` → `data/punchlist.json` (15 records w/ pause history insights)
   - Update `build-active-work.mjs` to consume fresh supplements data
3. **Postgres tables:**
   - `intel_fixes` (jobFixID PK, indexed by (employeeId, completed), (jobId))
   - `intel_tasks` (taskListID PK, indexed by (employeeId, completedAt), (customerId, dueDate))
   - `intel_punchlist` (jobID PK)
4. **API endpoints:**
   - `GET /api/intel/fixes-summary` — by rep, by trade, by age bucket
   - `GET /api/intel/fixes-by-rep?rep=X` — rep's open fixes
   - `GET /api/intel/tasks-overdue` — past-due tasks
   - `GET /api/intel/tasks-by-rep?rep=X`
   - `GET /api/intel/punchlist-active`
5. **Frontend:** Replace `active-work.html` with v2 — 4 tabs (Supplements / Fixes / Tasks / Punch List)

### Phase 8d — Calendar + Production Scheduling

**Why:** No visibility into upcoming appointments or per-trade install schedules.

**Data to pull:**
- `GET /v1/events/customers/all` — customer appointments
- `GET /v1/events/employees/all` — employee assignments
- `GET /v1/events/production/all` — production schedule
- `GET /v1/events/sales/all` — sales appointments
- `GET /v1/progress/{jobId}/{customerId}` — per-trade scheduling (for active jobs only)

**Implementation:**

1. **Pull** — `pull-calendar.mjs` (5 endpoints; `progress` is per-job loop limited to active statusIds)
2. **Builder** — `build-schedule.mjs` → `data/schedule.json`
   - Today/tomorrow appointments
   - Week-ahead production load
   - Schedule conflicts (overlap detection)
   - Crew utilization (from `progress/.../requiredCrews`)
3. **Postgres:** `intel_events` (one row per event, indexed by date/employeeId)
4. **API:**
   - `GET /api/intel/schedule-today?role=X`
   - `GET /api/intel/schedule-week?team=production`
   - `GET /api/intel/job-schedule?jobId=X` — per-trade view
5. **Frontend:** New `public/schedule.html` (production calendar + sales pipeline timeline)

---

## TIER 3: COMPLETENESS (4 days)

### Phase 8e — Pricing v2 + Finance

**Data:** `admin/review/templates/all` (548 KB w/ items inline — RIQ 21's `pricing-templates.json` is a subset) · `admin/finance` (5 finance plans).

- Refresh `build-pricing-templates.mjs` to consume `review/templates/all` (which inlines items vs. current join)
- New `build-finance.mjs` → `data/finance-plans.json` (5 plans w/ rates)
- API: `GET /api/intel/finance-plans` (5-record list)
- Frontend: add finance plans to `customer-detail.html` upsell section

### Phase 8f — Communication Intelligence

**Data:** `chat/internal/{jobId}` + `chat/contractors/{jobId}` (per-job chat threads; sampled for 100 active jobs to start).

- `pull-chats.mjs` — loops top 100 active-status jobs, pulls both chat endpoints, scrubs PII
- `build-chats.mjs` → `data/chats.json` (rollup: avg msg/job, @mention frequency, denial-language flags)
- Feed into `denial-analyzer.ts` as a new corpus stream — chat messages often contain "carrier said X" verbatim that the denial corpus doesn't capture
- API: `GET /api/intel/chat-insights` (rolled-up stats only; no message bodies in API)

### Phase 8g — Compliance Layer

**Data:** `admin/photos/tags/1..7` (46-tag hierarchy across 7 stages) · 70+ document types from `documents/admin/{customerID}` sampling.

- `pull-compliance.mjs` — 7 photo tag endpoints + 50 sample customer doc lists
- `build-compliance.mjs` → `data/compliance.json`
  - Per-stage required photo tags (canonical)
  - Document type registry (70+ types)
  - **Gap detection:** for each active job, % of required photos uploaded
- API:
  - `GET /api/intel/photo-tags?stage=X`
  - `GET /api/intel/document-types`
  - `GET /api/intel/photo-gap?jobId=X` — what's missing for stage transition
- Frontend: badge on `customer-detail.html` showing photo compliance for current stage

---

## EXECUTION SEQUENCE (proposed)

Run in this order — each phase builds infra useful for next:

```
Week 1
  Mon: 8b  KPI Truth Sync (1 day)        — quick win, audits baseline
  Tue: 8a  Leads Pipeline pull + builder
  Wed: 8a  Leads endpoints + leads.html
  Thu: 8c  Ops Surveillance pull + builders
  Fri: 8c  Ops endpoints + active-work.html v2

Week 2
  Mon: 8d  Calendar + Schedule pull + builders
  Tue: 8d  Schedule endpoints + schedule.html
  Wed: 8e  Pricing v2 + Finance
  Thu: 8f  Comm Intel (sampled)
  Fri: 8g  Compliance Layer + integration tests
```

---

## DATA-VOLUME IMPACT

Adding to current ~80MB live dataset:

| Phase | Add | Size | New tables |
|-------|-----|------|------------|
| 8a | leads + employees | ~1.2 MB | `intel_leads` |
| 8b | KPI snapshots | <50 KB | (blobs only) |
| 8c | fixes + tasks + punchlist + fresh supplements | ~6 MB | `intel_fixes`, `intel_tasks`, `intel_punchlist` |
| 8d | events (4) + progress per active job | ~3-5 MB | `intel_events` |
| 8e | pricing v2 + finance | +500 KB | (blob update) |
| 8f | chat sample (100 jobs) | ~500 KB | (blob) |
| 8g | photo tags + doc registry | <100 KB | (blob) |

Total: ~12 MB additional, ~3 new Postgres tables.

---

## REFRESH-ALL.SH CHANGES

New endpoints to add (will fit existing `ep_pair` pattern):

```bash
"admin/leads:leads"
"admin/leads/employees:leads-employees"
"admin/fixes/open:fixes-open"
"admin/tasks/all:tasks-all"
"dashboard/punchList/all:punchlist-all"
"admin/supplements/open:supplements-open"
"admin/reporting/profit:portal-kpi-profit"
"admin/reporting/kpis:portal-kpi-summary"
"admin/reporting/kpis/stage:portal-kpi-stage"
"admin/reporting/insurance:portal-insurance-names"
"admin/finance:finance-plans"
"admin/review/templates/all:review-templates"
"events/customers/all:events-customers"
"events/employees/all:events-employees"
"events/production/all:events-production"
"events/sales/all:events-sales"
"admin/photos/tags/1:photo-tags-1"
"admin/photos/tags/2:photo-tags-2"
"admin/photos/tags/3:photo-tags-3"
"admin/photos/tags/4:photo-tags-4"
"admin/photos/tags/5:photo-tags-5"
"admin/photos/tags/6:photo-tags-6"
"admin/photos/tags/7:photo-tags-7"
```

Per-job loops (only for active jobs, statusId 1-9):
```bash
node scripts/roofdocs/pull-chats.mjs       # chat/internal + chat/contractors
node scripts/roofdocs/pull-progress.mjs    # progress/{jobId}/{customerId}
node scripts/roofdocs/pull-documents.mjs   # documents/admin/{customerId} sample
```

---

## OPSEC NOTES

- All Tier 1+2 pulls add 11 new endpoint hits per refresh — current cadence ~2-3x/week
- Total per-refresh API calls: currently ~20 → after Phase 8 ~50 (still well under any reasonable rate limit)
- All endpoints are admin-normal (Ford navigates to Reporting/Leads/Tasks/Fixes daily)
- Per-job loops (Phase 8d/8f/8g) at 100-job sample = 200 additional hits, throttled to 1/sec
- Photo tags 7 endpoints = same as Ford navigating Photos → Tags tab once

---

## OPEN QUESTIONS

1. **Lead data scrub:** `password` and `servicePassword` fields exist on `leads/employees` response. Scrub before write? Yes. Confirmed in plan.
2. **Chat threads PII:** customer phone/email may appear in message bodies. Scrub before write? Need rule.
3. **Per-job loops scope:** active jobs only (statusId 1-9) = ~600-1000 jobs. At 1/sec = 10-17 min per refresh. Acceptable or too slow?
4. **KPI drift CI gate:** if portal redefines `leadConversion`, our 99.37% will diverge. Block deploy or just warn?

---

## SUCCESS CRITERIA

By end of Phase 8 (any tier, individually deployable):

- **Tier 1 (8a/8b):** `/leads.html` live; exec dashboard shows portal-truth KPI badges
- **Tier 2 (8c/8d):** `active-work.html` v2 with 4 tabs; `/schedule.html` live
- **Tier 3 (8e-g):** Finance plans surfaced in customer-detail; photo-gap badge on active jobs

Each tier is independently shippable — no flag-day deploy.

---

## NEXT STEP

Confirm tier priority + start Phase 8a (Leads) or 8b (KPI Truth Sync) — both are 1-2 days, both deliver immediately visible value.
