# Lead Score

View id: `lead-score`
Component: `src/components/views/native/field/LeadScore.tsx`
Roles: admin, exec, employee, analytics

AI-scored lead queue. Ranks open leads by approval probability using carrier, ZIP, storm, and adjuster signals. Gives reps a prioritized call list.

## Endpoints

- `GET /api/intel/customer-leads?limit=1500` — open leads with customer context; used as the input set for scoring
- `GET /api/intel/zip-stats?window=365` — ZIP performance stats for the last 365 days; used as a scoring signal (high-performing ZIPs boost the score)

## Key Flows

Scoring is done client-side using the signals available in the two fetched datasets. Leads are ranked by a composite score that weights carrier approval history, ZIP close rate, storm recency, and lead stage. The output is a sorted table with score bands (hot/warm/cold). Each row links to the customer detail or lead detail view.
