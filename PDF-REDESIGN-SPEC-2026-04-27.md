# PDF Redesign Spec — Roof-ER Hail Impact Report

**Reference target:** `~/Downloads/E2E_Fresh_Test.pdf` (4 pages, 1.1 MB)
**Source code to rewrite:** `server/storm/reportPdf.ts` (current output diverges on every section)
**Cap algorithm + per-band verification + sourceTier** — DO NOT TOUCH; PDF generation already imports them and they must keep flowing the same display values into the new layout.

This is a layout + section rewrite of `buildStormReportPdf`. Data flow stays the same:
- displayHailInches() for every hail-size string
- Sterling-class allow-list still active
- per-band VerificationContext from histGroups still feeds bucket display
- sourceTier classifySource gates which sources surface
- 65 unit tests must keep passing (`npm run test:display-cap`)

---

## Header (top of page 1)

1. **Top thin gray strip, full-width, centered:**
   `Hail Impact Report #: <reportId>`
   (small font, ~10pt, dark gray text on light-gray fill)

2. **Three-column header row** below the strip:
   - **Left:** Roof-ER logo. Use a stylized text mark `ROOF·ER / THE ROOF DOCS` with a house roof icon glyph above. Vector, no image asset. Black/dark navy on white.
   - **Center-left:** Rep contact block, left-aligned:
     - Name (bold, ~10pt)
     - Phone
     - Email (red/brand-link color, underline)
   - **Center-right:** Report metadata, left-aligned:
     - `Hail Impact Report` (bold, ~12pt)
     - `Report #: <reportId>` (regular, ~9pt)
     - `Date: <generated timestamp ET>` (regular, ~9pt)
     - `Roof-ER Storm Intelligence` (regular, ~9pt)
   - **Right:** Roof-ER seal/badge — small red roof-shape icon with "ROOF-ER" text. Vector glyph.

3. **Verification line** (full-width, light gray):
   `You can verify the authenticity of this report using report number <reportId> and the following Verification Code: <code>`
   (small italic, ~8.5pt, with verification code highlighted/underlined)

---

## Section 1 — Property Information

**Banner** (gray fill, centered title): `Property Information`

**Two-column body:**
- **Left (~35% width):** Google Static Map of the property — `maptype=roadmap`, zoom 16, ~250×200px, with the property pin centered. Show street names + road outlines. Cap at 4 MB cache.
- **Right (~65% width):**
  - `Property Address:` (bold)
  - First line: `<address line 1>` (the user-provided address)
  - Second line: `<city>, <state> <lat-or-zip-or-county>`
  - blank line
  - `Customer Info:` (red label, bold)
  - `<homeowner name>` (regular)

If `customerName` isn't provided in the request payload, show "—" or omit the customer info subsection.

---

## Section 2 — Hail Impact Details

**Banner:** `Hail Impact Details`

**4-row × 2-col table** (4 fields on each side, no header row, label-value paired):

| Left col label | Left col value | Right col label | Right col value |
|---|---|---|---|
| Date of Hail Impact: | `<dateOfLoss formatted>` | Hail Duration: | `<duration> minutes` |
| Time of Hail Impact: | `<peak event time>` | Size of Hail Detected: | `<atProperty cap value>"` |
| Storm Direction: | `<dominant heading>` | Nearby Hail Reported: | `<count> reports` |
| Storm Speed: | `<speed> mph` | Max Hail Size Reported: | `<biggestNearby cap value>"` |

- **Date of Hail Impact:** `req.dateOfLoss` formatted as `M/D/YYYY`.
- **Time of Hail Impact:** Earliest hail event begin_time on the date of loss, formatted as `h:mm A z` (e.g., `5:00 PM EDT`).
- **Storm Direction:** Compute mean azimuth from the multi-event track if available (existing wind/storm direction utility); fall back to "—".
- **Storm Speed:** `<mph>.0 mph` from track speed; fall back to "—".
- **Hail Duration:** Span between first and last hail event on the date of loss (max - min begin_time), in minutes with one decimal. Fall back to "—".
- **Size of Hail Detected:** AT-PROPERTY display value (cap algorithm + per-band ctx applied). Quarter-snapped, capped per Sterling/verified rules.
- **Nearby Hail Reported:** Count of distinct hail events within `radiusMiles` on the date of loss.
- **Max Hail Size Reported:** Biggest nearby cap value (mi3to5/biggestNearby with farBandCtx).

**Style:** Light borders, 2pt padding, label gray ~9pt, value black ~9pt bold.

---

## Section 3 — Hail Impact Narrative

**Banner:** `Hail Impact Narrative`

Justified paragraph, single block, ~9pt regular. Existing `composeStormNarrative()` already produces this — keep using it. Already gets capped values via `cappedHeadline`.

---

## Section 4 — Ground Observations - Hail

**Banner:** `Ground Observations - Hail`

**Sub-caption** (small gray italic):
`On-the-ground hail observations reported near the property located at <address> (Property)`

**Table:**
| Date / Time | Source | Hail Size | Distance from Property | Comments |
|---|---|---|---|---|

