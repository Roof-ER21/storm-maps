/**
 * Enrichment Data Cache
 * Wraps Census, FEMA, and Property data services with a persistent DB cache.
 *
 * Cache TTLs:
 * - Census ACS (per tract): 180 days — changes annually
 * - FEMA flood zone: 180 days — changes rarely
 * - FEMA disasters: 30 days — new declarations happen
 * - Property records: 90 days — sales/assessments change
 *
 * Cache keys:
 * - Census: "census:{state}-{county}-{tract}" (all addresses in a tract share one cache entry)
 * - FEMA flood: "fema_flood:{lat4}:{lng4}" (rounded to 4 decimals ~11m precision)
 * - FEMA disaster: "fema_disaster:{state}" (per-state, filtered by county at query time)
 * - Property: "property:{lat4}:{lng4}" (per-parcel precision)
 */

import { eq, sql, and, gt } from "drizzle-orm";
import type { DB } from "../../db.js";
import { dataCache } from "../schema.js";
import { getCensusData, type CensusData } from "./censusDataService.js";
import { getFemaData, type FemaData } from "./femaDataService.js";
import { getPropertyData, type PropertyData } from "./propertyDataService.js";

// Cache TTLs in days
const CENSUS_TTL_DAYS = 180;
const FEMA_FLOOD_TTL_DAYS = 180;
const FEMA_DISASTER_TTL_DAYS = 30;
const PROPERTY_TTL_DAYS = 90;

// ============================================================
// Generic cache helpers
// ============================================================

async function getCached<T>(db: DB, key: string): Promise<T | null> {
  try {
    const result = await db.query.dataCache.findFirst({
      where: and(
        eq(dataCache.cacheKey, key),
        gt(dataCache.expiresAt, new Date())
      ),
    });
    return result ? (result.data as T) : null;
  } catch {
    return null;
  }
}

async function setCache(
  db: DB,
  key: string,
  dataType: string,
  data: unknown,
  ttlDays: number,
  lat?: number,
  lng?: number
): Promise<void> {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + ttlDays);

  try {
    await db
      .insert(dataCache)
      .values({
        cacheKey: key,
        dataType,
        data: data as any,
        lat: lat || null,
        lng: lng || null,
        expiresAt,
      })
      .onConflictDoUpdate({
        target: dataCache.cacheKey,
        set: {
          data: data as any,
          expiresAt,
          createdAt: new Date(),
        },
      });
  } catch (e) {
    // Non-critical — just means next call will re-fetch
    console.warn("Cache write failed:", e);
  }
}

function roundCoord(n: number, decimals: number = 4): string {
  return n.toFixed(decimals);
}

// ============================================================
// Cached data fetchers
// ============================================================

/**
 * Get Census data with cache. Cached by FIPS tract (all addresses
 * in the same Census tract share one cache entry).
 */
export async function getCachedCensusData(
  lat: number,
  lng: number,
  db: DB
): Promise<CensusData | null> {
  // First, try a location-based key (we won't know the tract until we query)
  const locationKey = `census:${roundCoord(lat, 3)}:${roundCoord(lng, 3)}`;
  const cached = await getCached<CensusData>(db, locationKey);
  if (cached) return cached;

  // Fetch from API
  const data = await getCensusData(lat, lng);
  if (!data || !data.hasData) return data;

  // Cache by both location AND tract (tract key is better for dedup)
  const tractKey = `census:${data.fipsState}-${data.fipsCounty}-${data.fipsTract}`;
  await Promise.all([
    setCache(db, tractKey, "census", data, CENSUS_TTL_DAYS, lat, lng),
    setCache(db, locationKey, "census", data, CENSUS_TTL_DAYS, lat, lng),
  ]);

  return data;
}

/**
 * Get FEMA data with cache. Flood zone cached by precise location,
 * disaster declarations cached by state.
 */
export async function getCachedFemaData(
  lat: number,
  lng: number,
  stateAbbrev?: string,
  countyName?: string,
  db?: DB
): Promise<FemaData | null> {
  if (!db) return getFemaData(lat, lng, stateAbbrev, countyName);

  const floodKey = `fema_flood:${roundCoord(lat)}:${roundCoord(lng)}`;
  const cached = await getCached<FemaData>(db, floodKey);
  if (cached) return cached;

  // Fetch from API
  const data = await getFemaData(lat, lng, stateAbbrev, countyName);
  if (!data) return data;

  // Cache — use the shorter TTL (disaster) since we're caching the combined result
  await setCache(db, floodKey, "fema", data, FEMA_DISASTER_TTL_DAYS, lat, lng);

  return data;
}

/**
 * Get property data with cache. Cached by precise lat/lng (parcel level).
 */
export async function getCachedPropertyData(
  lat: number,
  lng: number,
  address: string | undefined,
  db: DB
): Promise<PropertyData | null> {
  const key = `property:${roundCoord(lat)}:${roundCoord(lng)}`;
  const cached = await getCached<PropertyData>(db, key);
  if (cached) return cached;

  // Fetch from API
  const data = await getPropertyData(lat, lng, address);
  if (!data || !data.hasData) return data;

  await setCache(db, key, "property", data, PROPERTY_TTL_DAYS, lat, lng);

  return data;
}

/**
 * Clean expired cache entries. Call periodically (e.g., daily).
 */
export async function purgeExpiredCache(db: DB): Promise<number> {
  try {
    const result = await db
      .delete(dataCache)
      .where(sql`${dataCache.expiresAt} < now()`)
      .returning({ id: dataCache.id });
    return result.length;
  } catch {
    return 0;
  }
}

/**
 * Get cache stats for dashboard/debugging.
 */
export async function getCacheStats(db: DB): Promise<{
  totalEntries: number;
  byType: Record<string, number>;
  expiredCount: number;
}> {
  try {
    const allEntries = await db
      .select({
        dataType: dataCache.dataType,
        count: sql<number>`count(*)::int`,
      })
      .from(dataCache)
      .groupBy(dataCache.dataType);

    const expired = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(dataCache)
      .where(sql`${dataCache.expiresAt} < now()`);

    const byType: Record<string, number> = {};
    let total = 0;
    for (const row of allEntries) {
      byType[row.dataType] = row.count;
      total += row.count;
    }

    return {
      totalEntries: total,
      byType,
      expiredCount: expired[0]?.count || 0,
    };
  } catch {
    return { totalEntries: 0, byType: {}, expiredCount: 0 };
  }
}
