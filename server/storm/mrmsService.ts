/**
 * MRMS vector hail polygon service — production replacement for the
 * Susan21 cross-repo dependency.
 *
 * Pipeline:
 *   1. Read swath_cache (DB) keyed on (mrms-hail, date, bbox).
 *   2. Cache miss → fetch the day's MESH_Max_1440min GRIB2 from IEM
 *      MTArchive (`mrmsFetch.ts`).
 *   3. Parse the GRIB2 sections, decode the data section to a mm grid,
 *      crop to the requested bbox, run d3-contour at the 13 IHM thresholds
 *      (`mrmsContour.ts`).
 *   4. Persist to swath_cache (`cache.ts`) for the next rep.
 *
 * Errors at any step (network, malformed GRIB2, unsupported template, etc.)
 * return null so the calling endpoint falls through to the SPC/LSR-buffered
 * fallback (`hailFallbackService.ts`).
 */

import { fetchMrmsMesh1440, fetchMrmsMesh60 } from './mrmsFetch.js';
import { readGrib2 } from './grib2/sections.js';
import { decodeGribData } from './grib2/decode.js';
import { buildMrmsVectorCollection, type MrmsVectorCollection } from './mrmsContour.js';
import { getCachedSwath, setCachedSwath } from './cache.js';
import { pointInRing, nearestRingDistanceMiles } from './geometry.js';
import type { BoundingBox } from './types.js';

interface BuildMrmsParams {
  date: string;
  bounds: BoundingBox;
  anchorIso?: string;
}

export async function buildMrmsVectorPolygons(
  params: BuildMrmsParams,
): Promise<MrmsVectorCollection | null> {
  // L2 cache hit — DB round-trip is far cheaper than GRIB decode.
  const cached = await getCachedSwath<MrmsVectorCollection>({
    source: 'mrms-hail',
    date: params.date,
    bounds: params.bounds,
  });
  if (cached) {
    // Only count it as a hit if the payload was produced by the real MRMS
    // pipeline; the SPC/LSR fallback writes to the same key. The fallback
    // sets metadata.origin = 'in-repo-fallback', the real pipeline sets
    // metadata.source = 'mrms-vector'.
    const meta = cached.payload.metadata as { source?: string };
    if (meta?.source === 'mrms-vector') {
      return cached.payload;
    }
  }

  try {
    const file = await fetchMrmsMesh1440({
      date: params.date,
      anchorIso: params.anchorIso,
    });
    if (!file) {
      console.warn('[mrms] no GRIB2 file found for', params.date);
      return null;
    }
    const sections = readGrib2(file.grib2Bytes);
    const decoded = decodeGribData(sections);
    const collection = buildMrmsVectorCollection({
      decoded,
      grid: sections.grid,
      bounds: params.bounds,
      date: params.date,
      refTime: file.refTime,
      sourceFile: file.url,
    });

    // Fire-and-forget cache write.
    void setCachedSwath({
      source: 'mrms-hail',
      date: params.date,
      bounds: params.bounds,
      payload: collection,
      metadata: {
        sourceFile: file.url,
        refTime: file.refTime,
        maxHailInches: collection.metadata.maxHailInches,
        origin: 'mrms-vector',
      },
      featureCount: collection.features.length,
      maxValue: collection.metadata.maxHailInches,
    });
    return collection;
  } catch (err) {
    console.warn('[mrms] decode pipeline failed:', err);
    return null;
  }
}

/**
 * Live now-cast: same pipeline but pinned to today's most-recent file.
 * IEM MTArchive lags real-time by ~2 hours, which is acceptable for
 * canvassing decisions and matches what HailTrace/IHM publish anyway.
 */
