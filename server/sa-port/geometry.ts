/**
 * Pure-math geometry helpers for storm-archive. No Node-specific deps;
 * usable from any JS runtime including the browser.
 *
 * Lifted from Hail Yes (storm-maps/server/storm/geometry.ts) which has been
 * proven against millions of point-in-polygon queries in production.
 */

export interface BoundingBox {
  north: number;
  south: number;
  east: number;
  west: number;
}

const EARTH_RADIUS_MILES = 3958.8;

/** Great-circle distance in miles between two lat/lng points. */
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
      sLng *
      sLng;
  return EARTH_RADIUS_MILES * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/**
 * Build a regular n-gon polygon (closed ring) of the given radius around a
 * lat/lng. Uses local equirectangular projection — accurate to ~0.5% for
 * radii under ~10 mi at any continental US latitude.
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

export function expandBounds(bounds: BoundingBox, miles: number): BoundingBox {
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
 * polygons too.
 */
export function pointInRing(lat: number, lng: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!;
    const b = ring[j]!;
    const xi = a[0]!;
    const yi = a[1]!;
    const xj = b[0]!;
    const yj = b[1]!;
    const intersect =
      yi > lat !== yj > lat &&
      lng < ((xj - xi) * (lat - yi)) / (yj - yi || 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * MultiPolygon containment with hole support. coordinates is the GeoJSON
 * MultiPolygon coordinates array: number[polygon][ring][point][lng,lat].
 * Outer ring of each polygon = inclusion; subsequent rings = holes.
 */
export function pointInMultiPolygon(
  lat: number,
  lng: number,
  coordinates: number[][][][],
): boolean {
  for (const polygon of coordinates) {
    if (polygon.length === 0) continue;
    const outer = polygon[0]!;
    if (!pointInRing(lat, lng, outer)) continue;
    let inHole = false;
    for (let i = 1; i < polygon.length; i += 1) {
      if (pointInRing(lat, lng, polygon[i]!)) {
        inHole = true;
        break;
      }
    }
    if (!inHole) return true;
  }
  return false;
}

/**
 * Minimum distance (miles) from (lat, lng) to any segment in a closed ring.
 * Local equirectangular projection — accurate to ~0.5% for distances under
 * a few miles.
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
    const a = ring[i]!;
    const b = ring[i + 1]!;
    const ax = a[0]! * milesPerLng;
    const ay = a[1]! * milesPerLat;
    const bx = b[0]! * milesPerLng;
    const by = b[1]! * milesPerLat;
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

/** Initial bearing 0–360 (N=0, clockwise) on great circle a→b. */
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

const COMPASS_16 = [
  "N", "NNE", "NE", "ENE",
  "E", "ESE", "SE", "SSE",
  "S", "SSW", "SW", "WSW",
  "W", "WNW", "NW", "NNW",
] as const;

export function bearingToCardinal(degrees: number | null | undefined): string {
  if (degrees == null || !Number.isFinite(degrees)) return "—";
  const norm = ((degrees % 360) + 360) % 360;
  const idx = Math.floor((norm + 11.25) / 22.5) % 16;
  return COMPASS_16[idx]!;
}
