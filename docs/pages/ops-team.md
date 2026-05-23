# Ops Team

View id: `ops-team`
Component: `src/components/views/native/ops/OpsTeam.tsx`
Roles: admin, exec, employee, analytics

Per-role employee performance dashboard. Ops managers use this to see individual employee workload and output across roles (field tech, supplement writer, AR, etc.).

## Endpoints

- `GET /api/intel/employee-roster` — on mount; UUID-to-display-name map for all employees
- `GET /api/intel/ops-team-summary?role=<role>` — on role selection; list of employees in that role with summary stats (open items, completed, throughput)
- `GET /api/intel/ops-team-deep?role=<role>&key=<name>` — on employee selection; full detail for that employee including job-level breakdown, open supplement list, AR list, or install queue depending on role

## Key Flows

Role picker (field tech / supplement writer / AR / project manager). Selecting a role loads the team summary for that role. Selecting an individual employee loads their deep-dive. The employee roster provides the name mapping since portal data uses UUIDs.
