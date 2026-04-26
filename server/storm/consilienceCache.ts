/**
 * Consilience cache — Postgres-backed read-through layer for the
 * 10-source consilience result.
 *
 * Why: a single consilience compute fans out 10 concurrent network
 * fetches (MRMS GRIB, SPC CSV, IEM LSR, IEM VTEC, NCEI SWDI, mPING,
 * HailTrace, Synoptic, plus DB lookups). Total wall time ~3-8 seconds.
 * The dashboard's "Latest Hits" list shows up to 4 storm dates per
 * property, so without a cache that's 12-32 seconds of network traffic
 * per page load. The prewarm scheduler computes ahead, this cache
 * stores those results.
 *
 * Granularity:
 *   lat/lng quantized to 0.01° (~0.7 mi) so two reps on the same block
 *   share a hit. Same convention as the event_cache + bbox_hash key.
 *
 * Freshness:
 *   24-hour TTL — consilience inputs (NCEI archive especially) update
 *   slowly. Live MRMS-now alerts use a separate path; this cache is
 *   for "what happened on a known historical date" lookups.
 */

import { sql as pgSql } from '../db.js';
import type { ConsilienceResult } from './consilienceService.js';

function quantize(n: number): number {
  return Math.round(n * 100) / 100;
}

interface CacheRow {
  payload: ConsilienceResult;
  generated_at: string | Date;
}

export async function readConsilienceCache(opts: {
  lat: number;
  lng: number;
  date: string;
  radiusMiles: number;
}): Promise<ConsilienceResult | null> {
  if (!pgSql) return null;
  try {
    const rows = await pgSql<CacheRow[]>`
      SELECT payload, generated_at
        FROM consilience_cache
       WHERE event_date = ${opts.date}::date
         AND lat_q = ${quantize(opts.lat)}
         AND lng_q = ${quantize(opts.lng)}
         AND radius_miles = ${opts.radiusMiles}
         AND generated_at > NOW() - INTERVAL '24 hours'
       LIMIT 1
    `;
    return rows[0]?.payload ?? null;
  } catch (err) {
    console.warn('[consilience-cache] read failed:', (err as Error).message);
    return null;
  }
}

export async function writeConsilienceCache(
  result: ConsilienceResult,
): Promise<void> {
  if (!pgSql) return;
  // Don't waste rows on null results — only persist when at least one
  // source confirmed.
  if (result.confirmedCount === 0) return;
  try {
    const payloadJson = JSON.stringify(result);
    await pgSql`
      INSERT INTO consilience_cache (
        event_date, lat_q, lng_q, radius_miles,
        confirmed_count, confidence_tier, payload, generated_at
      ) VALUES (
        ${result.query.date}::date,
        ${quantize(result.query.lat)},
        ${quantize(result.query.lng)},
        ${result.query.radiusMiles},
        ${result.confirmedCount},
        ${result.confidenceTier},
        ${payloadJson}::jsonb,
        NOW()
      )
      ON CONFLICT (event_date, lat_q, lng_q, radius_miles)
      DO UPDATE SET
        confirmed_count = EXCLUDED.confirmed_count,
        confidence_tier = EXCLUDED.confidence_tier,
        payload = EXCLUDED.payload,
        generated_at = NOW()
    `;
  } catch (err) {
    console.warn('[consilience-cache] write failed:', (err as Error).message);
  }
}

/**
 * Purge consilience_cache rows older than `daysOld` (default 30).
 * Returns the number of rows deleted. Run periodically from the scheduler.
 */
export async function purgeStaleCache(daysOld = 30): Promise<number> {
  if (!pgSql) return 0;
  try {
    const rows = await pgSql<Array<{ count: string }>>`
      DELETE FROM consilience_cache
       WHERE generated_at < NOW() - ${daysOld}::int * INTERVAL '1 day'
       RETURNING 1 AS count
    `;
    return rows.length;
  } catch (err) {
    console.warn('[consilience-cache] purge failed:', (err as Error).message);
    return 0;
  }
}

export async function getConsilienceCacheStats(): Promise<{
  total: number;
  fresh: number;
  byTier: Array<{ tier: string; n: number }>;
  newest: string | null;
  oldest: string | null;
}> {
  if (!pgSql) return { total: 0, fresh: 0, byTier: [], newest: null, oldest: null };
  try {
    const totals = await pgSql<
      Array<{
        total: string;
        fresh: string;
        newest: string | null;
        oldest: string | null;
      }>
    >`
      SELECT
        COUNT(*)::text AS total,
        COUNT(*) FILTER (WHERE generated_at > NOW() - INTERVAL '24 hours')::text AS fresh,
        MAX(generated_at)::text AS newest,
        MIN(generated_at)::text AS oldest
        FROM consilience_cache
    `;
    const byTier = await pgSql<Array<{ confidence_tier: string; n: string }>>`
      SELECT confidence_tier, COUNT(*)::text AS n
        FROM consilience_cache
       WHERE generated_at > NOW() - INTERVAL '24 hours'
       GROUP BY confidence_tier
       ORDER BY n DESC
    `;
    return {
      total: Number(totals[0]?.total ?? 0),
      fresh: Number(totals[0]?.fresh ?? 0),
      byTier: byTier.map((r) => ({ tier: r.confidence_tier, n: Number(r.n) })),
      newest: totals[0]?.newest ?? null,
      oldest: totals[0]?.oldest ?? null,
    };
  } catch (err) {
    console.warn('[consilience-cache] stats failed:', (err as Error).message);
    return { total: 0, fresh: 0, byTier: [], newest: null, oldest: null };
  }
}
