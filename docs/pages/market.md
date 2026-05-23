# Market Intelligence

View id: `insurance-intel`
Component: `src/components/views/native/exec/Market.tsx`
Roles: admin, exec, analytics

Carrier market intelligence hub. Aggregates NAIC complaint data, carrier rankings, live market hardening news, AI patent library, and real denial case database into a single research surface.

## Endpoints

- `GET /api/intel/naic-complaint-index` — NAIC complaint ratios per carrier (Indiana 2022 baseline); `{ source, carriers: Record<name, NaicEntry> }`
- `GET /api/intel/live-market-intel` — OH Top 70 HO carriers 2024 + MD Market Hardening Survey Nov 2024 (non-renewals +62%, roof restrictions, county breakdown)
- `GET /api/intel/insurer-rankings` — composite carrier scores: AM Best, market share, NOAA county risk tiers for VA/MD/PA/OH
- `GET /api/intel/carrier-patents` — full patent library: `{ byCarrier, patents, generated }`
- `GET /api/intel/denial-sources-full` — 29 annotated real denial cases with patent mappings, carrier tactics, and proven counter-plays
- `GET /api/intel/storm-exposure` — 2.5k storm-exposed customers (used for risk-zone mapping in the market context)

## Key Sections

Carrier threat matrix (exits, rate hikes, restriction zones), NAIC complaint ranking, market hardening details (MD non-renewal zones, roof restrictions), carrier AI patent summary by carrier, real denial case browser.
