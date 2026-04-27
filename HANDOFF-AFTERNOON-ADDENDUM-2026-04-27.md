# Handoff Addendum: Column Bucketing + Source Filtering (afternoon session)

**Created:** 2026-04-27 (afternoon, ~14:22 ET)
**For:** Claude Code session(s) on **Hail Yes** = `/Users/a21/Desktop/storm-maps/`
**Stacks on:** `HANDOFF-DISPLAY-CAP-2026-04-27.md` (this morning)
**Sister addendum (DO NOT diverge from):**
`/Users/a21/gemini-field-assistant/HANDOFF-AFTERNOON-ADDENDUM-2026-04-27.md`

This is a **supplemental** handoff. Do the morning handoff (display cap +
verification + Sterling-class) FIRST. Then layer this on top.

---

## What the afternoon session uncovered

After the morning meeting wrapped, Ahmed continued running the report tool
side-by-side with reps and discovered three more issues that need to ship
together with the cap. From the post-meeting transcripts:

1. **Column bucketing is broken.** The "At Property / 1–3 mi / 3–5 mi"
   columns aren't strict distance bands — the at-property column is
   surfacing values from anywhere in 0–4.9 mi.
2. **Too many sources are flooding the report.** NCEI / SPC / IEM LSR /
   random KLX-class radar stations / one-off Hailtrace spotters are
   producing the 4-inch outliers. Adjusters don't recognize most of these.
3. **Polygon rendering went ugly.** The vector swaths look "polygon-y" /
   "finicky" — same root cause as #2 (over-imported data).

All three connect: the report is showing data that shouldn't be primary.
The cap algorithm in the morning handoff partially handles outliers via
the verification rule, but the cleaner fix is to **not let those
single-source non-primary readings drive the display in the first place**.

---

## Issue 1 — Strict column bucketing

### Current (broken) behavior

Per Ahmed live-debugging at the report:

> "This 'At Property' is just showing what the largest one was within five
> miles. This is within five miles, but it's actually at property... If
> this 2 showed up at 1.1 instead of less than 0.9, that would be here and
> here. That's way too confusing."

Translation: a value found at 0.6 mi spills into the "At Property"
column even though "At Property" should mean ≤ 0.5 mi. Each column is
not strictly bucketed.

### Required behavior

Each column gets ONLY the values that fell within its own distance band.
No spillage from neighboring bands. No "max of everything 0–5 mi" leaking
into the at-property cell.

| Column header | Strict band |
|---|---|
| **At Property** | `dist ≤ 0.5 mi` ONLY |
| **1 to 3 mi** | `0.5 < dist ≤ 3 mi` ONLY |
| **3 to 5 mi** | `3 < dist ≤ 5 mi` ONLY |

If no reports fell in a band, that column shows null/blank — DO NOT pull
in a value from a neighboring band as a fallback.

### Implementation

In `server/storm/consilienceService.ts` (or wherever the per-column
aggregation happens):

```ts
// Don't do this:
//   const reportsForAtProperty = reports.filter(r => distMi(r) <= 5);  // ❌ leak
//
// Do this:
const atProperty = reports.filter((r) => distMi(r) <= 0.5);
const oneToThree = reports.filter(
  (r) => distMi(r) > 0.5 && distMi(r) <= 3,
);
const threeToFive = reports.filter(
  (r) => distMi(r) > 3 && distMi(r) <= 5,
);
```

Then run the cap algorithm **independently per column**:

```ts
import {
  displayHailInches,
  buildVerification,
} from "./displayCapService.js";

const atPropertyDisplay = atProperty.length === 0
  ? null
  : displayHailInches(
      Math.max(...atProperty.map((r) => r.inches)),
      buildVerification(atProperty, lat, lng, stormDate),
    );
```

Each column runs its own `buildVerification()` over its own reports —
which means a column with only 1 report (e.g., a single mPing in the
3–5 mi band) will be correctly marked unverified and capped at 2.0".

### Test cases (extend the morning suite)

