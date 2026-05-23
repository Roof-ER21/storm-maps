# Carrier Hub

View id: `carrier-hub`
Deep-link: `/?view=carrier-hub&tab=<tabId>`
Roles: admin, exec, employee, analytics

The Carrier Hub consolidates all carrier intelligence into one tabbed surface. It replaced four standalone HTML pages (redirected via 301).

---

## Tabs

### overview — Carrier Overview
File: `src/components/hubs/native/carrier/CarrierOverview.tsx`

Left-pane list of all carriers sorted by completed jobs. Selecting a carrier loads a full detail panel.

Endpoints:
- `GET /api/intel/carriers-summary` — loads carrier list on mount
- `GET /api/intel/carrier-deep?name=<carrier>` — on carrier select; includes approval rates, rep breakdown, adjuster breakdown, YoY trend
- `GET /api/intel/carrier-complaints?carrier=<carrier>` — fire-and-forget; appends NAIC complaint index score
- `GET /api/intel/receivables/rollup?carrier=<carrier>` — fire-and-forget; appends AR friction data for the carrier
- `GET /api/intel/active-work` — fire-and-forget; appends open supplement count per carrier

### trades — Carrier x Trades
File: `src/components/hubs/native/carrier/CarrierTrades.tsx`

Heatmap of carrier vs. trade (roof/siding/gutters/solar). Shows approval rates and job counts at each intersection.

Endpoints:
- `GET /api/intel/carrier-trade-matrix` — full matrix on mount; all filtering is client-side

### playbook — Carrier Playbook
File: `src/components/hubs/native/carrier/CarrierPlaybook.tsx`

Carrier-specific denial phrase library and intake stats. Helps reps recognize boilerplate language in denial letters and match it to known patterns.

Endpoints:
- `GET /api/intel/carrier-boilerplate` — n-gram phrase library per carrier
- `GET /api/intel/denial-intake/stats` — aggregate denial outcome stats (displayed alongside)

### algorithms — Algorithm Decoder
File: `src/components/hubs/native/carrier/CarrierAlgorithms.tsx`

Decoded carrier AI patent decision rules, cross-referenced with real denial cases and complaint data. The most data-dense tab in the hub.

Endpoints:
- `GET /api/intel/carrier-patents` — patent-disclosed decision rules + counter-plays by carrier
- `GET /api/intel/denial-sources-full` — 29 annotated real denial cases with patent mappings
- `GET /api/intel/naic-complaint-index` — complaint ratios for context
- `GET /api/intel/insurer-rankings` — optional; composite carrier scores
- `GET /api/intel/live-market-intel` — optional; OH/MD market hardening data

---

## Notable Behavior

- The Overview tab uses a two-panel layout: carrier list on the left, detail panel on the right. Selecting a carrier fires 4 parallel fetches.
- The Algorithm Decoder tab is the richest in the platform — it links patent IDs to real denial cases and provides counter-play scripts per carrier.
- The `carrier-boilerplate` dataset is noted as V1 (corpus too small for most carriers); it matures as denial intake grows.
