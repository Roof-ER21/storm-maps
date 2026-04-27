# PDF Redesign Plan — Roof-ER Hail Impact Report

Target spec: `PDF-REDESIGN-SPEC-2026-04-27.md`
Source under rewrite: `server/storm/reportPdf.ts` (2281 lines, single sole caller `server/index.ts:965`)
Locked dependencies (DO NOT MODIFY): `displayCapService.ts`, `verificationService.ts`, `sourceTier.ts`, `narrativeComposer.ts`

---

## Phase 0 — Pre-work / safety

**Files to touch:** none (planning + branch only).
**Add/edit/delete:** create `git checkout -b pdf-redesign-2026-04-27`. Snapshot a baseline PDF for the three smoke-test addresses before any change so visual regressions are visible. Confirm `npm run test:display-cap` (65/65) is green on `main`.
**Tests:** `npm run test:display-cap`; manual baseline PDF capture for 17032 Silver Charm Place / 2024-08-29, same / 2025-07-16, 112 Levenbury Pl / 2025-05-16.
**Shippable when:** branch exists, baseline captured, no code change yet.

## Phase 1 — Data layer additions

**Files to touch:** new helpers in `server/storm/` only — `reportPdf.ts` consumers stay flat.
- **`fetchNwsWarningsForProperty(lat, lng, date)`** — already 95% available. `iemVtecClient.ts::fetchIemVtecForDate` returns SBW polygons + falls back to `api.weather.gov/alerts?point=`. Add a thin wrapper that filters via existing `pointInWarning`. NO new SQL.
- **`fetchNexradImageForWarning(effectiveIso, lat, lng)`** — already exists as `nexradImageService.ts::fetchNexradSnapshot` (IEM WMS-T `n0r-t.cgi`, 20s timeout, returns `Buffer | null`). Add only a 30-mile bbox helper around the property point + an in-memory LRU keyed on `${snapToFiveMin(iso)}|${lat.toFixed(2)}|${lng.toFixed(2)}` (cap 32 entries, 1h TTL). Spec calls for the IEM ridge `archive/data/.../GIS/uscomp/n0r_*.png` route — the WMS-T endpoint serves the same N0R mosaic with arbitrary bbox/time, so we keep WMS-T (proven in production at `reportPdf.ts:1987`).
- **`computeStormDirectionAndSpeed(events)`** — net-new but small. `windSwathService.ts` only computes wind buffers, not headings. Implement as: take chronologically-sorted hail events on the date of loss, compute great-circle bearings between consecutive points, return mean bearing (cardinal-snap) + mean displacement / time delta in mph. Reuse `geometry.ts::haversineMiles`. Returns `{ heading: string | null, speedMph: number | null }`.
- **`computeHailDuration(events)`** + **`computeStormPeakTime(events)`** — net-new, trivial. Filter events by ET-day match (the `datedEvents` filter already at `reportPdf.ts:524` is the model), then min/max `beginDate`. Both return strings or null; both are pure functions.

**Tests:** add `scripts/test-storm-metrics.ts` with table-driven cases for the three new pure helpers. The two fetchers are best smoke-tested by running an actual PDF gen — they already have null-safe error paths.
**Shippable when:** helpers exist, exported, unused. Old PDF still renders unchanged. `npm run test:display-cap` 65/65.

## Phase 2 — Header + Property Information

**Files to touch:** `reportPdf.ts` only. `ReportRequest` interface gains `customerName?: string`. `server/index.ts:965` must pass it through (one-line change to the request mapping).
**Add:** new `drawHeader()`, `drawVerificationStrip()`, `drawPropertyInformation()` helpers. The Google Static Maps fetcher already exists (`fetchStaticBasemap` lines 237–283) — reuse with `zoom=16, maptype=roadmap, 250×200`.
**Delete:** the navy "Storm Impact Analysis" banner (lines 643–650), the satellite hero image block (lines 652–693), the sub-header rep block (lines 696–727). The `fetchSatelliteAerial` function (302–333) becomes dead — remove it in Phase 7 cleanup once nothing imports it. Keep `fetchStaticBasemap` (still used by Property Information map).
**Tests:** `npm run test:display-cap`; smoke render and confirm header + property card match target visually.
**Shippable when:** new header + Property Information render correctly; everything below them still renders the legacy layout.

## Phase 3 — Hail Impact Details + Narrative

**Files to touch:** `reportPdf.ts`.
**Add:** `drawHailImpactDetails()` 4×2 table. Wires:
- Date of Hail Impact: format `req.dateOfLoss`.
- Time of Hail Impact: `computeStormPeakTime(datedEvents)`.
- Storm Direction / Speed: `computeStormDirectionAndSpeed(datedEvents.filter(Hail))`.
- Hail Duration: `computeHailDuration(datedEvents.filter(Hail))`.
- Size of Hail Detected: `displayHailIn(propertyImpact.bands.atProperty, propertyVerification)` — exact same call as today's tier-card headline, line 1227–1230.
- Nearby Hail Reported: `datedEvents.filter(eventType==='Hail').length`.
- Max Hail Size Reported: `displayHailIn(biggestHailIn, farBandCtx(propertyVerification))` — already computed at line 1551–1554.

