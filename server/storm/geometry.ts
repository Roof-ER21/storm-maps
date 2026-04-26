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
