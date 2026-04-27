/**
 * verificationService — populate VerificationContext for a property+date.
 *
 * "Verified" per the 2026-04-27 meeting:
 *   - ≥3 ground spotter reports for the storm date within ≤0.5 mi
 *   - ≥1 of those reports from a government-backed source
 *     (NWS LSR ⇒ source_iem_lsr, OR NCEI Storm Events ⇒ source_ncei_storm_events)
 *
 * "At-location":
 *   - ≥1 ground report within ≤0.5 mi of the property point
 *
 * "Sterling-class":
 *   - delegated to displayCapService.isSterlingClassStorm
 *
 * Bulk-friendly: a single SQL round-trip can resolve verification for an
 * arbitrary list of dates so callers (PDF gen, per-date-impact endpoint)
 * don't fan out one query per date.
 */

import { sql as pgSql } from '../db.js';
import {
  bandVerification,
  computeConsensusSize,
  isSterlingClassStorm,
  type VerificationContext,
} from './displayCapService.js';
import { isGovObserverSource } from './sourceTier.js';

interface VerificationRow {
  event_date: string | Date;
  ground_reports_within_half_mi: number;
  gov_reports_within_half_mi: number;
}

/** A single ground report tagged with its source label, used to compute
 *  consensus size across distinct sources. */
interface SizedReport {
  event_date: string;
  source: string;
  size_inches: number;
}

const AT_LOCATION_MI = 0.5;
// Lat/lng prefilter window for the SQL — wider than 0.5 mi to be safe,
// then the haversine count drops anything outside the true 0.5 mi circle.
const AT_LOCATION_LAT_PAD = 0.012; // ~0.83 mi
const AT_LOCATION_LNG_PAD = 0.015; // ~0.83 mi at this latitude

/**
 * Resolve VerificationContext for one date+location. Best for the
 * single-shot AddressImpactBadge / per-event request path.
 */
export async function buildVerification(opts: {
  lat: number;
  lng: number;
  date: string;
}): Promise<VerificationContext> {
  const map = await buildVerificationBulk({
    lat: opts.lat,
    lng: opts.lng,
    dates: [opts.date],
  });
  return (
    map.get(opts.date) ?? {
      isVerified: false,
      isAtLocation: false,
      isSterlingClass: isSterlingClassStorm(opts.date, opts.lat, opts.lng),
    }
  );
}

/**
 * Bulk variant — one SQL query for an arbitrary list of dates. Used by
 * report PDFs and the per-date-impact endpoint to keep the cost flat
 * regardless of how many storm dates the property has in history.
 */
