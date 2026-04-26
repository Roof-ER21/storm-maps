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
import type { BoundingBox } from './types.js';

export { isMpingConfigured };
export type { MpingReport };

export interface MpingForDateInput {
  date: string;
  bounds?: BoundingBox;
  category?: 'Hail' | 'Wind' | 'Tornado';
}

/**
 * Pull mPING reports for a calendar date (Eastern). The window stretches
 * 04:00 UTC of that date through 12:00 UTC of the next — same convention
 * the consilience service uses.
 */
export async function fetchMpingReportsForDate(
  input: MpingForDateInput,
): Promise<MpingReport[]> {
  const startUtc = new Date(`${input.date}T04:00:00Z`);
  const next = new Date(`${input.date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  next.setUTCHours(12, 0, 0, 0);
  const bbox = input.bounds
    ? {
        north: input.bounds.north,
        south: input.bounds.south,
        east: input.bounds.east,
        west: input.bounds.west,
      }
    : undefined;
  return fetchMpingReports({
    startUtc,
    endUtc: next,
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
