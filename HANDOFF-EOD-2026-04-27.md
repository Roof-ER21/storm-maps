# Hail Yes — End of Day Handoff, 2026-04-27

**State of the world:** All cap-algorithm + addendum work shipped. Live in prod at `hailyes.up.railway.app`. Final HEAD before this handoff: `main @ 55f3516` + the iem-vtec silencer commit landing with this doc.

**One open visual issue** as of last check from Ahmed: "no swath and the only ones showing are the uglier ones." Diagnostic notes at the end of this doc.

---

## What shipped today (sequence)

### Morning handoff (`HANDOFF-DISPLAY-CAP-2026-04-27.md`)
1. **`server/storm/displayCapService.ts`** — cap algorithm, Sterling-class allow-list (2024-08-29 outbreak, 20mi from Sterling VA), consensus override at [0.75, 2.6) when ≥2 distinct sources agree, ¼" snap, 0.25" suppress floor.
2. **`server/storm/verificationService.ts`** — bulk SQL pulls verification context per (lat, lng, dates).
3. **postgres.js v3 date[] bind bug fix** — `ANY(${dates}::date[])` was silently failing for weeks. Switched to `event_date::text = ANY(${strs})`. Affected `verificationService.buildVerificationBulk` AND `index.fetchGroundReportUpgrades`. See `feedback_postgres-js-date-array.md`.
4. **PDF satellite hero banner** (Hail Trace–style) + per-band 4-col → 3-col (5–10 mi dropped).
5. **3Y date range default** (VA statute), 1Y/2Y/3Y/5Y selector.
6. **Rate limit 300 → 2000/15min** (reps tripping ceiling on normal browsing → cascading 429/502s).
7. **Lead sync timestamp coercion** — `/api/sync/leads` was crashing per-lead because Drizzle PgTimestamp called `.toISOString()` on string inputs from the JSON body.
8. **Mobile UX fixes** — dates panel scrolls (map h-[55vh]), single Sat/Map button, no-op map clicks, MRMS Hourly scrubber removed.
9. **sa21 mirror** — `displayCapService.ts` (1:1) + `verificationService.ts` (Pool.query rewrite) committed to `/Users/a21/gemini-field-assistant @ 643852d`. NOT WIRED — files are in place, no imports yet. **User explicitly chose to keep sa21 separate going forward; do not auto-wire.**

### Afternoon addendum (`HANDOFF-AFTERNOON-ADDENDUM-2026-04-27.md`)
10. **`server/storm/sourceTier.ts`** — `classifySource()` + `PRIMARY_SOURCES` + `GOV_OBSERVER_SOURCES`.
    - PRIMARY (drives display): `mrms`, `nexrad-mrms`, `iem-lsr` (= NWS LSR via IEM mirror), `nws-lsr`, `ncei-storm-events`, `nws-warnings`.
    - SUPPLEMENTAL (transparency only): `mping`, `cocorahs`, `hailtrace`, `ncei-swdi`, `spc`, `synoptic`, `other`.
    - GOV_OBSERVER (verification gate): `iem-lsr`, `nws-lsr`, `ncei-storm-events`. MRMS is primary for display but NOT a gov observer (algorithmic).
