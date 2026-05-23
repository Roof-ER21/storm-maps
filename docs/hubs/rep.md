# Rep Hub

View id: `rep-hub`
Deep-link: `/?view=rep-hub&tab=<tabId>`
Roles: admin, exec, analytics (employee excluded)

Two-tab sales rep intelligence hub. Replaced two standalone HTML pages.

---

## Tabs

### overview — Rep Overview
File: `src/components/hubs/native/rep/RepOverview.tsx`

Two-panel view: rep list on the left, deep-dive panel on the right. Shows signed/completed counts, revenue, ZIP breakdown, carrier breakdown, and job timeline for the selected rep.

Endpoints:
- `GET /api/intel/reps-summary` — left-pane list on mount; includes all reps with signed, completed, dead, revenue, and close rate
- `GET /api/intel/rep-deep?name=<rep>` — on rep select; response `{ trades, carriers, cities, zips, medianSpeedDays, medianCompleteDays, bigJobs, took_ms }`; each dimension list is `[{ name, count }]`; `bigJobs` is `[{ customer, addressLine1, city, state, insurance, stage, signedDate, jobTotal }]`

### response — Rep Response Time
File: `src/components/hubs/native/rep/RepResponse.tsx`

Shows how quickly each rep signed a job after a qualifying storm hit the property. Helps managers identify reps who respond fastest to storm leads.

Endpoints:
- `GET /api/intel/rep-response` — initial load; includes year list for the year filter
- `GET /api/intel/rep-response?year=<year>` — on year filter change; same shape, filtered to the selected year

---

## Notable Behavior

- Employees do not have access to this hub (`VIEW_ROLES["rep-hub"]` excludes `employee`). They can view their own rep detail via the AI assistant's `get_rep_deep` tool (role-enforced to self-only on the server).
- The Response tab is useful alongside storm data: a rep who closes jobs within 14 days of a storm is a storm-response specialist.