export async function buildMrmsNowVectorPolygons(
  bounds: BoundingBox,
): Promise<MrmsVectorCollection | null> {
  const today = new Date().toISOString().slice(0, 10);
  const cached = await getCachedSwath<MrmsVectorCollection>({
    source: 'mrms-now-60min',
    date: today,
    bounds,
  });
  if (cached) {
    const meta = cached.payload.metadata as { source?: string };
    if (meta?.source === 'mrms-vector') return cached.payload;
  }

  // True now-cast — 60-min rolling MESH max, ~2-min publish cadence on IEM.
  // Falls back to the 1440-min product if the 60-min latest isn't available
  // (rare, but covers IEM publishing gaps without breaking the live layer).
  try {
    const file =
      (await fetchMrmsMesh60({ date: today })) ??
      (await fetchMrmsMesh1440({ date: today }));
    if (!file) return null;
    const sections = readGrib2(file.grib2Bytes);
    const decoded = decodeGribData(sections);
    const collection = buildMrmsVectorCollection({
      decoded,
      grid: sections.grid,
      bounds,
      date: today,
      refTime: file.refTime,
      sourceFile: file.url,
    });
    // Tag the collection with the product so downstream consumers (PDF,
    // overlay legend) can surface the correct rolling-window label.
    (collection.metadata as MrmsVectorCollection['metadata'] & {
      product?: string;
    }).product = file.product;
    void setCachedSwath({
      source: 'mrms-now-60min',
      date: today,
      bounds,
      payload: collection,
      metadata: {
        sourceFile: file.url,
        refTime: file.refTime,
        product: file.product,
        maxHailInches: collection.metadata.maxHailInches,
        origin: 'mrms-vector',
      },
      featureCount: collection.features.length,
      maxValue: collection.metadata.maxHailInches,
      // 2-min TTL for the 60-min product, 5-min for the 1440-min fallback.
      ttlMs: file.product === 'MESH_Max_60min' ? 2 * 60 * 1000 : 5 * 60 * 1000,
    });
    return collection;
  } catch (err) {
    console.warn('[mrms-now] decode pipeline failed:', err);
    return null;
  }
}

// ─── Storm impact (point-in-polygon) ───────────────────────────────────

export interface MrmsImpactInput {
  date: string;
  bounds: BoundingBox;
  anchorIso?: string;
  points: Array<{ id: string; lat: number; lng: number }>;
}

export interface MrmsImpactResult {
  id: string;
  maxHailInches: number | null;
  level: number | null;
  color: string | null;
  label: string | null;
  severity: string | null;
  directHit: boolean;
  /**
   * True when the property is *outside* the strict swath polygon but within
   * the near-miss buffer (≤0.1mi from a ≥0.5" swath edge). UI still shows
   * DIRECT HIT — this flag is for the subtitle/distance breakdown.
   */
  nearMiss?: boolean;
  /** Distance (miles) to the nearest ≥0.5" swath edge — only set when nearMiss. */
  edgeDistanceMiles?: number;
}

export interface MrmsImpactResponse {
  date: string;
  anchorTimestamp: string | null;
  metadata: {
    stormMaxInches: number;
    stormHailCells: number;
    stormFeatureCount: number;
    pointsChecked: number;
    directHits: number;
  };
  results: MrmsImpactResult[];
}

/**
 * Per-address point-in-polygon impact lookup against a real MRMS-decoded
 * collection. Replaces the cross-repo Susan21 `/api/hail/storm-impact`.
 *
 * Always reuses the cached MRMS polygon collection, so the cost is sub-50ms
 * after the first call for a given (date, bbox).
 */
