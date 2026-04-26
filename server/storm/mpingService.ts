/**
 * mPING service — wraps the client with bbox/date helpers and per-day
 * caching tuned for live + historical use.
 *
 * Used by:
 *   - consilienceService (6th source for property+date corroboration)
 *   - /api/storm/mping endpoint (for the map-layer UI)
 *   - background poller (live ingest into verified_hail_events, optional)
 */

import { fetchMpingReports, isMpingConfigured, type MpingReport } from './mpingClient.js';
import { etDayUtcWindow } from './timeUtils.js';
import type { BoundingBox } from './types.js';

export { isMpingConfigured };
export type { MpingReport };

export interface MpingForDateInput {
  date: string;
  bounds?: BoundingBox;
  category?: 'Hail' | 'Wind' | 'Tornado';
}

/**
 * Pull mPING reports for an Eastern calendar date. UTC window is computed
 * via timeUtils.etDayUtcWindow() so DST + late-evening-ET storms are
 * handled correctly. (Previous version hardcoded T04:00:00Z which only
 * works during EDT, and ended at next-day T12:00:00Z = 8am ET, way too
 * late.)
 */
export async function fetchMpingReportsForDate(
  input: MpingForDateInput,
): Promise<MpingReport[]> {
  const w = etDayUtcWindow(input.date);
  const bbox = input.bounds
    ? {
        north: input.bounds.north,
        south: input.bounds.south,
        east: input.bounds.east,
        west: input.bounds.west,
      }
    : undefined;
  return fetchMpingReports({
    startUtc: w.startUtc,
    endUtc: w.endUtc,
    bbox,
    category: input.category ?? 'Hail',
  });
}

/**
 * Pull mPING reports for a sliding window ending now (default 60 min).
 * Used by the live overlay on the map and by the live alert worker.
 */
export async function fetchRecentMpingReports(opts: {
  windowMinutes?: number;
  bounds?: BoundingBox;
  category?: 'Hail' | 'Wind' | 'Tornado';
}): Promise<MpingReport[]> {
  const minutes = opts.windowMinutes ?? 60;
  const endUtc = new Date();
  const startUtc = new Date(endUtc.getTime() - minutes * 60 * 1000);
  return fetchMpingReports({
    startUtc,
    endUtc,
    bbox: opts.bounds,
    category: opts.category ?? 'Hail',
  });
}
