# Campaigns

View id: `campaigns`
Component: `src/components/views/native/field/Campaigns.tsx`
Roles: admin, employee, analytics

Upsell campaign list generator. Shows completed roof customers who have never purchased siding — the primary siding upsell pool.

## Endpoints

- `GET /api/intel/customers-list` — full customer list on mount; filtered client-side to identify customers with a completed roof job but no siding job; all segmentation is client-side

## Key Flows

Displays the siding upsell pool (count shown in the ExecPage opportunity card). Filterable by rep, ZIP, and completion year. Each row is a completed roof customer with no siding history — a warm lead for a siding pitch. The list can be exported as CSV.
