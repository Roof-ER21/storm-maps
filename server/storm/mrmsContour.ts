/**
 * MRMS mm-grid → IHM 13-band MultiPolygon FeatureCollection.
 *
 * Steps:
 *   1. Crop the CONUS-wide grid to the requested bounds + 50 km pad.
 *   2. Run d3-contour at the 13 IHM hail thresholds.
 *   3. Convert pixel coords → lat/lng via the linear grid params.
 *   4. Simplify aggressively (drop near-duplicate points) so polygons
 *      don't blow the response payload past ~200 KB on big storms.
 */

import { contours } from 'd3-contour';
import type { DecodedGrid } from './grib2/decode.js';
import type { Grib2Grid } from './grib2/sections.js';
import { IHM_HAIL_LEVELS } from './hailFallbackService.js';
import type { BoundingBox } from './types.js';

export interface MrmsVectorFeature {
  type: 'Feature';
  properties: {
    level: number;
    sizeInches: number;
    sizeMm: number;
    label: string;
    color: string;
    severity: string;
  };
  geometry: { type: 'MultiPolygon'; coordinates: number[][][][] };
}

export interface MrmsVectorCollection {
  type: 'FeatureCollection';
  features: MrmsVectorFeature[];
  metadata: {
    date: string;
    refTime: string;
    bounds: BoundingBox;
    maxHailInches: number;
    hailCells: number;
    sourceFile: string;
    generatedAt: string;
    source: 'mrms-vector';
  };
}

interface CroppedGrid {
  /** Width × height of the cropped subgrid. */
  width: number;
  height: number;
  values: Float32Array;
  /** Pixel→lat/lng linear params for the cropped region. */
  lng0: number;
  lat0: number;
  dLng: number;
  dLat: number;
}

function cropGrid(
  decoded: DecodedGrid,
  grid: Grib2Grid,
  bounds: BoundingBox,
  padMiles = 30,
): CroppedGrid {
  const { width: W, height: H } = decoded;
  // Determine pixel→lat/lng mapping. GRIB2 scanning mode: bit 0 = direction
  // along latitude, where 0 = N→S; bit 1 = direction along longitude,
  // 0 = W→E. MRMS files are laid out N→S, W→E (scanningMode = 0x00).
  const isLatNS = (decoded.scanningMode & 0x80) === 0;
  const isLngWE = (decoded.scanningMode & 0x40) === 0;

  // Per-pixel step in lat/lng (degrees).
  const dLng = (isLngWE ? 1 : -1) * grid.dLng;
  const dLat = (isLatNS ? -1 : 1) * grid.dLat;
  const lng0 = grid.lng1;
  const lat0 = grid.lat1;

  // Pad bbox by ~30 mi → degrees (approx).
  const meanLat = (bounds.north + bounds.south) / 2;
  const padLat = padMiles / 69;
  const padLng = padMiles / Math.max(0.05, 69 * Math.cos((meanLat * Math.PI) / 180));
  const north = bounds.north + padLat;
  const south = bounds.south - padLat;
  const east = bounds.east + padLng;
  const west = bounds.west - padLng;

  const colFromLng = (lng: number): number => Math.round((lng - lng0) / dLng);
  const rowFromLat = (lat: number): number => Math.round((lat - lat0) / dLat);

  let col0 = colFromLng(west);
  let col1 = colFromLng(east);
  let row0 = rowFromLat(north);
  let row1 = rowFromLat(south);
  if (col0 > col1) [col0, col1] = [col1, col0];
  if (row0 > row1) [row0, row1] = [row1, row0];
  col0 = Math.max(0, col0);
  row0 = Math.max(0, row0);
  col1 = Math.min(W - 1, col1);
  row1 = Math.min(H - 1, row1);

  const cropW = col1 - col0 + 1;
  const cropH = row1 - row0 + 1;
  if (cropW <= 1 || cropH <= 1) {
    return {
      width: 1,
      height: 1,
      values: new Float32Array(1),
      lng0: lng0 + col0 * dLng,
      lat0: lat0 + row0 * dLat,
      dLng,
      dLat,
    };
  }
  const out = new Float32Array(cropW * cropH);
  for (let r = 0; r < cropH; r += 1) {
    const srcRow = (row0 + r) * W + col0;
    const dstRow = r * cropW;
    for (let c = 0; c < cropW; c += 1) {
      out[dstRow + c] = decoded.values[srcRow + c];
    }
  }
  return {
    width: cropW,
    height: cropH,
    values: out,
    lng0: lng0 + col0 * dLng,
    lat0: lat0 + row0 * dLat,
    dLng,
    dLat,
  };
}

