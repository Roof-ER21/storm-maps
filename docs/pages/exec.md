# Exec Snapshot

View id: `exec`
Component: `src/components/views/native/exec/ExecPage.tsx`
Roles: admin, exec

Board-level snapshot of the business. The primary "what happened" surface for leadership.

## Endpoints

- `GET /api/intel/dashboard-kpis` — hero KPIs: total/completed/dead job counts, revenue, customer count, ZIP count, rep count, carrier count, storm-matched count; book composition (insurance vs. retail); tile counts (hot ZIPs, siding upsell, AR total, resurrection, storm exposure, storm playbook, notes, lifetime touch)
- `GET /api/intel/exec-summary` — board deck data: latest strong storm, top 5 reps last 12 months, top 5 ZIPs by revenue, year-over-year table, top 5 carriers by revenue, top 5 revenue-driving storms, risk flags (paused jobs, open supplements, dead jobs last 12 months), solar candidate count

## Key Layout

- **Hero strip**: completed revenue (N-year), completed jobs, lifetime signed, open AR
- **Opportunities column**: pre-built outreach lists (resurrection, storm exposure, siding upsell, solar candidates, open AR); each card navigates to the relevant view
- **Latest storm**: most recent hail ≥1" or wind ≥60 mph in service area; links to Storm Playbook
- **Top 5 reps / Top 5 ZIPs**: 12-month rolling vs. all-time
- **YoY table**: signed/completed/close rate/revenue by year
- **Top 5 carriers / Top 5 storms**: by revenue
- **Risk flags**: paused jobs, open supplements, dead jobs last 12 months
