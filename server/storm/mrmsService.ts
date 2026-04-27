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
  /**
   * Standalone prewarm scripts exit after completion, so they need the DB
   * write to finish before sql.end(). Runtime requests keep the faster
   * fire-and-forget behavior.
   */
  awaitCacheWrite?: boolean;
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

    const cacheWrite = setCachedSwath({
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
    if (params.awaitCacheWrite) {
      await cacheWrite;
    } else {
      void cacheWrite;
    }
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

/**
 * Three-tier impact classification — mirrors Gemini Field Assistant's
 * `addressImpactService` pattern so reps reading both products see the
 * same vocabulary. Order is rep-usefulness desc.
 *
 *   direct_hit  — property INSIDE the MRMS swath polygon. Authoritative.
 *   near_miss   — property within 1mi of any swath edge (Verisk/ISO "At
 *                 Property" zone, equivalent to a confirming point report
 *                 within 1mi). Still claim-worthy.
 *   area_impact — property within 1–10mi of a swath. Context only.
 *   no_impact   — no swath within 10mi.
 */
export type ImpactTier = 'direct_hit' | 'near_miss' | 'area_impact' | 'no_impact';

/**
 * Per-tier max hail size in mutually-exclusive distance bands.
 * Matches Gemini Field's PDF column layout exactly so the rep narrative
 * is consistent across both products' reports.
 *
 *   atProperty: 0.0 ≤ dist ≤ 1.0  (inside swath OR within 1mi)
 *   mi1to3:     1.0 < dist ≤ 3.0
 *   mi3to5:     3.0 < dist ≤ 5.0
 *   mi5to10:    5.0 < dist ≤ 10.0
 *
 * Each value is the MAX hail size (inches) found in that band — null
 * when no swath overlaps the band. ¼" display floor applied at PDF
 * render time, not here.
 */
export interface ImpactBands {
  atProperty: number | null;
  mi1to3: number | null;
  mi3to5: number | null;
  mi5to10: number | null;
}

export interface MrmsImpactResult {
  id: string;
  maxHailInches: number | null;
  level: number | null;
  color: string | null;
  label: string | null;
  severity: string | null;
  directHit: boolean;
  /** Three-tier label — primary signal for rep + adjuster. */
  tier: ImpactTier;
  /** Distance (miles) to the nearest swath edge of any size. */
  edgeDistanceMiles?: number;
  /** Distance (miles) to the nearest ≥0.5" swath edge. */
  edgeDistanceHalfInchMiles?: number;
  /** Per-tier max hail in mutually-exclusive distance bands. */
  bands: ImpactBands;
  /**
   * @deprecated use `tier === 'near_miss'`. Kept for one release cycle so
   * existing clients don't break.
   */
  nearMiss?: boolean;
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

  // Tier band boundaries — mutually exclusive, mirror Gemini Field's
  // PDF column layout.
  //
  // 2026-04-27 meeting clarification: "At Property" should be the actual
  // band the house is INSIDE (point-in-polygon containment), NOT the
  // max polygon-edge proximity. Reps and adjusters care about what hit
  // the roof, not what the storm did down the street.
  //
  // Edge-distance bucketing still drives the 1–3 mi and 3–5 mi columns
  // (they're rep-context for "the storm did X 2 mi away"). Boundary
  // tightened from the prior 1.0 → 0.5 mi so polygons whose edge is
  // 0.5–3 mi land in the 1-3 mi bucket (the new explicit gap below 0.5
  // is reserved for the polygon-containment path → bands.atProperty).
  const AT_PROPERTY_MILES = 0.5;
  const MI_3 = 3.0;
  const MI_5 = 5.0;
  const MI_10 = 10.0;
  const HALF_INCH = 0.5;

  const results: MrmsImpactResult[] = [];
  let directHits = 0;

  // ¼" trace floor — polygons below this don't qualify for tier
  // classification or at-property display. Per the 2026-04-27 meeting
  // we don't claim sub-trace radar signatures as "hail at property"
  // even when the polygon technically contains the lat/lng. Otherwise
  // every property in the DMV would be a "direct hit" on every storm
  // because the ⅛" outer band covers most of the region.
  const TRACE_FLOOR = 0.25;

  for (const pt of input.points) {
    // ── Pass 1: strict point-in-polygon for ≥¼" bands only.
    //   Find the highest-band swath the point is INSIDE that's also
    //   above the trace floor. Polygons below the floor are skipped —
    //   tier and atProperty stay null when the only containing polygon
    //   is the trace ⅛" outer ring.
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
      if (feature.properties.sizeInches < TRACE_FLOOR) continue;
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

    // ── Pass 2: per-band edge distance scan.
    //   For every feature, compute the minimum distance from the point
    //   to its nearest polygon edge. Track:
    //     - overall closest swath edge (any size)
    //     - closest ≥½" edge (for the rep "claim-grade hail nearby" tier)
    //     - per-tier MAX hail size in each distance band
    let edgeAny = Infinity;
    let edgeHalf = Infinity;
    let atPropertyMax: number | null = null;
    let mi1to3Max: number | null = null;
    let mi3to5Max: number | null = null;
    let mi5to10Max: number | null = null;

    for (const feature of collection.features) {
      const sizeIn = feature.properties.sizeInches;
      // Skip sub-trace polygons in band classification too — they'd
      // pollute the 1–3 / 3–5 columns the same way they would the
      // at-property column.
      if (sizeIn < TRACE_FLOOR) continue;
      let minDist = Infinity;
      for (const polygon of feature.geometry.coordinates) {
        if (polygon.length === 0) continue;
        for (const ring of polygon) {
          const d = nearestRingDistanceMiles(pt.lat, pt.lng, ring);
          if (d < minDist) minDist = d;
        }
      }
      if (minDist === Infinity) continue;
      if (minDist < edgeAny) edgeAny = minDist;
      if (sizeIn >= HALF_INCH && minDist < edgeHalf) edgeHalf = minDist;

      // Bucket into the band whose UPPER bound this feature first
      // crosses. Pass 1's bestBand already covers the inside-swath case
      // — Pass 2's atPropertyMax is for the 0.5-mi-but-not-containing
      // edge case (polygon next door). Used in tier classification
      // (near_miss) but NOT in the band display (atProperty column
      // shows polygon-containment only, per the meeting clarification).
      if (minDist <= AT_PROPERTY_MILES) {
        if (atPropertyMax === null || sizeIn > atPropertyMax) atPropertyMax = sizeIn;
      } else if (minDist <= MI_3) {
        if (mi1to3Max === null || sizeIn > mi1to3Max) mi1to3Max = sizeIn;
      } else if (minDist <= MI_5) {
        if (mi3to5Max === null || sizeIn > mi3to5Max) mi3to5Max = sizeIn;
      } else if (minDist <= MI_10) {
        if (mi5to10Max === null || sizeIn > mi5to10Max) mi5to10Max = sizeIn;
      }
    }

    // Per the 2026-04-27 meeting clarification, "At Property" is the
    // band the house is INSIDE (Pass 1 polygon-containment), not the
    // closest edge. Pass 2's atPropertyMax (≤0.5 mi but not containing)
    // is intentionally NOT folded back in — that would overclaim hail
    // sizes from polygons that didn't actually cover the property.
    // Pass 2's atPropertyMax still drives tier classification below
    // (near_miss when edge is close even without containment).
    const bands: ImpactBands = {
      atProperty: bestBand ? bestBand.sizeInches : null,
      mi1to3: mi1to3Max,
      mi3to5: mi3to5Max,
      mi5to10: mi5to10Max,
    };

    // ── Tier classification (Gemini-Field-aligned)
    let tier: ImpactTier;
    if (bestBand && bestLevel >= 0) {
      tier = 'direct_hit';
    } else if (atPropertyMax !== null) {
      // Property within 1mi of a swath edge — Verisk/ISO "At Property".
      tier = 'near_miss';
    } else if (mi1to3Max !== null || mi3to5Max !== null || mi5to10Max !== null) {
      tier = 'area_impact';
    } else {
      tier = 'no_impact';
    }

    if (tier === 'direct_hit' && bestBand) {
      directHits += 1;
      results.push({
        id: pt.id,
        maxHailInches: bestBand.sizeInches,
        level: bestLevel,
        color: bestBand.color,
        label: bestBand.label,
        severity: bestBand.severity,
        directHit: true,
        tier,
        edgeDistanceMiles: edgeAny === Infinity ? undefined : edgeAny,
        edgeDistanceHalfInchMiles: edgeHalf === Infinity ? undefined : edgeHalf,
        bands,
      });
    } else if (tier === 'near_miss') {
      results.push({
        id: pt.id,
        maxHailInches: atPropertyMax,
        level: null,
        color: null,
        label: null,
        severity: null,
        directHit: false,
        tier,
        edgeDistanceMiles: edgeAny === Infinity ? undefined : edgeAny,
        edgeDistanceHalfInchMiles: edgeHalf === Infinity ? undefined : edgeHalf,
        bands,
        nearMiss: true,
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
        tier,
        edgeDistanceMiles: edgeAny === Infinity ? undefined : edgeAny,
        edgeDistanceHalfInchMiles: edgeHalf === Infinity ? undefined : edgeHalf,
        bands,
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
