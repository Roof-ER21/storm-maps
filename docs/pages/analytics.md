# Analytics

View id: `analytics`
Component: `src/components/views/native/exec/Analytics.tsx`
Roles: admin, exec, analytics

Full client-side analytics over the entire 16k job dataset. All charts and breakdowns are computed in the browser after a one-time load of the two large blobs.

## Endpoints

- `GET /api/intel/projects` — full 16k job array (37 MB JSON); loaded once on mount; all subsequent analytics are client-side
- `GET /api/intel/job-storms` — job-to-storm-of-record mapping (5.7k pairs); used to correlate storm events with job outcomes in the analytics views

## Key Capabilities

Carrier analysis, rep leaderboard, ZIP heat maps, stage funnel visualization, job-type breakdown, lead-source breakdown, YoY trends, storm-matched job analysis, and time-series charts over the full job history.

## Performance Note

The `projects` blob is the largest fetch in the platform (~37 MB). It is cached with `Cache-Control: private, max-age=600` on the server and browser-cached for 10 minutes. First load is slow; subsequent renders within the session use the in-memory dataset.