11. **Strict per-band bucketing** — atProperty ≤0.5 mi / mi1to3 0.5–3 mi / mi3to5 3–5 mi / mi5to10 5–10 mi (filter only). No spillage.
12. **Per-band VerificationContext** — each column runs its own cap with its own band's verification (≥3 primary + ≥1 gov-observer in band). `bandVerification()` extracted to `displayCapService.ts` as the shared helper.
13. **`buildBandedVerificationBulk()`** in `verificationService.ts` — single SQL pulls primary reports out to ~5.5 mi, JS-side bucketing returns per-band ctx per date. Wired into `/api/hail/mrms-impact` so AddressImpactBadge UI matches PDF behavior.
14. **SPC dropped from `hailFallbackService`** swath collection (was the polygon-y fragmentation source per Ahmed's "ugly polygons" feedback).
15. **Verification SQL tightened** to count primary sources only (drops swdi/mping/spc from the `≥3 ground reports within 0.5 mi` count).

### Late-afternoon polish
16. **PDF Multi-Source Storm Corroboration block REMOVED** — the "X/Y independent sources · Quadruple Verified" stamp + "Confirmed by: SPC · NWS · NCEI · ..." line was the Hail Trace/Hail Recon/us comparison Ahmed wanted nixed.
17. **Verbose Data Sources & Methodology** section removed; compact one-line attribution above disclaimer.
18. **Storm Summary scope clarified** — "LARGEST HAIL (DAY)" → "STORM PEAK (AREA)" + "within X mi" sub-label so it doesn't read as if it applied to the property.
19. **Tier card ↔ hit-history dol row sync** — propertyImpact.bands (MRMS) now sync into the date-of-loss histRow's per-band primary reports as synthetic mrms entries. They were showing different numbers for the SAME DATE before (tier card from MRMS edge, hit-history from ground reports only).
20. **`≥` → `>=`** (PDFKit Helvetica WinAnsi can't render U+2265).
21. **AddressImpactBadge UI** — 4-band → 3-band, At Property sub-label "0–1 mi" → "≤0.5 mi" (matches strict bucketing).
22. **Google HeatmapLayer ripped out** — Google deprecated May 2025, removal May 2026. Was the source of the fuzzy orange-purple blobs in screenshots that competed with the clean MRMS vector polygons. `visualization` library dropped from APIProvider too.
23. **Storm map MRMS swath fetch widened** — was 25mi-from-property bbox showing 1-feature/8-polygons; now 100mi anchor + event bounds showing 8-features/254-polygons across 8 size bands. Decoupled from `searchRadiusMiles` (which still drives property-history bands). `mapBounds` intentionally NOT in deps to prevent zoom/pan refetch (was making swaths disappear during cold-cache GRIB2 decode).
24. **Log noise silencers** — postgres NOTICEs (boot), `[swdi] HTTP 500`, `[push-fanout] NWS fetch failed`, `[synoptic] response_code=403`, `[synoptic] fetch failed`, `[iem-vtec] fetch failed`, `[mrmsApi] metadata` (5s→25s timeout + once-per-process). All once-per-process / once-per-status-code.

### Final commit count
~28 commits across the day, all on `main`, all in prod.

### Tests
`npm run test:display-cap` — 65/65 passing. Run before any future change to the cap or sourceTier.

---

## Open / unresolved

### 🟡 "no swath and the only ones showing are the uglier ones" (4:47 PM check-in, last user message)

User's symptom: looking at the storm map for some date, the proper MRMS contour polygons aren't rendering, and what IS showing looks ugly (likely the per-report buffer-circle fallback from `hailFallbackService`).

**Where to look:**
1. **`src/components/StormMap.tsx`** — `swathsToRender` useMemo at ~line 946. Priority chain:
   - `liveSwaths` (live now-cast) if `liveNowCast` toggle on
   - `vectorSwaths` (MRMS GRIB2 contours via `/api/hail/mrms-vector`) if non-empty — **this is the path that should normally win**
   - `polygonSwathsForSelectedDate` (NHP feature server) fallback
2. **`server/storm/mrmsService.ts:buildMrmsVectorPolygons`** — pulls from L2 cache (Postgres `swath_cache` table) first; if cache hit has `metadata.source === 'mrms-vector'`, returns it; else fetches GRIB2 and decodes via `mrmsContour.buildMrmsVectorCollection`.
3. **`server/storm/hailFallbackService.ts:buildHailFallbackCollection`** — fires when MRMS GRIB2 isn't available. Uses IEM LSR points (SPC was dropped). Each report becomes a buffer circle per band → fragmented polygons. **This is what "the ugly ones" probably are.**
4. **`server/storm/reportPdf.ts:567`** — PDF builder explicitly falls through from `buildMrmsVectorPolygons` to `buildHailFallbackCollection` if vector returns null/empty. Same pattern likely in the live map cache-write path.

**Diagnostic steps:**
```bash
# Hit the vector endpoint directly for the date in question
curl -sS "https://hailyes.up.railway.app/api/hail/mrms-vector?date=YYYY-MM-DD&north=N&south=S&east=E&west=W" \
  | jq '.metadata.source, (.features | length), (.features | map(.properties.label) | unique)'
# If metadata.source = "in-repo-fallback" → the GRIB2 path failed and the user is seeing fallback polygons
# If features = 0 → no hail data for that date in that bbox

# Check the swath_cache table for what's stored
railway run --service "Hail Yes!" -- node -e '
const { sql } = await import("./server/db.js");
const rows = await sql`SELECT date, source, metadata->>"source" AS payload_source, feature_count, max_value
                       FROM swath_cache
                       WHERE date = '2024-04-15'
                       ORDER BY created_at DESC LIMIT 10`;
console.log(rows);
'
```

If the cache is poisoned with fallback payloads (origin = `in-repo-fallback`), purging that row + re-fetching MRMS GRIB2 should restore the proper vector polygons.

**Possible quick fixes (not yet attempted):**
- Bypass the in-repo-fallback path on the live map. The PDF tolerates it; the live map looks worse with it. Set `swathsToRender` to return `[]` instead of fallback polygons when `vectorSwaths.length === 0` AND `polygonSwathsForSelectedDate.length === 0`. Empty is better than ugly.
- Bump the GRIB2 fetch timeout in `server/storm/mrmsFetch.ts` (cold-cache decode of a 100mi window can push past current limit).
- Verify the GRIB2 source URL is reachable for the user's specific date — `noaaport-fallback` URLs change for pre-Sept 2022 dates (`MRMS_*` vs `MESH_*` filename prefix; the legacy fallback is in `mrmsFetch.ts`).

### 🟡 Mobile UI items from the afternoon transcript
Tagged sa21-only by the addendum. Storm-maps got the pin-clears-date / button-rail-cleanup / dates-scroll fixes already. Don't auto-port to sa21.

### 🟡 Per-date-impact endpoint per-band ctx
Still uses property-level VerificationContext. JSON consumers (storm-list UI) only render at-property, so cosmetically invisible. Rewire would be parallel to what was done in `/api/hail/mrms-impact`. Low priority.

---

## Things deliberately kept around

- `consilience` is still computed (warmed in the prewarm scheduler). Dropped from the PDF visible surface but the data flows backend-side as part of the cap algorithm's signal pool.
- `STERLING_CLASS_STORMS` allow-list is one entry (`2024-08-29 Sterling VA, 20mi`). Add new entries by appending — team-approval gated. Each entry is `{date, label, centerLat, centerLng, radiusMi}`.
- `searchRadiusMiles` controls the property-history distance bands and storm-date filter. Decoupled from the swath fetch bbox (which is a fixed 100mi anchor). Don't recombine these.
- `mapBounds` is intentionally NOT in `historicalMrmsParams` deps. Adding it back will cause the swath polygons to disappear on every zoom/pan during cold-cache GRIB2 decode.

---

## Memories saved this session

- `feedback_postgres-js-date-array.md` — `ANY(${dates}::date[])` silently fails; use `event_date::text = ANY(${strs})`.
- `feedback_storm-maps-tsc-noemit-noop.md` — Root tsconfig has `files: []`; `tsc --noEmit` is a no-op. Run `npm run build` (or `tsc -b`) before pushing.
- `storm-maps-display-cap-apr27.md` — Project memory of the cap algorithm work + open items.

---

## Test commands

```bash
# Unit tests (cap + sourceTier + Sterling + consensus)
npm run test:display-cap

# Local typecheck
npx tsc -b

# Full local build (catches JSX parse errors that --noEmit misses)
npm run build

# Smoke a PDF
curl -sS -X POST https://hailyes.up.railway.app/api/hail/storm-report-pdf \
  -H 'Content-Type: application/json' \
  -d '{"address":"17032 Silver Charm Place, Leesburg, VA 20176","lat":39.0717,"lng":-77.5847,"dateOfLoss":"2024-08-29","radiusMiles":25,"company":{"name":"Roof-ER"},"rep":{"name":"Smoke"}}' \
  --max-time 90 -o /tmp/pdf.bin -w "%{http_code} %{size_download}\n"
pdftotext /tmp/pdf.bin - | grep -E "DIRECT HIT|NEAR MISS|AREA IMPACT"

# Smoke the JSON
curl -sS -X POST https://hailyes.up.railway.app/api/hail/per-date-impact \
  -H 'Content-Type: application/json' \
  -d '{"lat":39.0717,"lng":-77.5847,"dates":["2024-08-29"],"radiusMiles":25}' | jq

# Vector polygon count for a date+bbox
curl -sS "https://hailyes.up.railway.app/api/hail/mrms-vector?date=2024-04-15&north=40.35&south=37.45&east=-75.55&west=-78.85" \
  | jq '{source: .metadata.source, count: (.features | length), bands: (.features | map(.properties.label) | unique)}'
```

---

## Smoke results from final test (4:30 PM)

| Test | Result |
|---|---|
| Sterling 8/29/2024 PDF (17032 Silver Charm Place) | 3-page, hail tokens up to 3.00" (Sterling exception working), no 4+ ✓ |
| Non-Sterling 7/16/2025 PDF (same address) | 5-page, max token 2.00", no 3+ ✓ |
| April 15 PDF (same address) | 3-page, max token 2.00" ✓ |
| `/api/hail/mrms-impact` per-band cap | raw mi1to3 0.5 → display 0.75 (floor applied) ✓ |
| Sources block removed | "Data Sources & Methodology" gone, compact attribution present ✓ |
| Multi-Source Corroboration | gone ✓ |
| `>=58 mph` glyph | renders correctly (was garbled `≥`) ✓ |
| Hit history May 16 row | now matches tier card (3–5 mi: 0.75") ✓ |
| Polygon count 100mi bbox vs 25mi | 254 polys vs 8 polys (31×) ✓ |
| Rate limit | 2000/15min ✓ |
| Recent log errors | 0 (only suppressed-after-first warnings remain) ✓ |

---

## Final HEAD

After this handoff commit lands: `main @ <next-commit>` (handoff + iem-vtec silencer).

Branch: `main`. No open PRs. sa21 mirror at `gemini-field-assistant @ 643852d` (separate repo).
