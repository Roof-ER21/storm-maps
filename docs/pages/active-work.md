# Active Work

View id: `active-work`
Component: `src/components/views/native/ops/ActiveWork.tsx`
Roles: admin, exec, employee, analytics

Active jobs intelligence: supplement tracker, cross-sell pipeline, and install readiness in a single view. Closely related to Ops Surveillance but oriented toward individual job-level detail rather than aggregate counts.

## Endpoints

- `GET /api/intel/active-work` — full active-work blob on mount; derived from 4.4k active portal jobs; supplement open counts by carrier, cross-sell bid list with job IDs and amounts, install-readiness list (approved jobs with no install date)

## Key Flows

Three sections: Open Supplements (job-level list with carrier, days open, rep), Cross-Sell Bids (job-level with trade and bid amount), Install Ready (job-level with approval date and days waiting). Each section is sortable and filterable by rep and carrier.
