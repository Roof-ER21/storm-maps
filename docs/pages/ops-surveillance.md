# Ops Surveillance

View id: `ops-surveillance`
Component: `src/components/views/native/ops/OpsSurveillance.tsx`
Roles: admin, exec, employee

Ops-team dashboard for tracking open supplements, cross-sell pipeline, and install readiness. The numbers shown here drive the tile counts on the HomePane quick-launch grid.

## Endpoints

- `GET /api/intel/active-work` — primary data; supplement tracker (count by carrier, oldest open, overdue threshold), cross-sell bids (count and $), install readiness (ready-with-no-date count); response is the `active-work` intel blob
- `GET /api/intel/adjustments-open` — fire-and-forget; open public-adjuster cases (Phil Hetrick sole assignee, 22 records); rendered in a separate PA section

## Key Layout

Three sections:
1. **Open Supplements** — 589 total, 344 overdue, broken down by carrier. Shows oldest open dates.
2. **Cross-Sell Pipeline** — 104 cross-sell bids across the active job pipeline ($3.2M).
3. **Open PA Cases** — public-adjuster case list from `adjustments-open`.

The supplement count and cross-sell count in the HomePane description string come from this component's data.
