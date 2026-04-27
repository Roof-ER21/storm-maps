/**
 * NWS warnings filter wrapper for the PDF Section 6 (Severe Weather
 * Warnings). Reuses the existing `fetchIemVtecForDate` aggregator (which
 * already merges IEM SBW + NWS api fallback) and `pointInWarning` from
 * iemVtecClient.ts. No new HTTP — just a typed wrapper that filters to
 * warnings whose polygon contains the property point on the date of loss.
 */

import type { BoundingBox } from './types.js';
import {
  fetchIemVtecForDate,
  pointInWarning,
  type IemVtecWarning,
} from './iemVtecClient.js';

export interface NwsWarningsForPropertyOpts {
  lat: number;
  lng: number;
  dateOfLoss: string;
  /** Optional pre-computed bounds for the underlying IEM fetch. Falls
   *  through to a 0.6° box around the property when omitted. */
  bounds?: BoundingBox;
  /** Days of cushion on either side of dateOfLoss; defaults to 0 (single
   *  ET-day window — same as the SBW "polygon_begin / polygon_end" bracket
   *  the IEM endpoint already enforces). Currently unused; kept for spec
   *  parity. */
  days?: number;
}

/**
 * Returns warnings whose polygon CONTAINS the property point on the given
 * date. Sorts by issue time ascending so reps reading the PDF see the
 * timeline in the order the warnings were broadcast.
 *
 * Falls through to an empty array on any IEM failure — the PDF must still
 * render the rest of the report.
 */
export async function fetchNwsWarningsForProperty(
  opts: NwsWarningsForPropertyOpts,
): Promise<IemVtecWarning[]> {
  const bounds: BoundingBox = opts.bounds ?? {
    north: opts.lat + 0.6,
    south: opts.lat - 0.6,
    east: opts.lng + 0.6,
    west: opts.lng - 0.6,
  };
  const all = await fetchIemVtecForDate({
    date: opts.dateOfLoss,
    bounds,
  }).catch(() => [] as IemVtecWarning[]);
  const containing = all.filter((w) => pointInWarning(opts.lat, opts.lng, w));
  return containing.sort(
    (a, b) =>
      new Date(a.issueIso).getTime() - new Date(b.issueIso).getTime(),
  );
}

export type { IemVtecWarning } from './iemVtecClient.js';
