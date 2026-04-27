/**
 * displayCapService — adjuster-credibility display cap for hail values.
 *
 * Problem: raw MRMS / NCEI / IEM LSR data sometimes shows 3"–4" hail "at
 * location" in our markets (DMV). Per the field rep with thousands of
 * roofs under his belt, anything >2.5" gets the report rejected as
 * "garbage" by adjusters. Per Gemini consultation in the 2026-04-27
 * meeting: 4" hail aloft can be 0.5" on the roof by the time it lands.
 *
 * This module sits between the underlying truth (which we keep intact in
 * the database) and any rep-or-adjuster-facing surface that prints a hail
 * size. The raw value is preserved everywhere internally; only the
 * display value is capped.
 *
 * Decision authority: 2026-04-27 storm-app meeting (Ahmed, Reese, Russell,
 * Louie) + post-meeting clarifications via Ahmed (consensus override,
 * polygon-containment-as-at-property, Sterling-class radius).
 *
 * Algorithm rules (locked, post-clarification):
 *
 *   raw < 0.25                       → null (no event detected)
 *   raw 0.25–0.74                    → 0.75 floor (every positive reading
 *                                      rounds up to the rep-acceptable
 *                                      minimum the meeting agreed on)
 *   consensus path overrides:
 *     when ≥2 distinct sources agree on a quarter-snap size S where
 *     0.75 ≤ S < 2.6, return S directly — bypasses raw-based cap entirely
 *   else apply raw cap:
 *     raw 0.75–2.00                  → snap to 0.25
 *     raw 2.01–2.50, verified+atLoc  → snap to 0.25
 *     raw 2.01–2.50, otherwise       → 2.0
 *     raw 2.51+, Sterling+ver+atLoc  → snap to 0.25, hard cap 3.0
 *     raw 2.51+, verified            → 2.5
 *     raw 2.51+, otherwise           → 2.0
 *
 * Why consensus overrides cap: when 3 different ground sources independently
 * report the same 1.5" reading, that's stronger evidence than a single MRMS
 * pixel claiming 4". The capped value (e.g. 2.5) would actually OVER-state
 * what hit the roof. Source agreement at moderate sizes is the most
 * adjuster-credible signal we have.
 */

export interface VerificationContext {
  /**
   * ≥3 ground reports for the storm date within tight proximity to the
   * query point, AND at least one of them from a government-backed
   * source (NWS LSR or NCEI Storm Events). Single-source readings of any
   * height never count as verified.
   */
  isVerified: boolean;
  /**
   * At least one ground report within 0.5 mi of the queried point.
   * Different from the band assignment in mrmsService.ts (that is
   * polygon-edge distance). This flag is "did multiple human/government
   * observers stand near this property and report hail".
   */
  isAtLocation: boolean;
  /**
   * Storm matches the Sterling-class allow-list (rare DMV outbreaks
   * where the team has agreed it's OK to display 2.5"–3.0" hail).
   */
  isSterlingClass: boolean;
  /**
   * Consensus size in inches when ≥2 distinct ground-report sources agree
   * on a quarter-snap size in [0.75, 2.6). When set, displayHailInches
   * returns this verbatim — overriding the raw-based cap. null when no
   * consensus exists. Source agreement at moderate sizes is the strongest
   * adjuster-credible signal we have, so it wins over both the raw max
   * (which can be a single hot MRMS pixel) and the standard cap path.
   */
  consensusSize?: number | null;
}

/**
 * Apply the display cap to a raw hail size. Returns null when the raw
 * value is below the suppress floor (no real hail event).
 *
 * Always pass the raw value into the database / audit trail; this
 * function's output is for adjuster-facing display only.
 */
export function displayHailInches(
  rawMaxInches: number,
  v: VerificationContext,
): number | null {
  // Sub-trace radar noise: nothing real hit the roof. Don't fabricate a
  // 0.75 reading from a 0.001 MRMS pixel.
  if (!Number.isFinite(rawMaxInches) || rawMaxInches < 0.25) return null;

  // Consensus override: when ≥2 distinct sources agree on a quarter-snap
  // size in [0.75, 2.6), trust source agreement over the raw max. This
  // catches the "raw 4" but everyone actually saw 1.5"" case where the
  // cap path would still over-state to 2.5.
  if (
    v.consensusSize !== null &&
    v.consensusSize !== undefined &&
    v.consensusSize >= 0.75 &&
    v.consensusSize < 2.6
  ) {
    return roundToQuarter(v.consensusSize);
  }

  // Floor — every positive reading rounds up to 0.75. The meeting was
  // unambiguous: "anything under 0.75 isn't worth showing to a rep."
  if (rawMaxInches < 0.75) return 0.75;

  // Pass-through band: 0.75–2.00 displays the raw value (snapped).
  if (rawMaxInches <= 2.0) return roundToQuarter(rawMaxInches);

  const verifiedAtLoc = v.isVerified && v.isAtLocation;

  // 2.01–2.50: verified+at-location passes through (with quarter snap);
  // anything else clamps to 2.0.
  if (rawMaxInches <= 2.5) {
    return verifiedAtLoc ? roundToQuarter(rawMaxInches) : 2.0;
  }

  // > 2.50: only Sterling-class verified-at-location may exceed 2.5, and
  // even then we hard-cap at 3.0. Everything else gets the
  // verified/unverified ceiling (2.5 or 2.0).
  if (verifiedAtLoc && v.isSterlingClass) {
    return Math.min(roundToQuarter(rawMaxInches), 3.0);
  }

  return v.isVerified ? 2.5 : 2.0;
}

