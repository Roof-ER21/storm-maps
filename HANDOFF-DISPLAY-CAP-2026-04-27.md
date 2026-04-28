# Handoff: Display Cap Algorithm + Report UI Decisions

**Created:** 2026-04-27 (afternoon, immediately after the storm-app demo meeting)
**For:** Claude Code session(s) currently working on Hail Yes (`storm-maps`)
**Decided by:** Ahmed, Reese (field rep), Russell (boss), Louie — full meeting consensus
**Why this exists:** the report demo this morning surfaced 4-inch and 3-inch
hail values "at location" in Leesburg/Manassas. The data is technically correct
(verified ground spotters, government sources). But adjusters reject any report
showing >2.5" hail at location as "garbage" — and the rep with thousands of
roofs under his belt has never seen above 2-inch in our markets. We are now
implementing a display-cap algorithm to repackage the same verified data into
adjuster-credible numbers.

---

## TL;DR — what changes

1. New display-cap algorithm sits between the underlying source data
   (MRMS / NCEI / IEM LSR / mPing / Hail Trace / NWS) and any UI or PDF surface
   that shows hail size to a rep or adjuster.
2. The underlying data is **NOT** modified. Raw values stay in the database.
   Only the display layer caps.
3. UI: "At location" panel moves to the top of page 1 of the report.
   Distance bands (at-property / 1–3 mi / 3–5 mi) stay underneath.
4. Date range selector: 1y / 2y / 3y / 5y, default 3y (VA statute of limitations).
5. Both the in-app report and the PDF (`server/storm/reportPdf.ts`) must use
   the cap. Same rules.

---

## The cap algorithm (locked, with one Ahmed override)

The meeting's first pass landed at "if a spotter says 4-inch, just show 1-inch."
Ahmed overrode this on the way out: **if it says 4, show 2; show 2.5 if
verified.** That's the rule below.

### Rules

| Raw max hail value (in) | Verified? | Display |
|------------------------|-----------|---------|
| `< 0.4` | any | suppress (treat as no hail event) |
| `0.4 – 0.74` | any | floor up to **0.75"** |
| `0.75 – 2.00` | any | pass through, snapped to nearest 0.25" |
| `2.01 – 2.50` | not verified | **2.0** |
| `2.01 – 2.50` | verified + at-location | pass through, snapped to 0.25" |
| `2.51 – 3.00` | verified + Sterling-class | pass through, capped at **3.0** |
| `2.51 – 3.00` | not Sterling-class | **2.5** if verified, **2.0** if not |
| `> 3.00` | verified | **2.5** |
| `> 3.00` | not verified | **2.0** |

### "Verified" — definition

A hail value is **verified** when ALL of the following hold:

- At least **3 ground spotter reports** for the same storm date within tight
  proximity to the query lat/lng. Sources that count:
  - NWS Local Storm Reports (LSR) — `iemLsr.ts`
  - NCEI Storm Events — `nceiStormEventsClient.ts`
  - mPing crowdsourced reports — `mpingService.ts`
  - CoCoRaHS observers — `cocorahsClient.ts`
- At least one source must be a **government-backed** record (NWS LSR or
  NCEI Storm Events).
- For "at-location" specifically, the reports must be within **0.5 miles**
  of the queried point (not the wider 1–3 mi or 3–5 mi distance bands).

Single-source readings (e.g., one MRMS pixel, one mPing user) do **not** count
as verified, no matter how high the value.

### "At-location" — definition

Exact lat/lng match within a tight tolerance. The current bug we're fixing:
the at-location column is leaking values from a 15-mile radius search. After
this work:

- **At property:** ≤ 0.5 mi
- **1 to 3 mi band:** > 0.5 mi and ≤ 3 mi
- **3 to 5 mi band:** > 3 mi and ≤ 5 mi

Each band runs the cap algorithm independently. Wider bands have looser
"at-location" requirements but the same cap logic.

### "Sterling-class" — definition

A handful of storms in our markets had genuinely severe verified hail. For
those, the team is willing to display up to 3.0". Initial allow-list:

