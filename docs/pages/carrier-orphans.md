# Carrier Orphans

View id: `carrier-orphans`
Component: `src/components/views/native/exec/CarrierOrphans.tsx`
Roles: admin, analytics

List of 165 jobs classified as "Insurance" type in the portal but with no carrier on file. These are data integrity gaps that may represent missed opportunity or mis-categorized jobs.

## Endpoints

- `GET /api/intel/carrier-orphans` — full list on mount; response shape includes job id, customer name, address, city, state, signed date, stage, sales rep, and any partial carrier data that was present

## Key Flows

Filterable and sortable by rep, stage, and signed date. Primary action is to identify orphans that are still active (not dead) and assign a carrier retroactively in the portal. The 165 orphan count is a static snapshot from the last nightly import.