export async function buildVerificationBulk(opts: {
  lat: number;
  lng: number;
  dates: string[];
}): Promise<Map<string, VerificationContext>> {
  const out = new Map<string, VerificationContext>();
  if (!pgSql || opts.dates.length === 0) return out;

  // Seed default rows (no reports → not verified) so callers always get
  // a context for every requested date even when nothing matched.
  for (const d of opts.dates) {
    out.set(d, {
      isVerified: false,
      isAtLocation: false,
      isSterlingClass: isSterlingClassStorm(d, opts.lat, opts.lng),
    });
  }

  // Coerce dates to plain strings — postgres.js's array binder choked on
  // mixed/Date inputs in prod ("Received an instance of Array"). Comparing
  // event_date::text against a text[] also sidesteps the date[] typecode
  // path entirely, which is where the original ANY(${dates}::date[]) form
  // was failing.
  const dateStrs = opts.dates.map((d) => String(d).slice(0, 10));

  try {
    // Two queries from the same predicate window: one aggregated for
    // counts (verified flag), one row-per-report for consensus sizing.
    const [countRows, sizedRows] = await Promise.all([
      pgSql<VerificationRow[]>`
        SELECT
          event_date,
          COUNT(*) FILTER (
            WHERE 3959 * acos(LEAST(1.0,
              cos(radians(${opts.lat})) * cos(radians(lat)) *
              cos(radians(lng) - radians(${opts.lng})) +
              sin(radians(${opts.lat})) * sin(radians(lat))
            )) <= ${AT_LOCATION_MI}
          )::int AS ground_reports_within_half_mi,
          COUNT(*) FILTER (
            WHERE 3959 * acos(LEAST(1.0,
              cos(radians(${opts.lat})) * cos(radians(lat)) *
              cos(radians(lng) - radians(${opts.lng})) +
              sin(radians(${opts.lat})) * sin(radians(lat))
            )) <= ${AT_LOCATION_MI}
            AND (source_ncei_storm_events OR source_iem_lsr)
          )::int AS gov_reports_within_half_mi
          FROM verified_hail_events
         WHERE event_date::text = ANY(${dateStrs})
           AND lat BETWEEN ${opts.lat - AT_LOCATION_LAT_PAD}
                       AND ${opts.lat + AT_LOCATION_LAT_PAD}
           AND lng BETWEEN ${opts.lng - AT_LOCATION_LNG_PAD}
                       AND ${opts.lng + AT_LOCATION_LNG_PAD}
           AND COALESCE(hail_size_inches, magnitude, 0) >= 0.25
           -- 2026-04-27 afternoon addendum: count PRIMARY-only sources
           -- toward the verification gate. SWDI / mPING / SPC spotters
           -- are supplemental and shouldn't push a property into
           -- "verified" status on their own.
           AND (
             source_ncei_storm_events
             OR source_iem_lsr
           )
         GROUP BY event_date
      `,
      // Row-per-report — used to detect cross-source size agreement.
      // We project each row's "primary source label" so distinct
      // sources can be counted in the consensus check.
      pgSql<SizedReport[]>`
        SELECT
          event_date::text AS event_date,
          (CASE
             WHEN source_ncei_storm_events THEN 'ncei-storm-events'
             WHEN source_iem_lsr THEN 'iem-lsr'
             ELSE 'other'
           END) AS source,
          COALESCE(hail_size_inches, magnitude, 0)::float AS size_inches
          FROM verified_hail_events
         WHERE event_date::text = ANY(${dateStrs})
           AND lat BETWEEN ${opts.lat - AT_LOCATION_LAT_PAD}
                       AND ${opts.lat + AT_LOCATION_LAT_PAD}
           AND lng BETWEEN ${opts.lng - AT_LOCATION_LNG_PAD}
                       AND ${opts.lng + AT_LOCATION_LNG_PAD}
           AND COALESCE(hail_size_inches, magnitude, 0) >= 0.25
           AND (
             source_ncei_storm_events
             OR source_iem_lsr
           )
           AND 3959 * acos(LEAST(1.0,
             cos(radians(${opts.lat})) * cos(radians(lat)) *
             cos(radians(lng) - radians(${opts.lng})) +
             sin(radians(${opts.lat})) * sin(radians(lat))
           )) <= ${AT_LOCATION_MI}
      `,
    ]);

    // Group sized reports by date for the consensus calc
    const reportsByDate = new Map<string, SizedReport[]>();
    for (const r of sizedRows) {
      const dateStr = r.event_date.slice(0, 10);
      const arr = reportsByDate.get(dateStr) ?? [];
      arr.push(r);
      reportsByDate.set(dateStr, arr);
    }

    for (const r of countRows) {
      const dateStr =
        r.event_date instanceof Date
          ? r.event_date.toISOString().slice(0, 10)
          : String(r.event_date).slice(0, 10);
      const ground = Number(r.ground_reports_within_half_mi) || 0;
      const gov = Number(r.gov_reports_within_half_mi) || 0;
      const reports = reportsByDate.get(dateStr) ?? [];
      const consensusSize = computeConsensusSize(
        reports.map((rr) => ({ source: rr.source, sizeInches: rr.size_inches })),
      );
      out.set(dateStr, {
        isVerified: ground >= 3 && gov >= 1,
        isAtLocation: ground >= 1,
        isSterlingClass: isSterlingClassStorm(dateStr, opts.lat, opts.lng),
        consensusSize,
      });
    }
  } catch (err) {
    console.warn(
      '[verificationService] bulk query failed:',
      (err as Error).message,
    );
  }
  return out;
}

/**
 * Banded variant — returns per-band VerificationContext (atProperty /
 * mi1to3 / mi3to5) per date so callers can apply the cap algorithm
 * INDEPENDENTLY per column. Per the 2026-04-27 afternoon addendum, every
 * adjuster-facing column should run its own verification gate against
 * reports IN that band.
 *
 * Strict bucketing: a 4" reading at 0.6 mi lands in mi1to3 only — never
 * in atProperty.
 *
 * Single SQL round-trip pulls primary-source reports out to ~5.5 mi
 * (5 mi + a small lat/lng pad to be safe), then JS-side bucketing splits
 * by haversine distance. The cost is one SELECT per call regardless of
 * how many dates were requested.
 */