```ts
describe("strict column bucketing", () => {
  // 4-inch report at 0.6 mi must NOT appear in At Property column
  it("4 at 0.6 mi → at-property null, 1-3 column = capped value", () => {
    const reports = [{ source: "nws-lsr", lat: 38.85, lng: -77.30, inches: 4.0, date: "2025-07-16" }];
    const result = bucketReports(reports, 38.86, -77.30); // ~0.6 mi away
    expect(result.atProperty).toBeNull();
    expect(result.oneToThree).toBe(2.0); // single source = unverified = 2.0 cap
  });

  // 2.5 verified at-location must show real value at-property only
  it("2.5 verified at 0.2 mi → at-property = 2.5, others null", () => {
    const reports = manyVerifiedReportsAt(38.85, -77.30, 2.5); // 3+ gov reports
    const result = bucketReports(reports, 38.85, -77.30);
    expect(result.atProperty).toBe(2.5);
    expect(result.oneToThree).toBeNull();
    expect(result.threeToFive).toBeNull();
  });

  // No spillage: 1.5 at 4.5 mi shows ONLY in 3-5 column
  it("1.5 at 4.5 mi → only 3-5 column populated", () => {
    const result = bucketReports(
      [{ source: "nws-lsr", lat: 38.79, lng: -77.30, inches: 1.5, date: "2025-07-16" }],
      38.85, -77.30,
    );
    expect(result.atProperty).toBeNull();
    expect(result.oneToThree).toBeNull();
    expect(result.threeToFive).toBe(1.5);
  });
});
```

---

## Issue 2 — Source filtering (primary vs supplemental)

### What Ahmed said (afternoon transcript, 12:44)

> "You need to have it back to just NEXRAD and NWS. Because you have all
> this other KLX, W. Like no one uses that. Insurance company won't
> recognize that."
>
> "Insurance companies technically NWS probably isn't, but it's easier to
> get them to because it's called National Weather Service... Everything
> else can go. Nothing else is accepted by insurance companies."
>
> "I think you got too scared about that one storm not showing up that
> you over-flooded it with the one random report from Hailtrace."

### Required behavior

Define two source tiers:

**PRIMARY (drives display):**
- NEXRAD MRMS — `mrmsService.ts`, `mrmsFetch.ts`, `mrmsRaster.ts`
- NWS Local Storm Reports — `nwsAlerts.ts`
- (NCEI Storm Events stays primary too — it's government-backed and feeds
  the verification flag)

**SUPPLEMENTAL (ingested, can appear in "Sources" detail section, but
NEVER drives the headline at-property/1-3/3-5 cells):**
- IEM LSR (`iemLsr.ts`, `iemHailReports.ts`)
- IEM VTEC (`iemVtecClient.ts`)
- mPing (`mpingClient.ts`, `mpingService.ts`)
- CoCoRaHS (`cocorahsClient.ts`)
- Hailtrace (`hailtraceClient.ts`)
- NCEI NX3 MDA (`nceiNx3MdaClient.ts`)
- NCEI SWDI (`ncerSwdiClient.ts`)
- Any non-NEXRAD radar like KLX, WSR-IDs not in the official MRMS feed

### Implementation

Add a source-tier classification at the data layer, then pass it through
to the bucketing/cap logic:

```ts
// server/storm/sourceTier.ts (new file)

export type SourceTier = "primary" | "supplemental";

const PRIMARY_SOURCES = new Set([
  "mrms",
  "nexrad-mrms",
  "nws-lsr",
  "ncei-storm-events",
]);

export function classifySource(source: string): SourceTier {
  return PRIMARY_SOURCES.has(source) ? "primary" : "supplemental";
}
```

Then in `consilienceService.ts`:

```ts
const primaryReports = allReports.filter(
  (r) => classifySource(r.source) === "primary",
);

// Headline display values (at-property, 1-3, 3-5) come from PRIMARY ONLY
const atPropertyDisplay = bucketAndCap(primaryReports, ...);

// Supplemental sources still appear in the Sources detail section for
// transparency — adjusters can see we cross-checked them — but they don't
// move the headline number.
const sourcesDetail = allReports.map((r) => ({
  ...r,
  isPrimary: classifySource(r.source) === "primary",
}));
```

### Verification rule update

The morning handoff's "≥1 government-backed source" rule now means
specifically: **NWS LSR or NCEI Storm Events**. NEXRAD MRMS pixel data
counts as primary for display but does NOT count toward the "government-
backed corroboration" half of the verification gate (it's algorithmic, not
a human-observer report).

So `buildVerification()` becomes:

```ts
return {
  isVerified:
    atLocationReports.filter((r) => classifySource(r.source) === "primary").length >= 3 &&
    atLocationReports.some((r) => r.source === "nws-lsr" || r.source === "ncei-storm-events"),
  isAtLocation: atLocationReports.length > 0,
  isSterlingClass: isSterlingClass(stormDate, queryLat, queryLng),
};
```

Single-source readings — even if from a primary source — never count as
verified. Need ≥3 primary-source reports + ≥1 government-observer source.

---

## Issue 3 — Polygon swath render quality

### What Ahmed said (afternoon transcript, 13:04)

> "The rebound spots, they look more natural… they don't do that, they
> draw theirs. That's why theirs gets more in the background and more.
> You just let it load for a little before you do this and once in the
> PDF, if some reason… how'd you get it to look like a storm before, like
> they have a constant or even happy to have a becoming interested
> either… I honestly think it's because you imported all these random
> data that we didn't need."

