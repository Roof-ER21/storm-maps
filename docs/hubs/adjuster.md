# Adjuster Hub

View id: `adjuster-hub`
Deep-link: `/?view=adjuster-hub&tab=<tabId>`
Roles: admin, employee, analytics (exec excluded)

Three-tab adjuster intelligence hub. Replaced three standalone HTML pages.

---

## Tabs

### directory — Directory
File: `src/components/hubs/native/adjuster/AdjusterDirectory.tsx`

Full list of all adjusters sorted by completed jobs descending. Quick reference for reps before a meeting.

Endpoints:
- `GET /api/intel/adjusters-summary` — full adjuster list on mount; includes name, carrier, approval rate, completed count; all filtering is client-side

### detail — Adjuster Detail
File: `src/components/hubs/native/adjuster/AdjusterDetail.tsx`

Two-panel view: adjuster list on the left, deep-dive panel on the right. Shows carrier breakdown, rep pairings, job history, and approval rate trend.

Endpoints:
- `GET /api/intel/adjusters-summary` — left-pane list on mount (sorted by completed desc)
- `GET /api/intel/adjuster-deep?name=<name>&carrier=<carrier>` — on adjuster select; full detail including per-carrier stats, co-occurring reps, job timeline

### twin — Adjuster Twin (AI)
File: `src/components/hubs/native/adjuster/AdjusterTwin.tsx`

AI simulator that predicts how a specific adjuster will respond to a given scope of work. Uses Gemini 2.0 Flash with the adjuster's cheat-sheet data as context. Only adjusters with N≥5 jobs appear in the dropdown.

Endpoints:
- `GET /api/intel/adjuster-twin/list` — on mount; populates dropdown with adjusters who have enough data for a prediction
- `POST /api/intel/adjuster-twin/predict` — on run; body: `{ adjusterName, carrier, scope, photos? }`; response includes predicted approval stance, likely pushback points, and recommended counter-script

---

## Notable Behavior

- The Twin tab is one of two AI-backed act surfaces in the hubs (the other is the Denial Analyzer). Its predictions are based on the adjuster's historical pattern data, not a generic LLM.
- The Detail tab uses the same two-panel UX pattern as the Carrier Overview tab.
