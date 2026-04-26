/**
 * Server-side NWS Severe Thunderstorm Warning fetcher. Pulls **active**
 * polygons (used by the live now-cast layer) and parses maxWindGust so each
 * polygon can be assigned to a wind band.
 */

import type { BoundingBox, WindReport } from './types.js';

const NWS_BASE = 'https://api.weather.gov';
const NWS_HEADERS = {
  'User-Agent': '(HailYes, contact@roofer21.com)',
  Accept: 'application/geo+json',
};
const FETCH_TIMEOUT_MS = 15_000;

interface NwsAlertGeometry {
  type: 'Polygon' | 'MultiPolygon' | 'Point';
  coordinates: number[] | number[][] | number[][][] | number[][][][];
}

export interface NwsSvrPolygon {
  id: string;
  headline: string;
  areaDesc: string;
  maxWindGustMph: number;
  onset: string;
  expires: string;
  geometry: NwsAlertGeometry;
}

interface NwsApiFeature {
  id?: string;
  geometry?: NwsAlertGeometry | null;
  properties?: {
    '@id'?: string;
    id?: string;
    event?: string;
    headline?: string | null;
    description?: string | null;
    areaDesc?: string | null;
    onset?: string | null;
    expires?: string | null;
    parameters?: { maxWindGust?: string[] } | null;
  };
}

interface NwsApiResponse {
  features?: NwsApiFeature[];
}

function parseGust(arr?: string[] | null): number {
  if (!arr || arr.length === 0) return 0;
  const m = arr[0].match(/(\d+(?:\.\d+)?)/);
  return m ? parseFloat(m[1]) : 0;
}

function parseGustFromDesc(desc?: string | null): number {
  if (!desc) return 0;
  const m = desc.toUpperCase().match(/(\d+)\s*MPH/);
  return m ? parseFloat(m[1]) : 0;
}

function bboxIntersectsGeometry(
  bounds: BoundingBox,
  g: NwsAlertGeometry,
): boolean {
  const acc = (coords: number[][]) => {
    for (const [lng, lat] of coords) {
      if (
        lat <= bounds.north &&
        lat >= bounds.south &&
        lng <= bounds.east &&
        lng >= bounds.west
      ) {
        return true;
      }
    }
    return false;
  };
  if (g.type === 'Polygon') {
    for (const ring of g.coordinates as number[][][]) {
      if (acc(ring)) return true;
    }
  } else if (g.type === 'MultiPolygon') {
    for (const poly of g.coordinates as number[][][][]) {
      for (const ring of poly) if (acc(ring)) return true;
    }
  } else if (g.type === 'Point') {
    const [lng, lat] = g.coordinates as number[];
    if (
      lat <= bounds.north &&
      lat >= bounds.south &&
      lng <= bounds.east &&
      lng >= bounds.west
    ) {
      return true;
    }
  }
  return false;
}

export async function fetchActiveSvrPolygons(opts: {
  bounds?: BoundingBox | null;
}): Promise<NwsSvrPolygon[]> {
  const params = new URLSearchParams({
    event: 'Severe Thunderstorm Warning',
    status: 'actual',
    message_type: 'alert',
  });
  const url = `${NWS_BASE}/alerts/active?${params.toString()}`;
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(url, { headers: NWS_HEADERS, signal: ac.signal });
    clearTimeout(timer);
    if (!res.ok) return [];
    const data = (await res.json()) as NwsApiResponse;
    const features = data.features ?? [];
    const out: NwsSvrPolygon[] = [];
    for (const f of features) {
      if (!f.geometry || !f.properties) continue;
      if (opts.bounds && !bboxIntersectsGeometry(opts.bounds, f.geometry)) continue;
      const gust =
        parseGust(f.properties.parameters?.maxWindGust) ||
        parseGustFromDesc(f.properties.description);
      if (gust < 50) continue;
      const rawId =
        f.properties['@id'] ??
        f.properties.id ??
        f.id ??
        `nws-${out.length}-${Date.now()}`;
      const id = rawId.includes('/')
        ? rawId.slice(rawId.lastIndexOf('/') + 1)
        : rawId;
      out.push({
        id,
        headline: f.properties.headline ?? f.properties.event ?? 'SVR Warning',
        areaDesc: f.properties.areaDesc ?? '',
        maxWindGustMph: gust,
        onset: f.properties.onset ?? '',
        expires: f.properties.expires ?? '',
        geometry: f.geometry,
      });
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Convert active SVR polygons into representative wind point reports. Each
 * polygon is reduced to its centroid + the parsed gust, suitable for blending
 * into the same buffered-disk pipeline as SPC/IEM data.
 */
export function svrPolygonsAsReports(polys: NwsSvrPolygon[]): WindReport[] {
  const out: WindReport[] = [];
  for (const p of polys) {
    if (!p.geometry || p.geometry.type === 'Point') continue;
    const centroid = polygonCentroid(p.geometry);
    if (!centroid) continue;
    out.push({
      id: `svr-${p.id}`,
      time: p.onset,
      lat: centroid.lat,
      lng: centroid.lng,
      gustMph: p.maxWindGustMph,
      source: 'NWS-SVR',
      description: p.headline,
    });
  }
  return out;
}

function polygonCentroid(
  g: NwsAlertGeometry,
): { lat: number; lng: number } | null {
  let total = 0;
  let sumLat = 0;
  let sumLng = 0;

  const visit = (ring: number[][]) => {
    for (const [lng, lat] of ring) {
      sumLng += lng;
      sumLat += lat;
      total += 1;
    }
  };

  if (g.type === 'Polygon') {
    for (const ring of g.coordinates as number[][][]) visit(ring);
  } else if (g.type === 'MultiPolygon') {
    for (const poly of g.coordinates as number[][][][]) {
      for (const ring of poly) visit(ring);
    }
  } else {
    return null;
  }
  if (total === 0) return null;
  return { lat: sumLat / total, lng: sumLng / total };
}
