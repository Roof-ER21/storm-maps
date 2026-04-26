/**
 * Building-footprint fetcher — pulls the actual house outline from
 * OpenStreetMap via Overpass API so the map can show reps the roof
 * they're about to inspect, not just a lot boundary.
 *
 * Why OSM instead of county ArcGIS:
 *   - County ArcGIS URLs change frequently (Loudoun + Fairfax both
 *     went stale in this codebase). Each county is its own snowflake.
 *   - OSM coverage is nationwide, free, and the polygons are the
 *     actual building footprints — more visually meaningful for a
 *     roofing rep than an abstract parcel boundary.
 *
 * Returns the closest building footprint (by centroid) within a
 * configurable search radius around the searched point. Soft-fails
 * when no building is mapped at that location — the layer just
 * stays empty.
 */

const OVERPASS_BASE = 'https://overpass-api.de/api/interpreter';
const FETCH_TIMEOUT_MS = 8_000;
/** Search radius in meters — captures the house at the searched coord. */
const SEARCH_RADIUS_M = 35;

export interface ParcelGeometry {
  /** Polygon outer rings ([lng, lat][]). Single ring for OSM building. */
  rings: number[][][];
  /** OSM tag — "house", "residential", "yes", etc. */
  buildingType: string;
  /** OSM way ID for traceability. */
  osmId: number;
  /** Approximate centroid lng/lat for label/legend positioning. */
  centroid: { lat: number; lng: number };
  /** Source identifier — "osm-building" so callers can attribute. */
  source: 'osm-building';
}

interface OverpassNode {
  lat: number;
  lon: number;
}

interface OverpassWay {
  type: 'way';
  id: number;
  geometry?: OverpassNode[];
  tags?: Record<string, string>;
}

interface OverpassResponse {
  elements?: OverpassWay[];
}

function ringCentroid(ring: number[][]): { lat: number; lng: number } | null {
  if (ring.length === 0) return null;
  let sumLat = 0;
  let sumLng = 0;
  for (const [lng, lat] of ring) {
    sumLat += lat;
    sumLng += lng;
  }
  return { lat: sumLat / ring.length, lng: sumLng / ring.length };
}

function haversineMeters(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number,
): number {
  const R = 6371000;
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
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/**
 * Fetch the closest building footprint at this lat/lng from OpenStreetMap.
 * Returns null when no building is mapped within the search radius or
 * the upstream call fails.
 */
export async function fetchParcelGeometry(
  lat: number,
  lng: number,
  timeoutMs = FETCH_TIMEOUT_MS,
): Promise<ParcelGeometry | null> {
  // Overpass QL: get every way tagged building within radius. `out geom`
  // includes the per-node lat/lon so we don't need a follow-up node-fetch.
  const query =
    `[out:json][timeout:${Math.floor(timeoutMs / 1000)}];` +
    `way["building"](around:${SEARCH_RADIUS_M},${lat},${lng});` +
    `out geom;`;

  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    const res = await fetch(OVERPASS_BASE, {
      method: 'POST',
      signal: ac.signal,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
        'User-Agent': 'HailYes/1.0 (storm-intelligence-app)',
      },
      body: `data=${encodeURIComponent(query)}`,
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = (await res.json()) as OverpassResponse;
    const ways = data.elements ?? [];
    if (ways.length === 0) return null;

    // Pick the building whose centroid is closest to the searched point.
    let best: { way: OverpassWay; ring: number[][]; distance: number } | null = null;
    for (const way of ways) {
      if (!way.geometry || way.geometry.length < 3) continue;
      const ring: number[][] = way.geometry
        .filter((n) => Number.isFinite(n.lat) && Number.isFinite(n.lon))
        .map((n) => [n.lon, n.lat]);
      if (ring.length < 3) continue;
      const c = ringCentroid(ring);
      if (!c) continue;
      const d = haversineMeters(lat, lng, c.lat, c.lng);
      if (!best || d < best.distance) {
        best = { way, ring, distance: d };
      }
    }
    if (!best) return null;

    const centroid = ringCentroid(best.ring) ?? { lat, lng };
    return {
      rings: [best.ring],
      buildingType: best.way.tags?.building ?? 'yes',
      osmId: best.way.id,
      centroid,
      source: 'osm-building',
    };
  } catch {
    return null;
  }
}
