# Roof Docs AI Property Scoring Engine — Pivot Plan

**Date:** 2026-05-11
**Repo:** `/Users/a21/Desktop/storm-maps` (current) → renamed to new product
**Status:** Plan draft; not started

---

## Executive Summary

Pivoting the legacy storm-maps repo (deprecated as Hail Yes; the live Hail Yes is now at `/Users/a21/storm-archive`) into an **internal AI property scoring engine for Roof Docs sales conversion**. The product scores residential properties across VA/MD/PA on claim approvability, conversion likelihood, estimated job value, and recommended action — feeding rep canvassing strategy and lead prioritization.

Reuses 80%+ of existing infrastructure (Gemini vision, storm history, Google Maps, auth, leads, PDF). Net-new build is multi-county parcel + permit + deed ingestion, scoring engine, and scored map/list/dashboard UI.

**Not an adjuster tool. Not a TurboClaim clone. Plays where we already have a moat.**

---

## Naming (Pending User Decision)

| Option | Vibe |
|---|---|
| **RoofLens** | Vision + analytics framing |
| **RoofIQ** | Intelligence framing |
| **PropScore** | Score-first framing |
| **KnockSmart** | Sales/canvasser framing |
| **RoofPilot** | Guidance framing |
| **ScoutAI** | Recon framing |

Recommend **RoofLens** or **RoofIQ** for v1. Domain check + brand approval pending.

---

## Product Definition

**Users:** Roof Docs reps (canvassers, closers), sales managers, ops.
**NOT users:** Carriers, adjusters, homeowners.
**Goal:** Replace gut-feel canvassing + cold lead prioritization with data-driven scoring.

### Core flows
1. **Single address lookup** — rep types/scans address → score card with explanation
2. **Neighborhood heatmap** — manager picks zip/storm date → map colored by score → canvass deployment
3. **Batch scoring** — paste/upload list of addresses → ranked output → push top N to CC21
4. **Storm-triggered scoring** — Hail Yes alert fires → auto-score the swath bounding box → notify managers

### Score outputs per address
- **Approvability** (0–100) — likelihood of insurance approving full replacement
- **Conversion** (0–100) — likelihood of homeowner saying yes
- **Job value** ($) — projected revenue if won
- **Action** — `KNOCK` / `WAIT` / `SKIP` / `REVISIT_AFTER_STORM`
- **Carrier hint** — per zip, dominant carrier + supplement package guidance
- **Confidence + explanation** — natural-language reasoning of which inputs drove the score

---

## Architecture

### Reuse from storm-maps
- React 19 + Vite SPA, Google Maps integration, Tailwind v4
- Express 5 + TypeScript + Postgres + Drizzle ORM
- Gemini AI property image analyzer (`server/ai/*`)
- MRMS / NEXRAD / ground-report storm pipeline + DIRECT HIT classification
- Display-cap algorithm
- Lead pipeline + evidence schema (extends to scored addresses)
- JWT + PIN auth, rep profiles, team codes
- PDFKit reports (re-templated for scoring summaries)
- Web push (VAPID) for alerts

### Net new
- Per-county parcel ingestion adapters (VA/MD/PA, 27 priority counties)
- Permit ingestion adapters (re-roof permits especially)
- Deed/ownership ingestion (length of ownership, owner-occupied)
- Aerial imagery integration (Google Static Maps + Gemini Vision analysis)
- Property value lookup (RentCast v1, ATTOM v2)
- Carrier-by-zip knowledge base (manager admin UI)
- Scoring engine (rule-based with Gemini reasoning layer)
- Scored map/list/dashboard UI
- CC21 lead push API

---

## Data Sources

### VA — 9 Priority Counties
| County | Source | Method | Quality |
|---|---|---|---|
| Fairfax | gis.fairfaxcounty.gov | ArcGIS REST | Excellent |
| Loudoun | logis.loudoun.gov | ArcGIS REST | Excellent |
| Prince William | gis.pwcgov.org | ArcGIS REST | Good |
| Arlington | gisdata-arlgis.opendata.arcgis.com | ArcGIS REST / Open Data | Good |
| Alexandria | alexandriava.gov/gis | ArcGIS REST | Good |
| Stafford | stafford.va.us GIS | ArcGIS REST | OK |
| Spotsylvania | spotsylvania.va.us GIS | ArcGIS REST | OK |
| Fauquier | fauquiercounty.gov GIS | ArcGIS REST | OK |
| Manassas City | manassascity.org GIS | Scraping | Limited |

VA has strong ArcGIS REST coverage; most counties expose parcel polygons + attributes natively.

