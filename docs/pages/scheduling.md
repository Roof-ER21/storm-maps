# Scheduling

View id: `scheduling`
Component: `src/components/views/native/ops/Scheduling.tsx`
Roles: admin, employee

Install schedule pipeline. Shows overdue installs, this-week schedule, unscheduled ready jobs, stale pipeline, and rep workload.

## Endpoints

- `GET /api/intel/scheduling` — full scheduling intel blob on mount; derived from 4.4k active portal jobs; includes:
  - Overdue installs (354 as of last import) — jobs past their scheduled install date
  - This-week schedule — jobs with install dates in the next 7 days
  - Unscheduled ready jobs (141 as of last import) — approved, ready for install, no install date set
  - Stale pipeline — jobs stuck in pre-install stages for 60+ days
  - Rep workload — install queue per rep
  - Age distribution — histogram of days-since-signed for uninstalled jobs

## Key Flows

Primary ops tool for install coordination. The "354 overdue / 141 ready with no date" numbers are surfaced in the HomePane quick-launch tile. Filterable by rep and stage. The stale pipeline section is the key escalation list for the ops team.
