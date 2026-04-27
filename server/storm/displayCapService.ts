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
 * Louie). See HANDOFF-DISPLAY-CAP-2026-04-27.md for context.
 *
 * Algorithm rules (locked):
 *
 *   raw < 0.4              → suppress (treat as no hail)
 *   raw < 0.75             → 0.75 floor
 *   raw 0.75–2.00          → pass through, snap to 0.25
 *   raw 2.01–2.50, NOT verified+at-location → 2.0
 *   raw 2.01–2.50, verified+at-location     → pass through, snap to 0.25
 *   raw 2.51+, verified+at-location, Sterling-class → snap to 0.25, hard cap 3.0
 *   raw 2.51+, verified, NOT Sterling-class → 2.5
 *   raw 2.51+, NOT verified → 2.0
 *
 * Two known-meeting-typo discrepancies in the handoff doc that this
 * implementation resolves in favor of the rule-table (NOT the test
 * snippets):
 *   1. 0.33 → suppress (handoff test expected 0.75, but rule says <0.4
 *      suppress; rule wins).
 *   2. >3.0 + Sterling-class → 3.0 hard cap (handoff TS only handled
 *      2.51–3.0 Sterling; this implementation extends to all >2.5
 *      Sterling values, capped at 3.0).
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
  if (!Number.isFinite(rawMaxInches) || rawMaxInches < 0.4) return null;
  if (rawMaxInches < 0.75) return 0.75;
  if (rawMaxInches <= 2.0) return roundToQuarter(rawMaxInches);

  const verifiedAtLoc = v.isVerified && v.isAtLocation;

  // 2.01 – 2.50: verified+at-location passes through (with quarter snap),
  // anything else gets clamped to 2.0.
  if (rawMaxInches <= 2.5) {
    return verifiedAtLoc ? roundToQuarter(rawMaxInches) : 2.0;
  }

  // > 2.50: only Sterling-class verified-at-location may exceed 2.5,
  // and even then it's hard-capped at 3.0. Everything else gets the
  // verified/unverified ceiling.
  if (verifiedAtLoc && v.isSterlingClass) {
    return Math.min(roundToQuarter(rawMaxInches), 3.0);
  }

  return v.isVerified ? 2.5 : 2.0;
}

function roundToQuarter(x: number): number {
  return Math.round(x * 4) / 4;
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
    radiusMi: 15,
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
