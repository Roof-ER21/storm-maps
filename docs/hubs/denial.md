# Denial Hub

View id: `denial-hub`
Deep-link: `/?view=denial-hub&tab=<tabId>`
Roles: admin, employee, analytics (exec excluded)

Three-tab combat suite for insurance denial management. Replaced three standalone HTML pages.

---

## Tabs

### analyze — Denial Analyzer
File: `src/components/hubs/native/denial/DenialAnalyze.tsx`

Primary workflow for fighting a denial. Paste or upload a denial letter; the backend runs it through Gemini 2.0 Flash, matches it against the 26-carrier patent library, identifies bad-faith signals, and drafts a counter-letter. Every successful analysis is automatically recorded to the intake archive.

Endpoints:
- `GET /api/intel/carrier-patents` — on mount; populates the carrier picker dropdown
- `POST /api/intel/transcribe-denial` — optional file upload step (PDF/image → text via Gemini multimodal); body: `{ base64, mimeType }`
- `POST /api/intel/analyze-denial` — main analysis; body: `{ denialText, carrier?, stance? }`; response includes matched patents, bad-faith signals, and a drafted counter-letter; also records intake automatically
- `POST /api/intel/denial-intake/:id/outcome` — optional outcome button after analysis; body: `{ outcome, counter_sent?, outcome_date?, notes? }`

Key flow: paste denial text (or upload file → transcribe → auto-paste) → select carrier → Analyze → review patent matches + counter-letter → optionally mark outcome.

### archive — Denial Archive
File: `src/components/hubs/native/denial/DenialArchive.tsx`

Browse all past denial intake records. Filter by carrier, outcome, and date range. Mark outcomes to close the loop.

Endpoints:
- `GET /api/intel/denial-intake/list?carrier=<filter>&limit=200` — filtered list on mount and on filter change; parallel with stats
- `GET /api/intel/denial-intake/stats` — summary counts (parallel on load)
- `POST /api/intel/denial-intake/:id/outcome` — outcome form per record; body: `{ outcome, outcome_date?, counter_sent?, notes? }`

### stats — Denial Stats
File: `src/components/hubs/native/denial/DenialStats.tsx`

Aggregated outcomes dashboard — charts and tables over the denial intake corpus.

Endpoints:
- `GET /api/intel/denial-intake/stats` — full stats on mount; response includes outcome breakdown, carrier breakdown, timeline, and corpus metadata

---

## Notable Behavior

- The Analyze tab is the only tab in the platform that sends data to an external AI (Gemini 2.0 Flash). File uploads are base64-encoded before transmission.
- Every successful analysis auto-creates an intake record. The Archive and Stats tabs give visibility into all past analyses and outcomes.
- `denial-corpus` blob (mined from GroupMe + Gmail + PDFs) is the few-shot training set used by the analyzer prompt — separate from the `denial-sources-full` blob used in the Carrier Algorithms tab.
