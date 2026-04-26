/**
 * Generic Postgres-backed cache for storm/wind swath collections.
 *
 * The wrapper is two functions:
 *   - getCachedSwath()  → reads + auto-expires
 *   - setCachedSwath()  → upserts with a source-and-age-aware TTL
 *
 * Plus a small helper to build the bbox hash key. The schema is in
 * `server/schema.ts` (`swath_cache`). See that file for keying rules.
 *
 * In-memory fallback: if the DB is unreachable or DATABASE_URL is unset
 * (e.g. dev without postgres), every call no-ops gracefully and the caller
 * just hits the live source. This keeps the dev experience tolerant.
 */

import crypto from 'crypto';
import { sql as pgSql } from '../db.js';
import type { BoundingBox } from './types.js';

export type SwathCacheSource =
  | 'wind-archive'
  | 'wind-live'
  | 'mrms-hail'
  | 'mrms-now'
  | 'nhp-hail';

export interface CachedSwathRow<T> {
  source: SwathCacheSource;
  date: string;
  bbox: BoundingBox;
  metadata: Record<string, unknown>;
  payload: T;
  featureCount: number;
  maxValue: number;
  generatedAt: Date;
  expiresAt: Date;
}

/**
 * Build a stable hash key for a bounding box. We round to 0.05° (~3.5 mi)
 * so two reps querying nearly-the-same neighborhood share cache entries.
 */
export function bboxHash(bounds: BoundingBox): string {
  const round = (n: number) => Math.round(n / 0.05) * 0.05;
  const rounded = [
    round(bounds.north),
    round(bounds.south),
    round(bounds.east),
    round(bounds.west),
  ].map((n) => n.toFixed(2));
  return crypto.createHash('sha1').update(rounded.join(',')).digest('hex').slice(0, 16);
}

/**
 * Pick a TTL based on how old the storm date is. Today/yesterday churn
 * because SPC and IEM publish revisions; older dates are stable archives.
 */
export function ttlForStormDate(opts: {
  source: SwathCacheSource;
  date: string;
  /** Treat anything within this window as "live" — defaults to 1 hour. */
}): number {
  const target = new Date(`${opts.date}T12:00:00-05:00`);
  const ageDays =
    (Date.now() - target.getTime()) / (1000 * 60 * 60 * 24);

  if (opts.source === 'wind-live' || opts.source === 'mrms-now') {
    return 5 * 60 * 1000; // 5 min
  }
  if (ageDays < 1) return 15 * 60 * 1000; // today: 15 min
  if (ageDays < 2) return 60 * 60 * 1000; // yesterday: 1 hr
  if (ageDays < 7) return 6 * 60 * 60 * 1000; // last week: 6 hr
  if (ageDays < 30) return 24 * 60 * 60 * 1000; // last month: 1 day
  return 30 * 24 * 60 * 60 * 1000; // older archive: 30 days
}

interface SwathCacheRow {
  metadata: unknown;
  payload: unknown;
  feature_count: number | null;
  max_value: number | null;
  generated_at: string | Date;
  expires_at: string | Date;
}

export async function getCachedSwath<T>(opts: {
  source: SwathCacheSource;
  date: string;
  bounds: BoundingBox;
}): Promise<CachedSwathRow<T> | null> {
  if (!pgSql) return null;
  const hash = bboxHash(opts.bounds);
  try {
    const rows = await pgSql<SwathCacheRow[]>`
      SELECT metadata, payload, feature_count, max_value, generated_at, expires_at
        FROM swath_cache
       WHERE source = ${opts.source}
         AND date = ${opts.date}
         AND bbox_hash = ${hash}
         AND expires_at > NOW()
       LIMIT 1
    `;
    const row = rows[0];
    if (!row) return null;
    return {
      source: opts.source,
      date: opts.date,
      bbox: opts.bounds,
      metadata: (row.metadata as Record<string, unknown>) ?? {},
      payload: row.payload as T,
      featureCount: row.feature_count ?? 0,
      maxValue: row.max_value ?? 0,
      generatedAt: new Date(row.generated_at),
      expiresAt: new Date(row.expires_at),
    };
  } catch (err) {
    console.warn('[cache] getCachedSwath failed:', err);
    return null;
  }
}