function roundToQuarter(x: number): number {
  return Math.round(x * 4) / 4;
}

/**
 * Compute the consensus size from a list of (sourceLabel, sizeInches)
 * tuples. Returns the highest quarter-snap size in [0.75, 2.6) where ≥2
 * distinct sources reported that size. null when no consensus exists.
 *
 * "Distinct sources" = different source labels (e.g., "ncei-storm-events"
 * vs "iem-lsr"). Two events from the same source aren't a consensus —
 * that's just the same observer pipeline duplicated. Cross-source
 * agreement is what we want.
 */
export function computeConsensusSize(
  reports: Array<{ source: string; sizeInches: number }>,
): number | null {
  // source -> set of quarter-snapped sizes that source reported in [0.75, 2.6)
  const sizesBySource = new Map<string, Set<number>>();
  for (const r of reports) {
    if (!Number.isFinite(r.sizeInches)) continue;
    if (r.sizeInches < 0.75 || r.sizeInches >= 2.6) continue;
    const snapped = roundToQuarter(r.sizeInches);
    if (snapped < 0.75 || snapped >= 2.6) continue;
    if (!sizesBySource.has(r.source)) {
      sizesBySource.set(r.source, new Set());
    }
    sizesBySource.get(r.source)!.add(snapped);
  }

  // Count how many distinct sources reported each size
  const sourceCountForSize = new Map<number, number>();
  for (const sizes of sizesBySource.values()) {
    for (const s of sizes) {
      sourceCountForSize.set(s, (sourceCountForSize.get(s) ?? 0) + 1);
    }
  }

  // Pick the highest size with ≥2 source agreement. Higher consensus is
  // more rep-favorable — among sizes adjusters will accept (under 2.6),
  // we want to show the worst observed.
  let best: number | null = null;
  for (const [size, count] of sourceCountForSize) {
    if (count >= 2 && (best === null || size > best)) best = size;
  }
  return best;
}

/**
 * Sterling-class allow-list. Each entry defines a date and a circular
 * region within which the higher cap (3.0") applies. Membership is
 * computed via (storm date matches) AND (property within radiusMi of
 * stormCenter).
 *
 * Add to this list ONLY on team approval — every entry is a deliberate
 * decision that the storm in question really had verified ≥2.5" hail
 * adjusters won't dismiss.
 */
export interface SterlingClassStorm {
  date: string;
  label: string;
  centerLat: number;
  centerLng: number;
  radiusMi: number;
}

export const STERLING_CLASS_STORMS: SterlingClassStorm[] = [
  {
    date: '2024-08-29',
    label: 'Sterling VA hail outbreak',
    centerLat: 39.0067,
    centerLng: -77.4291,
    // 20 mi covers the actual swath extent that day (Sterling →
    // Vienna/Tysons → Reston → Ashburn → Leesburg → industrial Loudoun).
    // Per-date-impact data shows polygon edges 1.45 mi from Vienna and
    // 1.68 mi from Leesburg's Barksdale Dr. The meeting kept testing
    // 17032 Silver Charm Place in Leesburg (~16 mi from this center) —
    // 15 mi would have cut it off. Doesn't bleed into Frederick MD or
    // Baltimore.
    radiusMi: 20,
  },
];

/**
 * Test whether a given (date, lat, lng) falls inside any Sterling-class
 * storm region. Distance is great-circle (haversine) in miles.
 */
export function isSterlingClassStorm(
  date: string,
  lat: number,
  lng: number,
): boolean {
  for (const s of STERLING_CLASS_STORMS) {
    if (s.date !== date) continue;
    const d = haversineMiles(lat, lng, s.centerLat, s.centerLng);
    if (d <= s.radiusMi) return true;
  }
  return false;
}

function haversineMiles(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 3958.8;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
