# Pipeline Intel

View id: `pipeline-intel`
Component: `src/components/views/native/exec/Pipeline.tsx`
Roles: admin, exec, analytics

Pipeline DNA dashboard. Single endpoint, all data. Shows the statistical structure of the job pipeline — where jobs get stuck, which signals predict approval, and what automation triggers are available.

## Endpoints

- `GET /api/intel/pipeline-intel` — single blob; includes:
  - Supplement signal: 83.4% approval rate for supplemented jobs vs. 11.7% baseline
  - Stage bottleneck analysis: where jobs stall and how long
  - Carrier approval matrix: approval rate by carrier × job type
  - Seasonal patterns: signing and completion rates by month
  - Rep risk flags: reps with abnormal dead-job or stall rates
  - 7 automation trigger definitions with thresholds

## Key Flows

The supplement signal (83% vs 12%) is the headline stat. The stage bottleneck view identifies specific handoff points that cause delays. The 7 automation triggers are actionable rules the ops team can wire into their CRM (e.g., auto-flag a job for supplement when it stalls 14+ days at a given stage).