Translation: the swath polygons used to render as smooth, storm-shaped
polygons. After the data import additions, they now render as a "polygon-y
finicky" mess of small fragments. Visual quality regressed.

### Required behavior

Apply the **primary-source filter** (Issue 2) to swath rendering as well.
The swath layer should be drawn from MRMS contours + NWS observation
hulls, NOT from every single supplemental data point getting its own
mini-polygon.

### Implementation

Files to look at:
- `server/storm/mrmsContour.ts` — this is the canonical swath generator,
  should be the primary input
- `server/storm/mrmsRaster.ts` — raster → polygon conversion
- `src/components/HailSwathLayer.tsx` — UI rendering layer

If the layer is currently merging in supplemental sources at render time,
filter them out:

```ts
// In whichever code feeds HailSwathLayer:
const swathInput = sources.filter(
  (s) => classifySource(s.type) === "primary",
);
```

### Visual smoke test

1. Load the April 15 (or any recent storm) before the change → screenshot
2. Apply the source filter → reload
3. Visual diff: polygons should be smoother, fewer small fragments,
   look more like a "storm shape" than scattered pixels

---

## Order of operations (please ship together)

The cleanest single PR ordering:

1. **Day 1 — Cap module** (morning handoff): create
   `server/storm/displayCapService.ts`, `buildVerification()`, Sterling
   allow-list, unit tests pass.
2. **Day 1 — Source tiering**: create `server/storm/sourceTier.ts`, add
   the `classifySource()` helper, update `buildVerification()` to require
   ≥3 primary + ≥1 government-observer.
3. **Day 1 — Strict column bucketing** in `consilienceService.ts` (or
   wherever per-column logic lives). Each column independent. Cap runs
   per-column.
4. **Day 1 — Wire into adjuster surfaces**: PDF (`reportPdf.ts`),
   narrative (`narrativeComposer.ts`), UI badges. All show display
   values from strict-bucketed primary-only data.
5. **Day 1 — Swath layer filter**: pipe the primary-source filter into
   `mrmsContour.ts` / `HailSwathLayer.tsx` so polygons clean up.
6. **Day 1 verification**:
   - Re-pull 17032 Silver Charm Place 2025-07-16 → at-property cell ≤ 2.5"
   - Same address 2024-08-29 → Sterling-class allows real value, no fragmentation
   - April 15 swath visual → smooth, no random-fragment look
   - 1-3 mi and 3-5 mi columns no longer leak each other's values

---

## Open items deliberately deferred (still — same list as morning)

- Comparison columns (gov / Hail Trace / Hail Recon) — Oliver tiebreaker
- Susan vs Hail Yes consolidation — Russ + Ahmed
- Mobile-UI overhaul (separate huge thread, see sa21 sister handoff
  — these are sa21-specific, but anything you find in shared component
  code that affects mobile may need to be flagged)
- At-property null inconsistency Russ noticed earlier — investigate
  AFTER bucketing fix lands, since strict bucketing may resolve it

---

## Definition of done (additions to the morning handoff's checklist)

- [ ] `server/storm/sourceTier.ts` exists with primary/supplemental
      classification
- [ ] Bucketing in `consilienceService.ts` is strict per-band, no spillage
- [ ] Cap runs per-column; each column gets its own
      `VerificationContext`
- [ ] Headline display values (at-property / 1-3 / 3-5) come from primary
      sources only
- [ ] Sources detail section in PDF / UI still lists supplemental sources
      for transparency, marked as supplemental
- [ ] Swath rendering uses primary sources only
- [ ] Visual: April 15 (or other recent storm) renders as a clean storm
      shape, not fragmented polygons
- [ ] All morning + afternoon test cases pass
- [ ] Manual: 4" report at 0.6 mi → does NOT appear in At Property column

---

## Source-of-truth quotes (afternoon)

- `~/Blackbox/transcripts/2026-04-27_12-44-14.txt` — source restriction
  decision; "you got too scared about that one storm not showing up that
  you overflooded it with the one random report from Hailtrace"
- `~/Blackbox/transcripts/2026-04-27_12-54-32.txt` — "you need to have it
  back to just NEXRAD and NWS"; mobile-UI complaints
- `~/Blackbox/transcripts/2026-04-27_13-04-47.txt` — polygon "ugly /
  finicky" feedback; "I honestly think it's because you imported all
  these random data that we didn't need"
- `/tmp/whisper-out/right-now-v2.txt` — column bucketing realization
  ("This 'At Property' is just showing what the largest one was within
  five miles")

End of addendum.
