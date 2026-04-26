/**
 * MRMS raster image service — builds a colored PNG overlay from the same
 * GRIB-decoded mm grid the vector pipeline uses.
 *
 * The frontend `MRMSOverlay` consumes a PNG image as a Google Maps
 * GroundOverlay; this module produces that PNG locally so we don't need
 * Susan21 for the historical raster path.
 *
 * Pipeline:
 *   1. Reuse `mrmsService.buildMrmsVectorPolygons` upstream so the GRIB
 *      decode happens once per (date, bbox) and feeds both raster + vector.
 *      But the vector path crops to the bbox; the raster needs the same
 *      crop to a fixed-resolution image.
 *   2. Color each pixel by IHM band → RGBA.
 *   3. PNG-encode via pngjs.
 *   4. Cache for 1 hour archive / 5 min live.
 */

import { PNG } from 'pngjs';
import crypto from 'crypto';
import {
  fetchMrmsMesh1440,
  fetchMrmsMesh60,
  fetchMrmsMeshInstantaneous,
} from './mrmsFetch.js';
import { readGrib2 } from './grib2/sections.js';
import { decodeGribData } from './grib2/decode.js';
import { IHM_HAIL_LEVELS } from './hailFallbackService.js';
import type { BoundingBox } from './types.js';

export interface MrmsRasterResult {
  pngBytes: Uint8Array;
  metadata: {
    date: string;
    refTime: string;
    requestedBounds: BoundingBox;
    /** Bounds the PNG actually covers (after grid snap). */
    bounds: BoundingBox;
    imageSize: { width: number; height: number };
    hasHail: boolean;
    maxMeshInches: number;
    hailPixels: number;
    sourceFile: string;
  };
}

interface CacheEntry {
  expiresAt: number;
  result: MrmsRasterResult;
}

const cache = new Map<string, CacheEntry>();
const CACHE_MAX = 32;
const ARCHIVE_TTL_MS = 60 * 60 * 1000;
const LIVE_TTL_MS = 5 * 60 * 1000;

function cacheKey(date: string, bounds: BoundingBox): string {
  const round = (n: number) => Math.round(n / 0.05) * 0.05;
  const raw = [
    date,
    round(bounds.north).toFixed(2),
    round(bounds.south).toFixed(2),
    round(bounds.east).toFixed(2),
    round(bounds.west).toFixed(2),
  ].join('|');
  return crypto.createHash('sha1').update(raw).digest('hex').slice(0, 24);
}

function enforceCap(): void {
  while (cache.size > CACHE_MAX) {
    const oldestKey = cache.keys().next().value;
    if (!oldestKey) break;
    cache.delete(oldestKey);
  }
}

