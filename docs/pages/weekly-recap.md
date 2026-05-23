# Weekly Recap

View id: `weekly-recap`
Component: `src/components/views/native/exec/WeeklyRecap.tsx`
Roles: admin, exec

Printable/exportable weekly brief. Configurable window (7/14/30 days) and state filter (VA/MD/PA). Designed to be shared with the team or printed as a PDF.

## Endpoints

- `GET /api/intel/weekly-recap?days=<N>&state=<s>` — signed/completed/dead job counts, revenue, delta vs. prior period, top reps, AR snapshot
- `GET /api/intel/storms-light` — full IEM storm dataset; filtered client-side to the selected window to find qualifying events (hail ≥1", wind ≥60 mph, tornado)
- `GET /api/intel/resurrection` — full resurrection list; filtered client-side to events with storm dates in the selected window to surface "new resurrection candidates this week"
- `GET /api/intel/jobs-nearby?lat=<lat>&lng=<lng>&radius=3` — fires for the top 5 storms in the window to count customers within 3 miles of each event

## Key Sections

1. The Numbers — signed/completed/dead/revenue with delta vs. prior period
2. Top Reps This Week — by signed count
3. Strong Storms This Week — hail/wind/tornado events with magnitude and customers in 3mi
4. New Resurrection Candidates — dead jobs hit by a storm for the first time this window
5. AR Watch — CF Pending/Sent count, total open accounts, downpayments awaiting
6. Action Items — auto-generated checklist based on the above data

## Export

Three export options: Print/Save as PDF (`window.print()`), Copy as HTML (clipboard), Download as HTML file. The recap content renders inside a `div#riq-weekly-recap-content` for easy capture.
