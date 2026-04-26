/**
 * Shared geographic geometry helpers used across overlays, fallbacks, and
 * impact badges. Pure functions — no React, no DOM, no Google Maps imports —
 * so they work both in the browser and inside server-side fallback code.
 */

import type {
  GeoJsonLineString,
  GeoJsonMultiLineString,
  GeoJsonMultiPolygon,
  GeoJsonPolygon,
  LatLng,
  BoundingBox,
} from '../types/storm';

const EARTH_RADIUS_MILES = 3958.8;
const SQ_KM_PER_SQ_MILE = 2.589988110336;

type AnyGeoJsonGeometry =
  | GeoJsonPolygon
  | GeoJsonMultiPolygon
  | GeoJsonLineString
  | GeoJsonMultiLineString;

/**
 * Spherical-excess polygon area in square miles.
 * Accurate to within ~0.1% for storm-cell-sized polygons (<1000 sq mi)
 * and avoids the equirectangular distortion that a flat-earth shoelace
 * would introduce at higher latitudes.
 */
export function ringAreaSqMiles(ring: number[][]): number {
  if (ring.length < 3) return 0;
  let total = 0;
  const n = ring.length;
  for (let i = 0; i < n; i += 1) {
    const [lng1, lat1] = ring[i];
    const [lng2, lat2] = ring[(i + 1) % n];
    const dLng = ((lng2 - lng1) * Math.PI) / 180;
    const sinLat1 = Math.sin((lat1 * Math.PI) / 180);
    const sinLat2 = Math.sin((lat2 * Math.PI) / 180);
    total += dLng * (2 + sinLat1 + sinLat2);
  }
  // R² has units miles², so the result is already in square miles.
  return Math.abs((total * EARTH_RADIUS_MILES * EARTH_RADIUS_MILES) / 2);
}

export function polygonAreaSqMiles(polygon: number[][][]): number {
  if (polygon.length === 0) return 0;
  // First ring is outer; subsequent rings are holes.
  let area = ringAreaSqMiles(polygon[0]);
  for (let i = 1; i < polygon.length; i += 1) {
    area -= ringAreaSqMiles(polygon[i]);
  }
  return Math.max(0, area);
}

export function geometryAreaSqMiles(geometry: AnyGeoJsonGeometry): number {
  if (geometry.type === 'Polygon') {
    return polygonAreaSqMiles(geometry.coordinates);
  }
  if (geometry.type === 'MultiPolygon') {
    let total = 0;
    for (const polygon of geometry.coordinates) {
      total += polygonAreaSqMiles(polygon);
    }
    return total;
  }
  return 0;
}

export function haversineDistanceMiles(
  a: LatLng,
  b: LatLng,
): number {
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h =
    sinLat * sinLat +
    Math.cos((a.lat * Math.PI) / 180) *
      Math.cos((b.lat * Math.PI) / 180) *
      sinLng * sinLng;
  return EARTH_RADIUS_MILES * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/** Even-odd point-in-ring test; ring is [lng,lat][]. */
export function pointInRing(point: LatLng, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = [ring[i][0], ring[i][1]];
    const [xj, yj] = [ring[j][0], ring[j][1]];
    const intersect =
      yi > point.lat !== yj > point.lat &&
      point.lng < ((xj - xi) * (point.lat - yi)) / (yj - yi || 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function pointInPolygon(point: LatLng, polygon: number[][][]): boolean {
  if (polygon.length === 0) return false;
  if (!pointInRing(point, polygon[0])) return false;
  for (let i = 1; i < polygon.length; i += 1) {
    if (pointInRing(point, polygon[i])) return false;
  }
  return true;
}

export function pointInGeometry(
  point: LatLng,
  geometry: AnyGeoJsonGeometry,
): boolean {
  if (geometry.type === 'Polygon') {
    return pointInPolygon(point, geometry.coordinates);
  }
  if (geometry.type === 'MultiPolygon') {
    for (const polygon of geometry.coordinates) {
      if (pointInPolygon(point, polygon)) return true;
    }
  }
  return false;
}

export function bboxFromGeometry(
  geometry: AnyGeoJsonGeometry,
): BoundingBox | null {
  let north = -Infinity;
  let south = Infinity;
  let east = -Infinity;
  let west = Infinity;
  let any = false;

  const acc = (coords: number[][]) => {
    for (const [lng, lat] of coords) {
      if (lng < west) west = lng;
      if (lng > east) east = lng;
      if (lat < south) south = lat;
      if (lat > north) north = lat;
      any = true;
    }
  };

  if (geometry.type === 'Polygon') {
    for (const ring of geometry.coordinates) acc(ring);
  } else if (geometry.type === 'MultiPolygon') {
    for (const poly of geometry.coordinates) {
      for (const ring of poly) acc(ring);
    }
  } else if (geometry.type === 'LineString') {
    acc(geometry.coordinates);
  } else if (geometry.type === 'MultiLineString') {
    for (const line of geometry.coordinates) acc(line);
  }

  if (!any) return null;
  return { north, south, east, west };
}

export function bboxIntersects(a: BoundingBox, b: BoundingBox): boolean {
  return !(
    a.east < b.west ||
    a.west > b.east ||
    a.north < b.south ||
    a.south > b.north
  );
}

export function expandBoundsMiles(
  bounds: BoundingBox,
  miles: number,
): BoundingBox {
  const meanLat = (bounds.north + bounds.south) / 2;
  const milesPerLat = 69;
  const milesPerLng = 69 * Math.cos((meanLat * Math.PI) / 180);
  const dLat = miles / milesPerLat;
  const dLng = miles / Math.max(0.001, milesPerLng);
  return {
    north: bounds.north + dLat,
    south: bounds.south - dLat,
    east: bounds.east + dLng,
    west: bounds.west - dLng,
  };
}

/** Convert km² → sq mi (used by NHP fallback). */
export function sqKmToSqMi(km2: number): number {
  return km2 / SQ_KM_PER_SQ_MILE;
}
