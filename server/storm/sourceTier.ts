/**
 * sourceTier — primary vs supplemental classification per the
 * 2026-04-27 afternoon addendum.
 *
 * Background (Ahmed, afternoon transcript):
 *   "You need to have it back to just NEXRAD and NWS. Insurance company
 *    won't recognize that. You got too scared about that one storm not
 *    showing up that you overflooded it with the one random report from
 *    Hailtrace."
 *
 * Two tiers:
 *
 *   PRIMARY  — drives the headline display values (At Property / 1–3 / 3–5
 *              columns, swath rendering, tier classification). These are the
 *              sources adjusters recognize:
 *                · MRMS / NEXRAD MRMS (algorithmic radar product)
 *                · NWS Local Storm Reports (we ingest via the IEM mirror →
 *                  source_iem_lsr; the data ORIGINATES at NWS forecast
 *                  offices, IEM is just the broker)
 *                · NCEI Storm Events Database (post-event government archive)
 *
 *   SUPPLEMENTAL — still ingested for transparency, listed in the Sources
 *                  detail block of the PDF, but NEVER moves the headline
 *                  cell. Includes mPING, CoCoRaHS, Hailtrace spotters,
 *                  NCEI SWDI / NX3 MDA, SPC, random KLX-class radar IDs,
 *                  IEM VTEC, etc.
 *
 * Verification rule update (afternoon addendum, line 230):
 *   isVerified = ≥3 PRIMARY reports within ≤0.5 mi
 *                AND ≥1 of those is a government-observer source
 *                    (NWS LSR / NCEI Storm Events — NOT raw MRMS pixels).
 *
 *   The morning rule said "≥1 government-backed". We now distinguish:
 *   MRMS is primary for display but it's an algorithmic product, not a
 *   human/government observer report. The verification gate requires a
 *   real observer to corroborate — that's what gives the cap its
 *   adjuster credibility.
 */

export type SourceTier = 'primary' | 'supplemental';

/**
 * Source labels recognized by adjusters and treated as PRIMARY for the
 * display path.
 *
 * Tag conventions in this codebase:
 *   - `ncei-storm-events` → matches verified_hail_events.source_ncei_storm_events
 *   - `iem-lsr`           → NWS Local Storm Reports (delivered via IEM mirror;
 *                           same data adjusters know as "NWS LSR")
 *   - `mrms` / `nexrad-mrms` → MRMS GRIB2 / MESH product
 *   - `nws-warnings`      → NWS Storm Based Warnings (SBW polygons)
 *
 * Anything not listed here lands in the supplemental bucket via classifySource.
 */
export const PRIMARY_SOURCES: ReadonlySet<string> = new Set([
  'mrms',
  'nexrad-mrms',
  'iem-lsr',
  'nws-lsr',
  'ncei-storm-events',
  'nws-warnings',
]);

/**
 * Sources that satisfy the "government-observer" half of the verification
 * gate. MRMS is intentionally excluded — it's a primary display source
 * but algorithmic, not a human/government observer report. Verification
 * needs a real LSR or NCEI archive entry to count.
 */
export const GOV_OBSERVER_SOURCES: ReadonlySet<string> = new Set([
  'iem-lsr',
  'nws-lsr',
  'ncei-storm-events',
]);

export function classifySource(source: string | null | undefined): SourceTier {
  if (!source) return 'supplemental';
  return PRIMARY_SOURCES.has(source) ? 'primary' : 'supplemental';
}

export function isGovObserverSource(source: string | null | undefined): boolean {
  if (!source) return false;
  return GOV_OBSERVER_SOURCES.has(source);
}

/**
 * Map a `verified_hail_events` row's source_* boolean columns to the
 * canonical primary source label, or null if the row has no primary
 * source flag set. Used by SQL projection and JS-side classification
 * paths interchangeably so the tier rule is consistent everywhere.
 *
 * Order matters: NCEI Storm Events wins over IEM LSR if both are set,
 * because the NCEI archive is the more durable government record.
 */
export interface SourceFlags {
  source_ncei_storm_events?: boolean | null;
  source_iem_lsr?: boolean | null;
  source_nws_warnings?: boolean | null;
  source_ncei_swdi?: boolean | null;
  source_mping?: boolean | null;
  source_cocorahs?: boolean | null;
  source_hailtrace?: boolean | null;
  source_spc_hail?: boolean | null;
  source_synoptic?: boolean | null;
}

export function primarySourceLabel(flags: SourceFlags): string | null {
  if (flags.source_ncei_storm_events) return 'ncei-storm-events';
  if (flags.source_iem_lsr) return 'iem-lsr';
  if (flags.source_nws_warnings) return 'nws-warnings';
  return null;
}

export function anySourceLabel(flags: SourceFlags): string {
  if (flags.source_ncei_storm_events) return 'ncei-storm-events';
  if (flags.source_iem_lsr) return 'iem-lsr';
  if (flags.source_nws_warnings) return 'nws-warnings';
  if (flags.source_ncei_swdi) return 'ncei-swdi';
  if (flags.source_mping) return 'mping';
  if (flags.source_cocorahs) return 'cocorahs';
  if (flags.source_hailtrace) return 'hailtrace';
  if (flags.source_spc_hail) return 'spc';
  if (flags.source_synoptic) return 'synoptic';
  return 'other';
}