export async function setCachedSwath<T>(opts: {
  source: SwathCacheSource;
  date: string;
  bounds: BoundingBox;
  payload: T;
  metadata?: Record<string, unknown>;
  featureCount?: number;
  maxValue?: number;
  ttlMs?: number;
}): Promise<void> {
  if (!pgSql) return;
  const hash = bboxHash(opts.bounds);
  const ttl =
    opts.ttlMs ??
    ttlForStormDate({ source: opts.source, date: opts.date });
  const expiresAtIso = new Date(Date.now() + ttl).toISOString();
  try {
    // postgres.js v3 binding in this build rejects both pgSql.json() wrappers
    // AND raw Date objects in tagged templates (Buffer.byteLength chokes on
    // anything that isn't a string/Buffer). Workaround: stringify JSONB values,
    // ISO-format Dates, then ::jsonb / ::timestamptz casts in SQL.
    const metadataJson = JSON.stringify(opts.metadata ?? {});
    const payloadJson = JSON.stringify(opts.payload);
    await pgSql`
      INSERT INTO swath_cache (
        source, date, bbox_hash,
        bbox_north, bbox_south, bbox_east, bbox_west,
        metadata, payload, feature_count, max_value, expires_at
      ) VALUES (
        ${opts.source}, ${opts.date}, ${hash},
        ${opts.bounds.north}, ${opts.bounds.south}, ${opts.bounds.east}, ${opts.bounds.west},
        ${metadataJson}::jsonb,
        ${payloadJson}::jsonb,
        ${opts.featureCount ?? 0},
        ${opts.maxValue ?? 0},
        ${expiresAtIso}::timestamptz
      )
      ON CONFLICT (source, date, bbox_hash)
      DO UPDATE SET
        bbox_north = EXCLUDED.bbox_north,
        bbox_south = EXCLUDED.bbox_south,
        bbox_east  = EXCLUDED.bbox_east,
        bbox_west  = EXCLUDED.bbox_west,
        metadata   = EXCLUDED.metadata,
        payload    = EXCLUDED.payload,
        feature_count = EXCLUDED.feature_count,
        max_value     = EXCLUDED.max_value,
        generated_at  = NOW(),
        expires_at    = EXCLUDED.expires_at
    `;
  } catch (err) {
    console.warn('[cache] setCachedSwath failed:', err);
  }
}

/**
 * Lazy purge of expired rows. Cheap to run on a timer because of the
 * `swath_cache_expires_idx` btree. Returns the row count purged.
 */
export async function purgeExpiredSwaths(): Promise<number> {
  if (!pgSql) return 0;
  try {
    const rows = await pgSql<Array<{ count: string }>>`
      DELETE FROM swath_cache WHERE expires_at <= NOW()
      RETURNING 1 AS count
    `;
    return rows.length;
  } catch (err) {
    console.warn('[cache] purgeExpiredSwaths failed:', err);
    return 0;
  }
}

export interface CacheSummaryEntry {
  source: string;
  total: number;
  live: number;
  expired: number;
  oldestEntry: string | null;
  newestEntry: string | null;
}

export async function getCacheSummary(): Promise<CacheSummaryEntry[]> {
  if (!pgSql) return [];
  try {
    const rows = await pgSql<
      Array<{
        source: string;
        total: string;
        live: string;
        expired: string;
        oldest: string | null;
        newest: string | null;
      }>
    >`
      SELECT
        source,
        COUNT(*)                                            AS total,
        COUNT(*) FILTER (WHERE expires_at > NOW())          AS live,
        COUNT(*) FILTER (WHERE expires_at <= NOW())         AS expired,
        MIN(generated_at)                                   AS oldest,
        MAX(generated_at)                                   AS newest
      FROM swath_cache
      GROUP BY source
      ORDER BY source
    `;
    return rows.map((r) => ({
      source: r.source,
      total: Number(r.total),
      live: Number(r.live),
      expired: Number(r.expired),
      oldestEntry: r.oldest,
      newestEntry: r.newest,
    }));
  } catch (err) {
    console.warn('[cache] getCacheSummary failed:', err);
    return [];
  }
}