const FAR_BAND_MI = 5.0;
const BAND_LAT_PAD = 0.085; // ~5.9 mi
const BAND_LNG_PAD = 0.105; // ~5.9 mi at this latitude

interface BandedSizedReport {
  event_date: string;
  source: string;
  size_inches: number;
  dist_mi: number;
}

export interface BandedVerification {
  atProperty: VerificationContext;
  mi1to3: VerificationContext;
  mi3to5: VerificationContext;
}

export async function buildBandedVerificationBulk(opts: {
  lat: number;
  lng: number;
  dates: string[];
}): Promise<Map<string, BandedVerification>> {
  const out = new Map<string, BandedVerification>();
  if (!pgSql || opts.dates.length === 0) return out;

  const dateStrs = opts.dates.map((d) => String(d).slice(0, 10));

  // Seed empty contexts so callers always get something for every date.
  for (const d of dateStrs) {
    const empty = {
      isVerified: false,
      isAtLocation: false,
      isSterlingClass: isSterlingClassStorm(d, opts.lat, opts.lng),
      consensusSize: null,
    };
    out.set(d, { atProperty: empty, mi1to3: empty, mi3to5: empty });
  }

  try {
    const rows = await pgSql<BandedSizedReport[]>`
      SELECT
        event_date::text AS event_date,
        (CASE
           WHEN source_ncei_storm_events THEN 'ncei-storm-events'
           WHEN source_iem_lsr THEN 'iem-lsr'
           ELSE 'other'
         END) AS source,
        COALESCE(hail_size_inches, magnitude, 0)::float AS size_inches,
        (3959 * acos(LEAST(1.0,
          cos(radians(${opts.lat})) * cos(radians(lat)) *
          cos(radians(lng) - radians(${opts.lng})) +
          sin(radians(${opts.lat})) * sin(radians(lat))
        )))::float AS dist_mi
        FROM verified_hail_events
       WHERE event_date::text = ANY(${dateStrs})
         AND lat BETWEEN ${opts.lat - BAND_LAT_PAD} AND ${opts.lat + BAND_LAT_PAD}
         AND lng BETWEEN ${opts.lng - BAND_LNG_PAD} AND ${opts.lng + BAND_LNG_PAD}
         AND COALESCE(hail_size_inches, magnitude, 0) >= 0.25
         AND (
           source_ncei_storm_events
           OR source_iem_lsr
         )
    `;

    type BandReports = {
      atProperty: Array<{ source: string; sizeIn: number }>;
      mi1to3: Array<{ source: string; sizeIn: number }>;
      mi3to5: Array<{ source: string; sizeIn: number }>;
    };
    const byDate = new Map<string, BandReports>();
    for (const r of rows) {
      const d = String(r.event_date).slice(0, 10);
      const dist = Number(r.dist_mi);
      if (!Number.isFinite(dist) || dist > FAR_BAND_MI) continue;
      const bucket =
        byDate.get(d) ??
        ({ atProperty: [], mi1to3: [], mi3to5: [] } as BandReports);
      const entry = { source: r.source, sizeIn: Number(r.size_inches) };
      // Strict bucketing — same boundaries as reportPdf.ts histRow.
      if (dist <= 0.5) bucket.atProperty.push(entry);
      else if (dist <= 3.0) bucket.mi1to3.push(entry);
      else bucket.mi3to5.push(entry);
      byDate.set(d, bucket);
    }

    for (const [dateStr, b] of byDate) {
      out.set(dateStr, {
        atProperty: bandVerification(
          b.atProperty,
          dateStr,
          opts.lat,
          opts.lng,
          isGovObserverSource,
        ),
        mi1to3: bandVerification(
          b.mi1to3,
          dateStr,
          opts.lat,
          opts.lng,
          isGovObserverSource,
        ),
        mi3to5: bandVerification(
          b.mi3to5,
          dateStr,
          opts.lat,
          opts.lng,
          isGovObserverSource,
        ),
      });
    }
  } catch (err) {
    console.warn(
      '[verificationService] banded bulk query failed:',
      (err as Error).message,
    );
  }
  return out;
}