### MD — 9 Priority Counties
| County | Source | Method | Quality |
|---|---|---|---|
| Montgomery | mcatlas.org | ArcGIS REST | Excellent |
| Prince George's | pgatlas.com | ArcGIS REST | Excellent |
| Anne Arundel | aacounty.org GIS | ArcGIS REST | Good |
| Howard | data.howardcountymd.gov | Socrata + ArcGIS | Good |
| Baltimore Co | gis.baltimorecountymd.gov | ArcGIS REST | Good |
| Baltimore City | data.baltimorecity.gov | Open Data | Good |
| Frederick | frederickcountymd.gov GIS | ArcGIS REST | OK |
| Charles | charlescountymd.gov GIS | ArcGIS REST | OK |
| Carroll + Harford | County GIS portals | ArcGIS REST | OK |

Statewide fallback: MD SDAT bulk parcel download (mdpgr.maryland.gov).

### PA — 9 Priority Counties
| County | Source | Method | Quality |
|---|---|---|---|
| Philadelphia | opendataphilly.org | Open Data API | Excellent — parcels + L&I permits |
| Allegheny | gis.alleghenycounty.us | ArcGIS REST | Excellent |
| Montgomery | gis.montcopa.org | ArcGIS REST | Good |
| Bucks | buckscounty.gov GIS | ArcGIS REST | Good |
| Chester | chesco.org GIS | ArcGIS REST | Good |
| Delaware | co.delaware.pa.us GIS | ArcGIS REST | Good |
| Lancaster | co.lancaster.pa.us | ArcGIS REST | OK |
| York | yorkcountypa.gov GIS | ArcGIS REST | OK |
| Lehigh + Northampton | County GIS portals | ArcGIS REST | OK |

PA is most fragmented — no statewide aggregator; each county is its own portal.

### Permit Data
- **VA:** Most counties via separate building dept portals or Socrata; Tyler Tech "EnerGov" common. Scraping required for several.
- **MD:** Montgomery + PG have open data; others manual.
- **PA:** Philadelphia L&I is gold standard (full permit dataset); others vary.

### Aerial Imagery
- **v1:** Google Static Maps satellite (free tier; sufficient for most analysis)
- **v2:** Nearmap or EagleView (paid; higher resolution + temporal pre/post storm)

### Property Value
- **v1:** RentCast API (~$0.10/lookup; basic AVM)
- **v2:** ATTOM Data (enterprise; full owner + value + sale history + mortgage)

### Prior Claims
- CLUE reports: adjuster-only via LexisNexis, NOT public.
- Substitute: storm history + permit history + property age = inferred claim likelihood.

### Carrier-by-Zip Patterns
- Build from CC21 + Hail Yes historical jobs (export → cluster by zip → manager edits)
- Manager admin UI for ongoing tuning

---

## Phasing — 15 Weeks Total

### Phase 0 — Project Setup (Week 1)
- Tag final storm-maps commit, create rebrand branch
- Pick name + domain (user decision)
- Update README, package.json, repo settings
- Decide Railway: new service or rename existing
- Schema migration plan (additive, no destruction of existing tables)
- **Deliverable:** Renamed repo, fresh DB migration plan, brand v0

### Phase 1 — Parcel Ingestion Framework (Weeks 2–4)
- Build `CountyAdapter` interface: `fetchParcels(bbox)`, `fetchParcelByAddress(addr)`, `refresh()`
- ArcGIS REST client base class (handles most counties)
- Socrata client base class (Philly, some MD)
- Implement 9 VA + 9 MD + 9 PA = 27 priority counties
- Unified `parcels` table: address, lat/lng, county, year_built, sq_ft, lot_size, owner_name, owner_occupied, taxable_value, roof_material, last_sale_date, last_sale_price, source, fetched_at
- Daily refresh worker (cron)
- **Deliverable:** All 27 priority counties ingesting nightly. ~3M parcels.

### Phase 2 — Permit + Deed Ingestion (Weeks 5–6)
- Re-roof permit detection (filter by permit_type + description keywords)
- Deed/sale history for length-of-ownership
- `permits` table: parcel_id, permit_type, date_filed, date_completed, value, contractor
- `deed_history` table: parcel_id, sale_date, sale_price, buyer, seller
- **Deliverable:** Permit + deed data for priority counties.

### Phase 3 — Aerial + Value (Week 7)
- Google Static Maps satellite fetch per parcel (lazy, cache 90d)
- Gemini Vision pipeline: roof condition, material, tree canopy %, hail vulnerability proxy
- RentCast API integration for property value
- `aerial_analysis` table: parcel_id, image_url, roof_condition, roof_material_inferred, tree_canopy_pct, gemini_response, analyzed_at
- **Deliverable:** Aerial-based features + property value lookup live.

### Phase 4 — Carrier Knowledge + Local Patterns (Week 8)
- Pull CC21 + Hail Yes historical jobs → cluster by zip + carrier
- `carrier_zip_patterns` table: zip, carrier, approval_rate, typical_supplement_pkg, notes
- Manager admin UI for editing
- **Deliverable:** Carrier-by-zip table populated + editable.