export async function buildMrmsImpactResponse(
  input: MrmsImpactInput,
): Promise<MrmsImpactResponse | null> {
  const collection = await buildMrmsVectorPolygons({
    date: input.date,
    bounds: input.bounds,
    anchorIso: input.anchorIso,
  });
  if (!collection) return null;

  // Near-miss buffer: properties within this distance of a ≥0.5" swath edge
  // count as DIRECT HIT. Closes the gap with HailTrace's edge tolerance and
  // captures the "lot edge brushed by storm" cases reps lose to competitors.
  // 0.1 mi ≈ 528 ft ≈ one residential block.
  const NEAR_MISS_BUFFER_MILES = 0.1;
  // Near-miss only applies to actionable bands. Below ½" we don't generously
  // extend a "trace" hit, even at the buffer distance.
  const NEAR_MISS_FLOOR_INCHES = 0.5;

  const results: MrmsImpactResult[] = [];
  let directHits = 0;

  for (const pt of input.points) {
    let bestLevel = -1;
    let bestBand: {
      sizeInches: number;
      color: string;
      label: string;
      severity: string;
    } | null = null;

    for (const feature of collection.features) {
      const idx = feature.properties.level;
      if (idx <= bestLevel) continue;
      let inside = false;
      for (const polygon of feature.geometry.coordinates) {
        if (polygon.length === 0) continue;
        // Outer ring + holes — outer must contain, holes must not.
        if (!pointInRing(pt.lat, pt.lng, polygon[0])) continue;
        let inHole = false;
        for (let r = 1; r < polygon.length; r += 1) {
          if (pointInRing(pt.lat, pt.lng, polygon[r])) {
            inHole = true;
            break;
          }
        }
        if (!inHole) {
          inside = true;
          break;
        }
      }
      if (inside) {
        bestLevel = idx;
        bestBand = {
          sizeInches: feature.properties.sizeInches,
          color: feature.properties.color,
          label: feature.properties.label,
          severity: feature.properties.severity,
        };
      }
    }

    if (bestBand && bestLevel >= 0) {
      directHits += 1;
      results.push({
        id: pt.id,
        maxHailInches: bestBand.sizeInches,
        level: bestLevel,
        color: bestBand.color,
        label: bestBand.label,
        severity: bestBand.severity,
        directHit: true,
      });
      continue;
    }

    // No strict-inside hit — try the near-miss buffer pass against ≥0.5"
    // bands only. We pick the highest band whose nearest edge is within
    // the buffer distance.
    let nearMissLevel = -1;
    let nearMissBand: typeof bestBand = null;
    let nearMissDistance = Infinity;
    for (const feature of collection.features) {
      if (feature.properties.sizeInches < NEAR_MISS_FLOOR_INCHES) continue;
      const idx = feature.properties.level;
      if (idx <= nearMissLevel) continue;
      let minDist = Infinity;
      for (const polygon of feature.geometry.coordinates) {
        if (polygon.length === 0) continue;
        for (const ring of polygon) {
          const d = nearestRingDistanceMiles(pt.lat, pt.lng, ring);
          if (d < minDist) minDist = d;
        }
      }
      if (minDist <= NEAR_MISS_BUFFER_MILES) {
        nearMissLevel = idx;
        nearMissBand = {
          sizeInches: feature.properties.sizeInches,
          color: feature.properties.color,
          label: feature.properties.label,
          severity: feature.properties.severity,
        };
        nearMissDistance = minDist;
      }
    }

    if (nearMissBand && nearMissLevel >= 0) {
      directHits += 1;
      results.push({
        id: pt.id,
        maxHailInches: nearMissBand.sizeInches,
        level: nearMissLevel,
        color: nearMissBand.color,
        label: nearMissBand.label,
        severity: nearMissBand.severity,
        directHit: true,
        nearMiss: true,
        edgeDistanceMiles: nearMissDistance,
      });
    } else {
      results.push({
        id: pt.id,
        maxHailInches: null,
        level: null,
        color: null,
        label: null,
        severity: null,
        directHit: false,
      });
    }
  }

  return {
    date: input.date,
    anchorTimestamp: input.anchorIso ?? null,
    metadata: {
      stormMaxInches: collection.metadata.maxHailInches,
      stormHailCells: collection.metadata.hailCells,
      stormFeatureCount: collection.features.length,
      pointsChecked: input.points.length,
      directHits,
    },
    results,
  };
}
