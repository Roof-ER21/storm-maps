# Ops Team

View id: `ops-team`
Component: `src/components/views/native/ops/OpsTeam.tsx`
Roles: admin, exec, employee, analytics

Per-role employee performance dashboard. Ops managers use this to see individual employee workload and output across roles (field tech, supplement writer, AR, etc.).

## Endpoints

- `GET /api/intel/employee-roster` — on mount; UUID-to-display-name map for all employees
- `GET /api/intel/ops-team-summary?role=<role>` — on role selection; response `{ role, people: [{ name, signed, completed, dead, revenue, closeRate, avgJob }], total, took_ms }` sorted by signed count descending
- `GET /api/intel/ops-team-deep?role=<role>&key=<name>` — on employee selection; response `{ summary: { signed, completed, dead, open, revenue }, cities, carriers, reps, trades, zips, medianCompleteDays, bigJobs: [{ customer, addressLine1, city, state, stage, signedDate, jobTotal }], took_ms }`; all sub-lists are `{ name, count }` arrays

## Key Flows

Role picker (`projectCoordinator` / `estimator` / `fieldTechId`). Selecting a role loads the team summary for that role. Selecting an individual employee loads their deep-dive. The employee roster provides the name mapping since portal data uses UUIDs.
