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

import { fetchMrmsMesh1440 } from './mrmsFetch.js';
import { readGrib2 } from './grib2/sections.js';
import { decodeGribData } from './grib2/decode.js';
import { buildMrmsVectorCollection, type MrmsVectorCollection } from './mrmsContour.js';
import { getCachedSwath, setCachedSwath } from './cache.js';
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