The narrative section **stays unchanged** — `composeStormNarrative()` already receives `cappedHeadline` (line 1549). Just rename banner from "Storm Impact Narrative" to "Hail Impact Narrative" and remove the BIGGEST/CLOSEST callout pills (lines 1583–1594).

**Delete:** "Storm Coverage at Property" tier card block (lines 1070–1304 — the full 235-line tier-card section). Note: keep the `propertyImpact` fetch at lines 1075–1088 and the `verificationByDate` bulk fetch at 1132–1141 — both still feed the new section's display values.
**Tests:** `npm run test:display-cap`; smoke for Sterling 2024-08-29 (must show 3.00") and 2025-07-16 (must show 2.0").
**Shippable when:** Hail Impact Details + Narrative render correctly. The cap value in "Size of Hail Detected" matches what the deleted tier card used to show. Sections below still render legacy layout.

## Phase 4 — Ground Observations tables

**Files to touch:** `reportPdf.ts`.
**Add:** new `drawGroundObservationsHail()` and `drawGroundObservationsWind()`. Both pull from `histNceiRows` (already fetched at line 810) — filter to `dist ≤ radiusMiles`, `event_date == req.dateOfLoss`, restrict to PRIMARY-tier rows (`primarySourceLabel(r) !== null`), require `narrative !== null` for Comments column. Source-label mapping: `iem-lsr/nws-lsr → 'NOAA'`, `ncei-storm-events → 'NOAA'`, `mrms/nexrad-mrms → 'NEXRAD'`. Hail Size uses `displayHailInches` with a per-row `bandVerification` call against the same row's primary reports. Wind table sorts and limits to 5; **omits entirely** if no rows.
**Delete:** "Documented Storm Reports" big table (lines 1875–1940). Helper `drawTableHeader` is local-scoped and goes with it.
**Tests:** `npm run test:display-cap`. Smoke 112 Levenbury Pl 2025-05-16 — should show actual ground reports near the property.
**Shippable when:** Hail + Wind ground tables render with capped sizes. Below them still renders legacy NEXRAD map / warnings / disclaimer.

## Phase 5 — Severe Weather Warnings (HEAVIEST — riskiest section)

**Files to touch:** `reportPdf.ts`.
**Risk profile:** This is the largest unknown but **most of the machinery already exists** at lines 1942–2164. The current "Active National Weather Service Warnings" section already does per-warning NEXRAD fetch + 2-column panel + KV grid + product narrative. The rewrite is mostly relabeling + restyling, NOT new infrastructure.
**Reuse verbatim:** the warning fetch + sort logic (1950–1976), the per-warning radar fetch loop (1986–1994), `extractHailSize` / `extractWindSpeed` / `trimNarrative` parsers (2030–2061), `phenomenonLabel` / `fmtTime` (2011–2029).
**Add/edit:** restyle the panel to match target — title format `"Severe Thunderstorm Warning issued <effective> until <expires> by NOAA Storm Events Database"`, 2×3 KV grid (Effective/Expires/Hail Size/Wind Speed/Urgency/Certainty), full-width `NEXRAD Radar Image from <date> / <time>` caption + warning narrative below the columns.
**NEXRAD failure mode (critical):** existing `fetchNexradSnapshot` returns `null` on any error and is wrapped `.catch(() => null)` at line 1992. The current code falls through to a `#0b1220` dark fill rect (line 2090–2093). For the rewrite: **leave the radar slot blank (white) instead of dark fill** when null, per spec line 160. Also tighten the per-warning timeout from 20s (current `FETCH_TIMEOUT_MS` in `nexradImageService.ts`) to 8s by adding a `Promise.race` wrapper at the call site — do NOT modify `nexradImageService.ts`. Cap total warning-section radar budget at 30s; if exceeded, render remaining warnings without radar.
**Delete:** the legacy "NEXRAD Radar + Hail Footprint Map" wide-map section (lines 1702–1873) — replaced entirely by per-warning radar.
**Tests:** `npm run test:display-cap`. Smoke 112 Levenbury 2025-05-16 (target reference PDF address) — verify radar imagery appears for at least 1 warning. Test failure mode by temporarily blocking IEM in `/etc/hosts`; PDF must still render with blank radar slots.
**Shippable when:** Severe Weather Warnings renders to spec, blank-radar fallback verified, total PDF gen time stays under 60s on the smoke addresses.

## Phase 6 — Historical Storm Activity