### Phase 5 — Scoring Engine (Weeks 9–10)
- Define scoring formulas (rule-based v1):
  - **Approvability:** storm severity at address × roof age × carrier patterns × permit history
  - **Conversion:** owner-occupied × length of ownership × property value × neighborhood density
  - **Job value:** sq_ft × roof complexity × current pricing
  - **Action:** decision tree from above
- Gemini reasoning layer: produces natural-language explanation
- Backtest against past Roof Docs wins/losses (CC21 export)
- `scores` table: parcel_id, score_type, value, confidence, explanation, computed_at, inputs_hash
- **Deliverable:** Scoring engine producing scores for all ingested parcels.

### Phase 6 — UI Build (Weeks 11–12)
- Address search → score card (single address detail view with all inputs + explanation)
- Map heatmap — Google Maps tile overlay colored by score; filter by date/zip/action
- Batch upload — paste list of addresses, get ranked CSV/PDF
- Manager dashboard — score distributions, team coverage, conversion tracking
- Rep mobile view — geolocate, show top-scored addresses nearby, log knocks
- **Deliverable:** Full UI for reps + managers.

### Phase 7 — CC21 Integration (Week 13)
- Push high-score leads → CC21 (existing lead intake API)
- Pull conversion outcomes back nightly → score model learning
- SSO with CC21 auth (optional v2)
- **Deliverable:** Bi-directional CC21 integration.

### Phase 8 — Pilot + Calibration (Week 14)
- Pilot with 2–3 reps in DMV
- Calibrate scoring weights against actual outcomes
- Fix UX bugs, train team
- **Deliverable:** Pilot complete, scoring v1 calibrated.

### Phase 9 — Full Rollout (Week 15)
- All VA/MD/PA reps onboarded
- Daily scoring at scale
- Manager weekly reports automated
- **Deliverable:** Production rollout.

---

## Tech Stack Decisions

| Layer | Choice | Rationale |
|---|---|---|
| Frontend | React 19 + Vite + Google Maps | Reuse from storm-maps |
| Backend | Express 5 + TypeScript | Reuse |
| DB | Postgres (Railway) + Drizzle ORM | Reuse |
| AI vision | Gemini 2.0 Flash | Already wired |
| AI reasoning | Gemini 2.5 Pro | For explanations |
| Aerial v1 | Google Static Maps | Free tier sufficient |
| Aerial v2 | Nearmap | Higher res + temporal |
| Property value v1 | RentCast API | $0.10/lookup |
| Property value v2 | ATTOM Data | Enterprise upgrade |
| Maps tiles | Google Maps | Already integrated |
| Deploy | Railway | Already there |
| Push notifications | Web push (VAPID) | Already there |

---

## Risks + Mitigations

| Risk | Mitigation |
|---|---|
| County data formats vary wildly | Adapter pattern; budget 5–6 edge cases |
| Some counties require API approval | Apply for keys week 1; fall back to scraping if denied |
| Privacy concerns (owner names in DB) | Encrypt PII at rest; manager-role access only |
| Gemini API costs balloon | Cache results 30–90d; batch where possible; rate-limit per rep |
| Scoring model drifts from reality | Continuous calibration against CC21 outcomes; quarterly retune |
| Permit data is junk in some counties | Acceptable; score degrades gracefully when data missing |
| Rep adoption | Pilot first; build features reps ask for; tie to CC21 they already use |
| Gemini hallucinates owner/permit data | Always cite source row; reject any AI-generated facts without source |

---

## Success Metrics

| Metric | Target |
|---|---|
| Parcel coverage | 95% of priority county parcels by week 4 |
| Score quality | 70%+ correct action recommendation in backtest |
| Rep adoption | 60% of canvassers DAU by week 15 |
| Conversion lift | +20% on top-scored leads vs control |
| Address → score latency | <2s p95 |

---

## Open Questions for User

1. **Final project name + domain** — RoofLens / RoofIQ / something else?
2. **Pilot reps** — which 2–3 in DMV?
3. **Paid data budget** — RentCast tier, ATTOM upgrade timing, Nearmap eval timing
4. **storm-maps live status during transition** — keep or kill immediately?
5. **CC21 integration scope** — read-only push, or bi-directional with conversion feedback?
6. **Carrier-by-zip data** — who's the manager who knows this best (Reese)?
7. **Score visibility to reps vs managers** — should reps see all scores or only top-N?

---

## Out of Scope (v1)

- Adjuster-facing reports (we are explicitly NOT building this — different product)
- Xactimate/ESX parsing (TurboClaim's lane; not ours)
- Claim filing / supplement generation
- Homeowner-facing UI
- Carrier API integrations
- Mobile native apps (PWA only v1)
- Non-DMV/PA markets (v2+)
- Licensing to other roofers (v2+ after Roof Docs validates)

---

## What We're NOT
We are not a TurboClaim clone. We are not an adjuster credibility tool. We are not Hail Yes (that's storm-archive). We are an **internal sales conversion engine** that uses storm data + AI vision + parcel/permit/value data to tell a rep which door to knock and why.