function hexToRgb(hex: string): [number, number, number] {
  const trimmed = hex.replace(/^#/, '');
  const r = parseInt(trimmed.slice(0, 2), 16);
  const g = parseInt(trimmed.slice(2, 4), 16);
  const b = parseInt(trimmed.slice(4, 6), 16);
  return [
    Number.isFinite(r) ? r : 255,
    Number.isFinite(g) ? g : 255,
    Number.isFinite(b) ? b : 255,
  ];
}

const BAND_RGB: Array<{ thresholdMm: number; rgb: [number, number, number] }> =
  IHM_HAIL_LEVELS.map((band) => ({
    thresholdMm: band.sizeMm,
    rgb: hexToRgb(band.color),
  }));

/** Pick the highest-applicable IHM band for a mm value, or null when below the trace threshold. */
function bandForValue(mm: number): { rgb: [number, number, number] } | null {
  if (!Number.isFinite(mm) || mm < BAND_RGB[0].thresholdMm) return null;
  let chosen = BAND_RGB[0];
  for (const b of BAND_RGB) {
    if (mm >= b.thresholdMm) chosen = b;
    else break;
  }
  return { rgb: chosen.rgb };
}

interface CroppedGrid {
  width: number;
  height: number;
  values: Float32Array;
  bounds: BoundingBox;
}

/**
 * Crop the CONUS mm grid to the requested bbox without padding (raster
 * overlay should match the user's view exactly). Snaps to grid cells so
 * the GroundOverlay aligns crisply.
 */
function cropToBboxNoPad(
  decoded: { values: Float32Array; width: number; height: number; scanningMode: number },
  grid: { lat1: number; lng1: number; dLat: number; dLng: number; width: number; height: number },
  bounds: BoundingBox,
): CroppedGrid {
  const { width: W, height: H } = decoded;
  const isLatNS = (decoded.scanningMode & 0x80) === 0;
  const isLngWE = (decoded.scanningMode & 0x40) === 0;
  const dLng = (isLngWE ? 1 : -1) * grid.dLng;
  const dLat = (isLatNS ? -1 : 1) * grid.dLat;
  const lng0 = grid.lng1;
  const lat0 = grid.lat1;

  const colFromLng = (lng: number) => Math.round((lng - lng0) / dLng);
  const rowFromLat = (lat: number) => Math.round((lat - lat0) / dLat);
  let col0 = colFromLng(bounds.west);
  let col1 = colFromLng(bounds.east);
  let row0 = rowFromLat(bounds.north);
  let row1 = rowFromLat(bounds.south);
  if (col0 > col1) [col0, col1] = [col1, col0];
  if (row0 > row1) [row0, row1] = [row1, row0];
  col0 = Math.max(0, col0);
  row0 = Math.max(0, row0);
  col1 = Math.min(W - 1, col1);
  row1 = Math.min(H - 1, row1);
  const cropW = col1 - col0 + 1;
  const cropH = row1 - row0 + 1;
  if (cropW < 1 || cropH < 1) {
    return { width: 0, height: 0, values: new Float32Array(), bounds };
  }
  const out = new Float32Array(cropW * cropH);
  for (let r = 0; r < cropH; r += 1) {
    const srcRow = (row0 + r) * W + col0;
    const dstRow = r * cropW;
    for (let c = 0; c < cropW; c += 1) {
      out[dstRow + c] = decoded.values[srcRow + c];
    }
  }
  // Compute the actual bounds the cropped grid covers (cell centers).
  const actualNorth = lat0 + row0 * dLat;
  const actualSouth = lat0 + (row1 + 1) * dLat;
  const actualWest = lng0 + col0 * dLng;
  const actualEast = lng0 + (col1 + 1) * dLng;
  return {
    width: cropW,
    height: cropH,
    values: out,
    bounds: {
      north: Math.max(actualNorth, actualSouth),
      south: Math.min(actualNorth, actualSouth),
      east: Math.max(actualEast, actualWest),
      west: Math.min(actualEast, actualWest),
    },
  };
}

function gridToPng(cropped: CroppedGrid): {
  pngBytes: Uint8Array;
  hasHail: boolean;
  maxMeshMm: number;
  hailPixels: number;
} {
  const { width, height, values } = cropped;
  if (width === 0 || height === 0) {
    return { pngBytes: new Uint8Array(), hasHail: false, maxMeshMm: 0, hailPixels: 0 };
  }
  const png = new PNG({ width, height, colorType: 6 }); // RGBA
  let maxMeshMm = 0;
  let hailPixels = 0;
  for (let i = 0; i < values.length; i += 1) {
    const mm = values[i];
    if (mm > maxMeshMm && Number.isFinite(mm)) maxMeshMm = mm;
    const band = bandForValue(mm);
    const off = i * 4;
    if (band) {
      hailPixels += 1;
      png.data[off] = band.rgb[0];
      png.data[off + 1] = band.rgb[1];
      png.data[off + 2] = band.rgb[2];
      png.data[off + 3] = 200; // ~78% opacity — matches the existing overlay feel
    } else {
      png.data[off] = 0;
      png.data[off + 1] = 0;
      png.data[off + 2] = 0;
      png.data[off + 3] = 0;
    }
  }
  const buf = PNG.sync.write(png, { colorType: 6 });
  return {
    pngBytes: new Uint8Array(buf),
    hasHail: hailPixels > 0,
    maxMeshMm,
    hailPixels,
  };
}

interface BuildRasterParams {
  date: string;
  bounds: BoundingBox;
  anchorIso?: string;
  /** When true, use the today's-latest file path (now-cast). */
  live?: boolean;
  /**
   * Which MRMS MESH product to fetch.
   *   - 'mesh1440' (default): 24-hour rolling max — daily composite
   *   - 'mesh60': 60-min rolling max — drives the hourly scrubber
   */
  product?: 'mesh1440' | 'mesh60';
}

export async function buildMrmsRaster(
  params: BuildRasterParams,
): Promise<MrmsRasterResult | null> {
  const product = params.product ?? 'mesh1440';
  // Cache key folds in product so mesh60/mesh1440 don't share cache slots.
  const key =
    cacheKey(params.date, params.bounds) +
    (params.live ? '|live' : '') +
    (params.anchorIso ? `|${params.anchorIso}` : '') +
    `|${product}`;
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.expiresAt > now) return hit.result;

  try {
    // Product fetch chain — fall back when IEM hasn't archived the
    // requested aggregation for older dates:
    //   mesh60 (live cadence) → instantaneous MESH (always available)
    //   mesh1440 (archive default) → unchanged
    let file = null;
    if (product === 'mesh60') {
      file = await fetchMrmsMesh60({
        date: params.date,
        anchorIso: params.live ? undefined : params.anchorIso,
      });
      if (!file) {
        // IEM archive doesn't carry MESH_Max_60min/ for older dates —
        // fall through to instantaneous MESH at the same anchor. Reps
        // see a snapshot at that hour rather than a 60-min rolling max,
        // which is a fair trade for archive playback.
        file = await fetchMrmsMeshInstantaneous({
          date: params.date,
          anchorIso: params.live ? undefined : params.anchorIso,
        });
      }
    } else {
      file = await fetchMrmsMesh1440({
        date: params.date,
        anchorIso: params.live ? undefined : params.anchorIso,
      });
    }
    if (!file) return null;
    const sections = readGrib2(file.grib2Bytes);
    const decoded = decodeGribData(sections);
    const cropped = cropToBboxNoPad(decoded, sections.grid, params.bounds);
    const { pngBytes, hasHail, maxMeshMm, hailPixels } = gridToPng(cropped);
    if (pngBytes.length === 0) return null;

    const result: MrmsRasterResult = {
      pngBytes,
      metadata: {
        date: params.date,
        refTime: file.refTime,
        requestedBounds: params.bounds,
        bounds: cropped.bounds,
        imageSize: { width: cropped.width, height: cropped.height },
        hasHail,
        maxMeshInches: maxMeshMm / 25.4,
        hailPixels,
        sourceFile: file.url,
      },
    };
    cache.set(key, {
      expiresAt: now + (params.live ? LIVE_TTL_MS : ARCHIVE_TTL_MS),
      result,
    });
    enforceCap();
    return result;
  } catch (err) {
    console.warn('[mrms-raster] decode pipeline failed:', err);
    return null;
  }
}
