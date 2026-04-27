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
  isSterlingClassStorm,
  type VerificationContext,
} from './displayCapService.js';

interface VerificationRow {
  event_date: string | Date;
  ground_reports_within_half_mi: number;
  gov_reports_within_half_mi: number;
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

  try {
    const rows = await pgSql<VerificationRow[]>`
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
       WHERE event_date = ANY(${opts.dates}::date[])
         AND lat BETWEEN ${opts.lat - AT_LOCATION_LAT_PAD}
                     AND ${opts.lat + AT_LOCATION_LAT_PAD}
         AND lng BETWEEN ${opts.lng - AT_LOCATION_LNG_PAD}
                     AND ${opts.lng + AT_LOCATION_LNG_PAD}
         AND COALESCE(hail_size_inches, magnitude, 0) >= 0.25
         AND (
           source_ncei_storm_events
           OR source_iem_lsr
           OR source_ncei_swdi
           OR source_mping
           OR source_spc_hail
         )
       GROUP BY event_date
    `;
    for (const r of rows) {
      const dateStr =
        r.event_date instanceof Date
          ? r.event_date.toISOString().slice(0, 10)
          : String(r.event_date).slice(0, 10);
      const ground = Number(r.ground_reports_within_half_mi) || 0;
      const gov = Number(r.gov_reports_within_half_mi) || 0;
      out.set(dateStr, {
        isVerified: ground >= 3 && gov >= 1,
        isAtLocation: ground >= 1,
        isSterlingClass: isSterlingClassStorm(dateStr, opts.lat, opts.lng),
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