**Files to touch:** `reportPdf.ts`.
**Add:** `drawHistoricalStormActivity()` — 9-column table over `verified_hail_events` primary-source rows on the date of loss within 10 mi. Reuse the existing `histNceiRows` fetch (line 810) and the `histGroups` Map (line 819) — both already populated. Reuse the per-band `bandVerification(r.primaryAtProperty, ...)` calls (lines 1415–1432) for the At Location / Within 1mi / Within 3mi / Within 10mi cap rendering. Direction / Speed / Duration columns delegate to the new pure helpers from Phase 1.
**Spec ambiguity to flag:** spec line 180 calls "Within 1mi" for the 0.5–3 mi `mi1to3` band. That's slightly misleading naming but matches the target PDF's column headers. Keep the strict bucket boundaries (≤0.5 / 0.5–3 / 3–5 / 5–10) intact — the labels are cosmetic.
**Delete:** the existing "Property Hail Hit History" combined table (lines 1306–1488). The dataset stays (`histGroups`, `sortedHistRows`); only the rendering swaps.
**Tests:** `npm run test:display-cap`; smoke all 3 addresses, confirm Sterling 2024-08-29 row appears with 3.00" in At Location for 17032 Silver Charm Place.
**Shippable when:** Historical Storm Activity table renders, cap values agree with the deleted hit-history table for the date-of-loss row.

## Phase 7 — Disclaimer / footer + cleanup

**Files to touch:** `reportPdf.ts`.
**Add:** rephrase disclaimer per spec (single paragraph starting "Roof-ER Storm Intelligence uses NEXRAD weather radar data..."). Replace "Findings derived from..." preamble (lines 2233–2243) by absorbing it into the disclaimer's first sentence per spec note. Add gray-fill `Copyright © <year> by Roof-ER` strip.
**Delete:** Storm Summary card section (called at line 1616 — read 1598–1700 before removing). "Field Evidence" section if `req.evidence` deprecation is confirmed. Dead helper functions: `fetchSatelliteAerial`, `fetchStreetViewImage`, `fetchEvidenceImageBytes`, `makeMercatorProjector`, `hexToRgb` (only used by deleted swath rendering), `deriveBounds` (still needed for warning bounds — keep), `RenderedPolygon` interface, the `pointInRing` import (still needed for warnings — keep).
**Tests:** Final `npm run test:display-cap` 65/65; full smoke set; visual diff against `~/Downloads/E2E_Fresh_Test.pdf`.
**Shippable when:** all 5 verification gates from spec line 287–294 pass.

---

## Risk register

1. **NEXRAD per-warning fetch latency.** Current code fetches sequentially with 20s timeouts — a date with 5 warnings could spend 100s. Mitigation: parallelize with `Promise.all`, cap each at 8s, cap total at 30s, render blank slot on miss.
2. **`req.customerName` plumbing.** New optional field requires editing `server/index.ts` route handler. Low risk but cross-file change.
3. **Cap algorithm intersection.** Hail Impact Details, Ground Observations Hail, and Historical Storm Activity all run `displayHailInches` with per-band `VerificationContext`. The existing per-band ctx code at lines 1415–1432 and 1262–1272 must be preserved verbatim and re-wired into the new sections, not reimplemented. Any reimplementation breaks the 65 unit tests.
4. **`histGroups` swath direct-hit injection** (lines 933–1008) populates dates not in `verified_hail_events`. The new Historical Storm Activity table must keep this ingestion or some real storm dates will silently disappear.
5. **Production traffic during phased rollout.** Each phase ships a working PDF that mixes new + legacy sections. Validate that mixed-state PDFs still satisfy adjuster review by sharing a sample with the rep using the report most heavily.
6. **`fetchIemVtecForDate` returns from two backends** (IEM SBW + NWS api fallback). The fallback path returns synthetic 0.1° box rings around the property point when the real polygon is unavailable. This means `pointInWarning` always passes — the section will surface every fallback warning. Acceptable per spec but worth noting.

---

## Default answers (Ahmed in auto mode — proceed unless he course-corrects)

1. **`customerName` field:** plumb through optionally on `ReportRequest`. UI can backfill later. Empty → omit the customer info subsection.
2. **`aiAnalysis` rendering:** drop from PDF in Phase 7. Leave the upstream `buildAiSectionHtml` plumbing untouched in `reportService.ts` so a future product call to re-enable doesn't require a server-side dig.
3. **Logo + seal:** pure PDFKit primitives. Backend agent draws `ROOF·ER / THE ROOF DOCS` text mark + house-roof glyph + small red roof seal.
4. **Sterling allow-list:** no additions in this redesign. List is locked.
5. **"Within 1mi" naming:** keep as-is (cosmetic mismatch with the 0.5–3 mi bucket is intentional, matches target PDF).
6. **Report ID format:** keep current `${epochSeconds}-${random7digits}`.
