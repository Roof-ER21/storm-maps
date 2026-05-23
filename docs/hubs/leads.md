# Leads Hub

View id: `leads-hub`
Deep-link: `/?view=leads-hub&tab=<tabId>`
Roles: admin, exec, employee, analytics

Two-tab leads funnel hub. Replaced two standalone HTML pages.

---

## Tabs

### intel — Leads Intel
File: `src/components/hubs/native/leads/LeadsIntel.tsx`

Leads funnel rollup with breakdowns by status, rep, priority, referral method, and ZIP. Pre-aggregated snapshot from the last import.

Endpoints:
- `GET /api/intel/leads-rollup` — full rollup blob on mount; includes by-status funnel counts, rep leaderboard, priority distribution, referral method breakdown, and top ZIPs
- `GET /api/intel/leads-employees` — fire-and-forget; per-employee lead assignments (fetched but noted as not rendered in this tab)

### funnel — Leads Funnel
File: `src/components/hubs/native/leads/LeadsFunnel.tsx`

Filterable live leads list with funnel KPIs. Employees see only their own assigned leads (server-enforced).

Endpoints:
- `GET /api/intel/leads-summary` — funnel KPIs + rep leaderboard + status breakdown on mount; uses the `leads-rollup.json` blob

---

## Notable Behavior

- The `employee` role sees this hub but the server enforces that `leads-query` and `lead-pipeline` only return the calling user's own leads.
- The Intel tab is snapshot-backed (pre-aggregated blob); the Funnel tab can also draw from the live `intel_leads` table via `leads-query`.
- Lead deep-dives (single lead + nearby projects) are accessible via `GET /api/intel/lead-deep?id=<id>` and via the AI assistant, but are not a standalone hub tab.