/**
 * Compress consecutive points in a ring that are within `epsilonPx` of each
 * other. Drops up to ~70% of points without any visible difference at the
 * zoom levels reps care about.
 */
function simplifyRing(ring: number[][], epsilon = 1.4): number[][] {
  if (ring.length <= 4) return ring;
  const out: number[][] = [ring[0]];
  for (let i = 1; i < ring.length; i += 1) {
    const last = out[out.length - 1];
    const dx = ring[i][0] - last[0];
    const dy = ring[i][1] - last[1];
    if (Math.hypot(dx, dy) >= epsilon) {
      out.push(ring[i]);
    }
  }
  // Ensure closed.
  if (
    out.length >= 3 &&
    (out[0][0] !== out[out.length - 1][0] ||
      out[0][1] !== out[out.length - 1][1])
  ) {
    out.push(out[0]);
  }
  return out.length >= 4 ? out : ring;
}

function pixelToLngLat(
  px: number,
  py: number,
  cropped: CroppedGrid,
): [number, number] {
  return [cropped.lng0 + px * cropped.dLng, cropped.lat0 + py * cropped.dLat];
}

export interface BuildMrmsVectorParams {
  decoded: DecodedGrid;
  grid: Grib2Grid;
  bounds: BoundingBox;
  date: string;
  refTime: string;
  sourceFile: string;
}

export function buildMrmsVectorCollection(
  params: BuildMrmsVectorParams,
): MrmsVectorCollection {
  const cropped = cropGrid(params.decoded, params.grid, params.bounds);
  const { width, height, values } = cropped;

  // mm thresholds → contour
  const thresholds = IHM_HAIL_LEVELS.map((b) => b.sizeMm);

  // d3-contour wants a flat array indexed [y*width + x] with row 0 at the
  // top. Our cropped grid already has row 0 at top because dLat is negative
  // (N→S scanning). Pass values as-is.
  const generator = contours()
    .size([width, height])
    .thresholds(thresholds)
    .smooth(true);

  // Convert NaN to -1 so contour tracing treats missing as "below threshold"
  // for thresholds > 0, which is what we want.
  const fillValues = new Float64Array(values.length);
  let maxValMm = 0;
  let hailCells = 0;
  for (let i = 0; i < values.length; i += 1) {
    const v = values[i];
    if (Number.isFinite(v) && v >= 0) {
      fillValues[i] = v;
      if (v >= IHM_HAIL_LEVELS[0].sizeMm) hailCells += 1;
      if (v > maxValMm) maxValMm = v;
    } else {
      fillValues[i] = -1;
    }
  }

  const features: MrmsVectorFeature[] = [];
  const polygons = generator(Array.from(fillValues));

  for (let level = 0; level < polygons.length; level += 1) {
    const band = IHM_HAIL_LEVELS[level];
    const multi = polygons[level];
    if (!multi || !multi.coordinates || multi.coordinates.length === 0) continue;

    const converted: number[][][][] = [];
    for (const polygon of multi.coordinates) {
      if (!polygon || polygon.length === 0) continue;
      const rings: number[][][] = [];
      for (let r = 0; r < polygon.length; r += 1) {
        const ring = polygon[r];
        if (!ring || ring.length < 4) continue;
        const simplifiedPx = simplifyRing(ring);
        const ringLatLng: number[][] = simplifiedPx.map(([px, py]) =>
          pixelToLngLat(px, py, cropped),
        );
        if (ringLatLng.length >= 4) rings.push(ringLatLng);
      }
      if (rings.length > 0) converted.push(rings);
    }
    if (converted.length === 0) continue;

    features.push({
      type: 'Feature',
      properties: {
        level,
        sizeInches: band.sizeInches,
        sizeMm: band.sizeMm,
        label: band.label,
        color: band.color,
        severity: band.severity,
      },
      geometry: { type: 'MultiPolygon', coordinates: converted },
    });
  }

  return {
    type: 'FeatureCollection',
    features,
    metadata: {
      date: params.date,
      refTime: params.refTime,
      bounds: params.bounds,
      maxHailInches: maxValMm / 25.4,
      hailCells,
      sourceFile: params.sourceFile,
      generatedAt: new Date().toISOString(),
      source: 'mrms-vector',
    },
  };
}
