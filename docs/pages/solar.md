# Solar Funnel

View id: `solar`
Component: `src/components/views/native/field/Solar.tsx`
Roles: admin, employee, analytics

Pre-qualified list of customers whose roofs are in the ideal age range for a solar upsell (1–7 years post-completion).

## Endpoints

- `GET /api/intel/solar-candidates` — full candidate list on mount; pre-filtered server-side to completed roof jobs 1–7 years old; response includes customer name, address, completion date, roof age, rep, and carrier

## Key Flows

Filterable by rep, ZIP, and roof age band. Primary use: reps scan their own portion of the list for solar outreach calls. The candidate count is surfaced in the ExecPage opportunity card and the ExecSummary `solarCandidates` field.