- **Source:** Show only PRIMARY-tier source label, mapped to display name:
  - `iem-lsr` / `nws-lsr` → `NOAA`
  - `ncei-storm-events` → `NOAA`
  - `mrms` / `nexrad-mrms` → `NEXRAD`
- **Hail Size:** capped display value (`displayHailInches` with per-row context), quarter-snapped, suffix `"`.
- **Distance from Property:** miles, 1 decimal, suffix ` miles`.
- **Comments:** narrative text from the underlying record (NCEI Storm Events `narrative` column, or LSR comment field).

Sort by event time descending. Limit to ~10 rows; spill to next page if needed.

**Style:** Header row gray fill, body alternating white/very-light-gray, ~8.5pt.

---

## Section 5 — Ground Observations - Wind

**Banner:** `Ground Observations - Wind`

**Sub-caption:**
`On-the-ground damaging wind observations reported near the property located at <address> (Property)`

**Table:**
| Date / Time | Source | Wind Speed | Distance from Property | Comments |
|---|---|---|---|---|

- **Wind Speed:** `<n> kts` (knots) when source is ASOS/sigmet; `<n> mph` for LSR — preserve original unit. Append unit string to value.
- Source/Distance/Comments same rules as hail table.

Sort by time descending. Limit ~5 rows. If empty: omit the section entirely (don't render an empty "(none)" row).

---

## Section 6 — Severe Weather Warnings

**Banner:** `Severe Weather Warnings`

**Intro paragraph** (small ~9pt):
`At the approximate time of the hail impact, the property located at <address> was under multiple severe weather warnings issued by the National Weather Service, as follows:`

For each warning issued by NWS that covered the property location during the date of loss (pull from `verified_hail_events` rows where `source_nws_warnings = TRUE` AND warning polygon contains the property point, OR from a fresh IEM SBW archive query):

**Warning block (per warning):**
- **Two-column layout, ~50/50:**
  - **Left:** NEXRAD radar image at the warning's effective time. Server-side: pull NEXRAD base reflectivity composite for the warning's start time (existing `getNexradTileUrl` / IEM ridge archive). PNG, ~250×180.
  - **Right:** Warning details:
    - Title (bold, ~10pt): `Severe Thunderstorm Warning issued <effective> until <expires> by NOAA Storm Events Database`
    - 2×3 grid (label-value):
      | Effective: | `<time>` | Expires: | `<time>` |
      | Hail Size: | `<size>"` | Wind Speed: | `<speed> mph` or `n/a` |
      | Urgency: | `<urgency>` | Certainty: | `<certainty>` |
- **Below the two columns** (full-width caption):
  - `NEXRAD Radar Image from <date> / <time>` (small gray, ~8pt)
  - Warning narrative/description (small ~8.5pt regular, justified)

**Page break** between warning blocks if next one won't fit cleanly.

**Implementation note:** This is the heaviest new section. NEXRAD images need server-side fetch + cache. Time-budget the fetch to 8s per warning; if it fails, leave the left column blank rather than blocking PDF generation.

---

## Section 7 — Historical Storm Activity

**Banner:** `Historical Storm Activity`

**Table:**
| Map Date* | Impact Time | Direction | Speed | Duration | At Location | Within 1mi | Within 3mi | Within 10mi |
|---|---|---|---|---|---|---|---|---|

One row per historical hail event on the date of loss within 10 mi of the property, sorted by impact time descending. Pull from `verified_hail_events` (primary-source rows only).

- **Map Date*:** `M/D/YYYY` of the storm.
- **Impact Time:** `M/D/YYYY, h:mm A z` of the row's begin_time_utc converted to ET.
- **Direction:** Cardinal heading (N/E/S/W or compass mid-points), or "—" when track unknown.
- **Speed:** mph, 1 decimal, or "—".
- **Duration:** minutes, 1 decimal, or "—".
- **At Location:** capped display when ≤0.5 mi (atProperty band), else `---`.
- **Within 1mi:** capped display from mi1to3 band (since strict bucketing puts 0.5–3 mi in mi1to3, surface as "Within 1mi"… **but the target shows "Within 1mi" populated when there's a reading in 1-mi band, distinct from At Location and Within 3mi**). Use `displayHailInches` per-band-ctx.
- **Within 3mi / Within 10mi:** mi3to5 / mi5to10 capped values.
- Show `---` for any missing band.

**Footnote (small italic, ~8pt):**
`* Map dates begin at 6:00 a.m. CST on the indicated day and end at 6:00 a.m. CST the following day.`

---

## Section 8 — Disclaimer

**Banner:** `Disclaimer`

Justified paragraph, ~8.5pt regular gray. Reuse the existing disclaimer text but rephrase the opener as the target shows:

> Roof-ER Storm Intelligence uses NEXRAD weather radar data and proprietary hail detection algorithms to generate the "Hail Impact" and "Historical Storm Activity" information included in this report. And while Roof-ER attempts to be as accurate as possible, Roof-ER makes no representations or warranties of any kind, including express or implied warranties, that the information on this report is accurate, complete, and / or free from defects. Roof-ER is not responsible for any use of this report or decisions based on the information contained in this report. This report does not constitute a professional roof inspection or engineering assessment. A licensed roofing contractor should perform a physical inspection to confirm the presence and extent of any storm damage.

Followed by **Copyright** (gray bg, centered, ~9pt):
`Copyright © <year> by Roof-ER`

---

## Things to delete / collapse from the current PDF

- ❌ Satellite hero banner (page 1) — replaced by the small property roadmap in Property Information
- ❌ "Storm Coverage at Property" tier card — replaced by Hail Impact Details table
- ❌ "Property Hail Hit History" combined table — replaced by Historical Storm Activity (different columns: Map Date / Impact Time / Direction / Speed / Duration / bands)
- ❌ Storm Summary cards (LARGEST HAIL / PEAK WIND) — info migrates into Hail Impact Details
- ❌ NEXRAD Radar + Hail Footprint Map (the wide map page) — replaced by per-warning radar imagery in Severe Weather Warnings section
- ❌ Documented Storm Reports (the wall-of-rows wind/hail table at the end) — replaced by the focused Ground Observations - Hail / - Wind tables
- ❌ Compact "Findings derived from primary federal sources..." line — keep it inside the Disclaimer block as a one-line preamble

## Things to keep / reuse

- ✓ `displayHailInches`, `bandVerification`, `computeConsensusSize`, Sterling allow-list — DO NOT TOUCH
- ✓ `composeStormNarrative` — wire into Section 3 (already gets capped values)
- ✓ `verificationByDate` Map (per-date VerificationContext) — wire into Section 7's per-band display
- ✓ `histGroups` per-band reports — wire into Section 7's row generation
- ✓ Cap algorithm imports + verifications already in place at top of `reportPdf.ts`

---

## Data wiring requirements (server-side)

1. **`fetchNceiArchiveForReport`** already pulls primary + supplemental rows. Tighten the SELECT for Sections 4/5 to PRIMARY-source rows only (`source_ncei_storm_events OR source_iem_lsr OR source_nws_warnings`) AND with non-null `narrative` for Comments column.

2. **NEW: `fetchNwsWarningsForProperty(lat, lng, date, days=2)`** — query `verified_hail_events` rows with `source_nws_warnings=TRUE` whose polygon contains the property point AND whose effective/expires straddles the date of loss. Each row → one warning block in Section 6. If the table doesn't carry SBW polygons, fall back to a fresh IEM `/sbw_history.geojson` query.

3. **NEW: `fetchNexradImageForWarning(effectiveIso, lat, lng)`** — server-side fetch a NEXRAD base reflectivity PNG centered on the property at the warning's effective time. Use IEM ridge archive (`mesonet.agron.iastate.edu/archive/data/<YYYY>/<MM>/<DD>/GIS/uscomp/n0r_<YYYYMMDD><HHMM>.png`). 8s timeout, in-memory LRU cache.

4. **NEW: `computeStormDirectionAndSpeed(events)`** — given a list of dated events with lat/lng/time, derive a dominant heading + mean speed. Existing wind/storm services may already compute this — check `server/storm/windSwathService.ts` first. If not, port from sa21.

5. **NEW: `computeHailDuration(events)`** — span from earliest to latest hail event begin_time on the date of loss, in minutes.

6. **NEW: `computeStormPeakTime(events)`** — earliest hail event begin_time on the date of loss for the "Time of Hail Impact" field.

---

## Render order summary

```
[ Header strip                               ]
[ Logo | Rep contact | Report meta | Seal    ]
[ Verification code line                     ]

[Property Information banner]
[ Map | Address + Customer Info             ]

[Hail Impact Details banner]
[ 4x2 table                                  ]

[Hail Impact Narrative banner]
[ Justified paragraph                        ]

[Ground Observations - Hail banner]
[ Caption + table                            ]

[Ground Observations - Wind banner]
[ Caption + table       (omit if empty)      ]

[Severe Weather Warnings banner]
[ Intro                                      ]
[ For each warning:                          ]
[   [Radar img] | Title + 6-cell metadata   ]
[   Caption + narrative                      ]

[Historical Storm Activity banner]
[ 9-col table + footnote                     ]

[Disclaimer banner]
[ Justified paragraph                        ]

[Copyright strip — Copyright © YYYY by Roof-ER]
```

---

## Out of scope

- Sa21 mirror (user explicitly chose to keep apps separate)
- Logo asset replacement — vector glyph in PDFKit only
- AI section rendering (currently passed in `aiAnalysis` payload — drop from the new layout; confirm with user before deleting upstream code)
- PDF accessibility / tagging — defer

---

## Verification gates

After wire-in:
1. `npm run test:display-cap` — 65/65 pass
2. Smoke 17032 Silver Charm Place / 2024-08-29 — Sterling allows up to 3.00", layout matches target
3. Smoke 17032 / 2025-07-16 — non-Sterling caps at 2.0", layout matches target
4. Smoke 112 Levenbury Pl Hamilton VA / 2025-05-16 — should look like the reference PDF (target file is for this address+date)
5. Visual diff: hold reference PDF and our output side-by-side; identify any layout drift