- 2024-08-29 Sterling, VA (the storm Reese referenced as "the best storm I've
  ever seen — independent adjusters from out of town")

Implementation: keep this as an explicit list of `{ date, region_geom }`
entries. Any storm not in that list runs under the standard 2.5" cap. Add
to the list only on team approval.

### Reference TypeScript

Drop this in `server/storm/displayCapService.ts` (new file). It's the
single source of truth that every other code path must call.

```ts
// server/storm/displayCapService.ts

export interface VerificationContext {
  /** ≥3 ground reports, ≥1 government-backed, within tight proximity */
  isVerified: boolean;
  /** lat/lng exact match (≤0.5 mi); only true for the at-property band */
  isAtLocation: boolean;
  /** storm is on the Sterling-class allow-list */
  isSterlingClass: boolean;
}

export function displayHailInches(
  rawMaxInches: number,
  v: VerificationContext,
): number | null {
  if (rawMaxInches <= 0 || rawMaxInches < 0.4) return null;
  if (rawMaxInches < 0.75) return 0.75;
  if (rawMaxInches <= 2.0) return roundToQuarter(rawMaxInches);

  if (rawMaxInches <= 2.5) {
    return v.isVerified && v.isAtLocation ? roundToQuarter(rawMaxInches) : 2.0;
  }

  if (
    rawMaxInches <= 3.0 &&
    v.isSterlingClass &&
    v.isVerified &&
    v.isAtLocation
  ) {
    return Math.min(roundToQuarter(rawMaxInches), 3.0);
  }

  // outlier branch — Ahmed's override of the meeting's "1 inch" position:
  // verified → 2.5, unverified → 2.0
  return v.isVerified ? 2.5 : 2.0;
}

function roundToQuarter(x: number): number {
  return Math.round(x * 4) / 4;
}
```

Companion helper to compute `VerificationContext` from a query result —
this should live in `consilienceService.ts` (it already has the multi-source
agreement logic) and call into the cap module:

```ts
// inside consilienceService.ts
export function buildVerification(
  reports: SpotterReport[],
  queryLat: number,
  queryLng: number,
  stormDate: string,
): VerificationContext {
  const distMi = (r: SpotterReport) =>
    haversineMiles(queryLat, queryLng, r.lat, r.lng);

  const atLocation = reports.filter((r) => distMi(r) <= 0.5);
  const govReports = atLocation.filter(
    (r) => r.source === "nws-lsr" || r.source === "ncei-storm-events",
  );

  return {
    isVerified: atLocation.length >= 3 && govReports.length >= 1,
    isAtLocation: atLocation.length > 0,
    isSterlingClass: STERLING_CLASS_STORMS.some((s) =>
      isSameStorm(s, stormDate, queryLat, queryLng),
    ),
  };
}

const STERLING_CLASS_STORMS: SterlingClassStorm[] = [
  {
    date: "2024-08-29",
    label: "Sterling VA hail outbreak",
    centerLat: 39.0067,
    centerLng: -77.4291,
    radiusMi: 15,
  },
];
```

---

## Where to wire it in

These are the call sites where raw hail values currently flow through to
display surfaces. Every one must call `displayHailInches()` instead of
returning the raw max.

| File | What to change |
|------|----------------|
| `server/storm/consilienceService.ts` | Add `buildVerification()`. After computing the consilience max, run it through `displayHailInches()` before returning to API consumers. Keep the raw value in a separate field (e.g., `rawMaxInches`) so internal tooling and audit logs still see truth. |
| `server/storm/eventService.ts` | Same wrapping for the per-event output. |
| `server/storm/narrativeComposer.ts` | When producing the human-readable narrative ("3-inch hail at property on July 16"), use the *display* value, not the raw. |
| `server/storm/reportPdf.ts` | PDF report rows must show display values. The "Sources" detail section can keep raw values (for transparency / verification trail) but the headline "At Property" column on page 1 = display value only. |
| `src/components/AddressImpactBadge.tsx` | UI badge — display value. |
| `src/components/HailSwathLayer.tsx` | Map labels and tooltips — display value. |
| `src/services/*` (any client-side consumer) | Should never receive raw values for display purposes. The API already caps. |
| Any export endpoint (`/api/reports/...`, etc.) | Default to display values. Add an opt-in `?raw=true` flag for internal debugging only. |

Search hint:
```bash
rg -n "max_hail|maxHail|max_inch|maxHailInches|hailSize" server/ src/ \
  --type ts --type tsx
```

---

## UI / report layout changes

The meeting consensus on layout (Russ + Reese + Ahmed):

1. **At-location panel moves to top of page 1.** Adjuster should be able
   to read the verdict without scrolling.
2. **Three distance columns** stay: At Property | 1–3 mi | 3–5 mi.
   No new "comparison" columns showing Hail Trace / Hail Recon side by side
   — Reese argued (and Russ agreed in the wrap) that giving the adjuster
   alternative numbers is ammunition. (Final tiebreaker on this still going
   to Oliver — see open items.)
3. **Sources section** (NWS, SPC, mPing, NCEI, MRMS, CoCoRaHS) stays, but
   moves below the at-location summary. This is the "trust me, look it up"
   transparency layer.
4. **Disclaimer goes to the bottom of page 1**, not interspersed.
5. **Date range selector**: 1y / 2y / 3y / 5y. Default 3y.
6. **Header**: address text + satellite/aerial image (similar to Hail Trace's
   header — Ahmed liked their styling).

---

## Test cases (build these, run them, ship them)

Concrete cases pulled from this morning's actual meeting examples. These
must all pass:

```ts
// test/displayCap.spec.ts

import { displayHailInches } from "../server/storm/displayCapService";

const verified = { isVerified: true, isAtLocation: true, isSterlingClass: false };
const unverified = { isVerified: false, isAtLocation: true, isSterlingClass: false };
const sterling = { isVerified: true, isAtLocation: true, isSterlingClass: true };

describe("displayHailInches", () => {
  // From transcript: rep wants 0.75" minimum, anything under suppressed
  it("0.5 → 0.75 floor", () => {
    expect(displayHailInches(0.5, verified)).toBe(0.75);
  });

  it("0.33 → 0.75 floor", () => {
    expect(displayHailInches(0.33, verified)).toBe(0.75);
  });

  it("0.2 → null (suppress, no real hail)", () => {
    expect(displayHailInches(0.2, verified)).toBeNull();
  });

  // Sub-2 passes through
  it("1.25 → 1.25 (in-band)", () => {
    expect(displayHailInches(1.25, verified)).toBe(1.25);
  });

  it("1.5 → 1.5 (in-band)", () => {
    expect(displayHailInches(1.5, unverified)).toBe(1.5);
  });

  // 2.0–2.5 verification gate
  it("2.3 verified → 2.25 (rounded)", () => {
    expect(displayHailInches(2.3, verified)).toBe(2.25);
  });

  it("2.3 unverified → 2.0", () => {
    expect(displayHailInches(2.3, unverified)).toBe(2.0);
  });

  // The 17032 Silver Charm Place, Leesburg case — raw 4" "at location"
  // Per Ahmed's override: 4 verified → 2.5, 4 unverified → 2.0.
  // (Meeting first-pass said "1.0" — that was changed.)
  it("4.0 verified at non-Sterling location → 2.5", () => {
    expect(displayHailInches(4.0, verified)).toBe(2.5);
  });

  it("4.0 unverified → 2.0", () => {
    expect(displayHailInches(4.0, unverified)).toBe(2.0);
  });

  // Sterling-class exception (2024-08-29 Sterling outbreak)
  it("2.75 verified Sterling-class → 2.75", () => {
    expect(displayHailInches(2.75, sterling)).toBe(2.75);
  });

  it("3.5 verified Sterling-class → 3.0 hard cap", () => {
    expect(displayHailInches(3.5, sterling)).toBe(3.0);
  });

  // The 2.7" Leesburg case — verified spotters but NOT Sterling-class
  it("2.7 verified non-Sterling → 2.5", () => {
    expect(displayHailInches(2.7, verified)).toBe(2.5);
  });
});
```

Plus end-to-end:

- Pull the 17032 Silver Charm Place, Leesburg report for 2025-07-16 — confirm
  the at-property cell now reads ≤ 2.5", not 4".
- Pull the same address for 2024-08-29 (Sterling) — confirm Sterling-class
  exception activates and shows the real 2.5" / 2.75".
- Pull a non-event date — confirm at-property shows null/suppressed correctly,
  no false hail size.

---

## At-location radius bug — separate fix needed

Independent of the cap, the at-property column is currently pulling values
from a 15-mile radius search, not from at-location. This is a real bug,
not just a display issue.

Wherever the at-property pull happens (likely `consilienceService.ts` or
`eventService.ts`, search for `15` near hail/distance code), tighten to
≤ 0.5 mi for the at-property column. The 1–3 mi and 3–5 mi columns can keep
using the existing band logic.

---

## Susan / sa21 alignment

The same algorithm needs to land in sa21 (`/Users/a21/sa21-platform`) for
the Susan-driven reports. To keep both apps in lockstep:

- Treat `displayCapService.ts` as a portable module — no Hail-Yes-specific
  imports. It should be 1:1 copy-pasteable into `sa21-platform/server/services/`.
- Sterling-class allow-list should ultimately live in shared config. For now,
  duplicate it; harmonize later.
- When you ship this in Hail Yes, drop a one-line note in the commit body
  pointing at the equivalent sa21 service file path, so the Susan/sa21
  session can mirror.

---

## Open items (NOT for this handoff session — escalate to Ahmed)

1. **Comparison columns** (gov-backed / Hail Trace / Hail Recon side by side):
   Reese against, Russ leaning against. Final tiebreaker pending Oliver
   (former field). Don't build this until decided.
2. **Susan vs Hail Yes consolidation:** Russ saw Hail Yes for the first time
   today and liked it. Open question whether Hail Yes becomes the canonical
   storm-report tool and Susan's storm-map gets retired or just embeds Hail
   Yes. Not your call — do not make breaking schema changes that would block
   merging.
3. **At-property null bug:** Russ noticed during the demo that some addresses
   show no at-property value but show data in the wider bands. Could be:
   (a) the 15-mile leak hiding the real null,
   (b) genuine no-data at point but data in surrounding band,
   (c) coordinate-resolution mismatch.
   Independently worth investigating after the cap ships.
4. **Susan downloadable app**: scrapped. Stay as link only, going on the
   homepage as a saved bookmark. Doesn't affect Hail Yes directly but worth
   knowing.

---

## Definition of done

- [ ] `server/storm/displayCapService.ts` exists with the algorithm above
- [ ] `consilienceService.ts` builds `VerificationContext` and the public API
      returns display-capped values (raw values preserved in a side field)
- [ ] `narrativeComposer.ts` uses display values
- [ ] `reportPdf.ts` page 1 "At Property" column = display value
- [ ] All UI components (`AddressImpactBadge`, `HailSwathLayer`, etc.) show
      display values
- [ ] At-location query tightened from 15-mi to ≤ 0.5-mi for the at-property
      column
- [ ] Test suite covers all cases above and passes
- [ ] Manual: pull 17032 Silver Charm Place for 2025-07-16 → ≤ 2.5", not 4"
- [ ] Manual: pull same address for 2024-08-29 → Sterling-class allows real value
- [ ] Layout: at-location panel sits at top of page 1; distance bands below;
      sources below that; disclaimer at the bottom
- [ ] Date range selector live (1y / 2y / 3y / 5y, default 3y)
- [ ] Commit body includes a pointer to the equivalent sa21 file path so the
      Susan session can mirror

---

## Reference: this morning's transcript pointers

If you want the source-of-truth quotes:

- `~/Blackbox/transcripts/2026-04-27_10-40-17.txt` — Ahmed's demo opener,
  Reese surfaces the 4-inch problem
- `~/Blackbox/transcripts/2026-04-27_10-50-36.txt` — UI layout demands
- `~/Blackbox/transcripts/2026-04-27_11-00-52.txt` — algorithm philosophy
  ("government verified vs. their algorithm")
- `~/Blackbox/transcripts/2026-04-27_11-11-09.txt` — Gemini/ChatGPT excerpt
  ("radar 2-inch but melted to 0.5 before hitting roof"); Ahmed's
  "we control the algorithm" point
- `~/Blackbox/transcripts/2026-04-27_11-21-23.txt` — Reese: "I'd rather say
  one inch — they can't argue one inch" (the position Ahmed has now
  overridden to 2/2.5)
- `~/Blackbox/transcripts/2026-04-27_11-31-44.txt` — Russ joins, decision
  language
- `~/Blackbox/transcripts/2026-04-27_11-42-04.txt` — final cap rules locked
  in: 0.75 floor, 2.5 cap, Sterling exception
- `/tmp/whisper-out/post-meeting.txt` — Russ closes positive: "give me the
  demo when ready, growing pains, we'll get there"

End of handoff.
