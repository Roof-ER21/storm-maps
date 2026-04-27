/**
 * Server-side geometry helpers. Pure math, no node-only dependencies — the
 * frontend can re-use this module too if needed.
 */

import type { BoundingBox } from './types.js';

const EARTH_RADIUS_MILES = 3958.8;

export function haversineMiles(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number,
): number {
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const sLat = Math.sin(dLat / 2);
  const sLng = Math.sin(dLng / 2);
  const h =
    sLat * sLat +
    Math.cos((aLat * Math.PI) / 180) *
      Math.cos((bLat * Math.PI) / 180) *
      sLng * sLng;
  return EARTH_RADIUS_MILES * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/**
 * Build a regular n-gon polygon (closed ring) of the given radius around a
 * lat/lng. Uses local equirectangular projection — accurate to ~0.5% for
 * small radii (<10 mi) and any latitude reps actually canvas in.
 */
export function bufferCircle(
  lat: number,
  lng: number,
  radiusMiles: number,
  steps = 24,
): number[][] {
  const ring: number[][] = [];
  const milesPerLat = 69;
  const milesPerLng = 69 * Math.max(0.05, Math.cos((lat * Math.PI) / 180));
  for (let i = 0; i <= steps; i += 1) {
    const angle = (i / steps) * Math.PI * 2;
    const dx = Math.cos(angle) * radiusMiles;
    const dy = Math.sin(angle) * radiusMiles;
    ring.push([lng + dx / milesPerLng, lat + dy / milesPerLat]);
  }
  return ring;
}

export function bboxFromBufferedReports(
  reports: { lat: number; lng: number; bufferMiles: number }[],
): BoundingBox | null {
  if (reports.length === 0) return null;
  let north = -Infinity;
  let south = Infinity;
  let east = -Infinity;
  let west = Infinity;
  for (const r of reports) {
    const milesPerLat = 69;
    const milesPerLng = 69 * Math.max(0.05, Math.cos((r.lat * Math.PI) / 180));
    const dLat = r.bufferMiles / milesPerLat;
    const dLng = r.bufferMiles / milesPerLng;
    north = Math.max(north, r.lat + dLat);
    south = Math.min(south, r.lat - dLat);
    east = Math.max(east, r.lng + dLng);
    west = Math.min(west, r.lng - dLng);
  }
  return { north, south, east, west };
}

export function expandBounds(
  bounds: BoundingBox,
  miles: number,
): BoundingBox {
  const meanLat = (bounds.north + bounds.south) / 2;
  const milesPerLat = 69;
  const milesPerLng = 69 * Math.max(0.05, Math.cos((meanLat * Math.PI) / 180));
  return {
    north: bounds.north + miles / milesPerLat,
    south: bounds.south - miles / milesPerLat,
    east: bounds.east + miles / milesPerLng,
    west: bounds.west - miles / milesPerLng,
  };
}

export function bboxContains(b: BoundingBox, lat: number, lng: number): boolean {
  return lat <= b.north && lat >= b.south && lng <= b.east && lng >= b.west;
}

/**
 * Even-odd point-in-ring (ring is [lng, lat][]). Stable for self-intersecting
 * polygons — won't matter here because we only test against simple buffers.
 */
export function pointInRing(lat: number, lng: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersect =
      yi > lat !== yj > lat &&
      lng < ((xj - xi) * (lat - yi)) / (yj - yi || 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Initial bearing (degrees, 0=N, clockwise) from a→b on the great circle.
 * Pure math — no haversine sqrt; just atan2 on rotated unit vectors.
 *
 * Used by computeStormDirectionAndSpeed (PDF Section 2 + Section 7
 * direction columns). Accurate to within a few tenths of a degree for
 * continental-US event spreads.
 */
export function bearingDegrees(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number,
): number {
  const φ1 = (aLat * Math.PI) / 180;
  const φ2 = (bLat * Math.PI) / 180;
  const Δλ = ((bLng - aLng) * Math.PI) / 180;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x =
    Math.cos(φ1) * Math.sin(φ2) -
    Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  const θ = Math.atan2(y, x);
  return ((θ * 180) / Math.PI + 360) % 360;
}

/**
 * Convert a 0–360° bearing to a 16-point compass label. Matches what
 * adjusters and reps say out loud ("northeast" / "south-southwest").
 * Falls back to "—" for non-finite input.
 */
export function bearingToCardinal(degrees: number | null | undefined): string {
  if (degrees === null || degrees === undefined || !Number.isFinite(degrees)) {
    return '—';
  }
  const POINTS = [
    'N', 'NNE', 'NE', 'ENE',
    'E', 'ESE', 'SE', 'SSE',
    'S', 'SSW', 'SW', 'WSW',
    'W', 'WNW', 'NW', 'NNW',
  ];
  // Normalize to [0, 360), then bucket into 22.5° wedges with -11.25° offset.
  const norm = ((degrees % 360) + 360) % 360;
  const idx = Math.floor((norm + 11.25) / 22.5) % 16;
  return POINTS[idx];
}

/**
 * Coarse cardinal — N / NE / E / SE / S / SW / W / NW (8-point) +
 * spelled-out word matching the target reference PDF ("East", "Northeast"…).
 * Sub-cardinals collapse to the nearest 8-point.
 */
export function bearingToCardinalWord(degrees: number | null | undefined): string {
  if (degrees === null || degrees === undefined || !Number.isFinite(degrees)) {
    return '—';
  }
  const norm = ((degrees % 360) + 360) % 360;
  const POINTS = ['North', 'Northeast', 'East', 'Southeast', 'South', 'Southwest', 'West', 'Northwest'];
  const idx = Math.floor((norm + 22.5) / 45) % 8;
  return POINTS[idx];
}

/**
 * Minimum distance (miles) from (lat, lng) to any segment in a closed ring.
 * Ring is [lng, lat][]. Local equirectangular projection — accurate to ~0.5%
 * for small distances at any continental US latitude.
 *
 * Used for the swath near-miss buffer: a property within ~0.1mi of a ≥0.5"
 * polygon edge counts as a DIRECT HIT (matches HailTrace's edge tolerance).
 */
export function nearestRingDistanceMiles(
  lat: number,
  lng: number,
  ring: number[][],
): number {
  if (ring.length < 2) return Infinity;
  const milesPerLat = 69;
  const milesPerLng = 69 * Math.max(0.05, Math.cos((lat * Math.PI) / 180));
  const px = lng * milesPerLng;
  const py = lat * milesPerLat;
  let min = Infinity;
  for (let i = 0; i < ring.length - 1; i += 1) {
    const ax = ring[i][0] * milesPerLng;
    const ay = ring[i][1] * milesPerLat;
    const bx = ring[i + 1][0] * milesPerLng;
    const by = ring[i + 1][1] * milesPerLat;
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let t = 0;
    if (len2 > 1e-12) {
      t = ((px - ax) * dx + (py - ay) * dy) / len2;
      if (t < 0) t = 0;
      else if (t > 1) t = 1;
    }
    const cx = ax + dx * t;
    const cy = ay + dy * t;
    const ddx = px - cx;
    const ddy = py - cy;
    const d = Math.sqrt(ddx * ddx + ddy * ddy);
    if (d < min) min = d;
  }
  return min;
}
