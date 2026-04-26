/**
 * IEM VTEC archive — historical NWS warnings (Severe Thunderstorm + Tornado).
 *
 * Endpoint:
 *   https://mesonet.agron.iastate.edu/cgi-bin/request/gis/watchwarn.py
 *     ?sts=YYYYMMDDHHMM&ets=YYYYMMDDHHMM&ph=SV,TO&fmt=geojson
 *
 * Public — no key required. Returns GeoJSON FeatureCollection of warning
 * polygons with `phenomena`, `issue`, `expire`, plus a `wfo` (forecast
 * office) tag.
 *
 * For consilience we use this to answer "did the NWS issue an SVR or
 * tornado warning over this property on this date?" — strong corroboration
 * because warnings are issued by humans (NWS forecasters) based on radar +
 * spotter reports.
 */

import type { BoundingBox } from './types.js';
import { etDayUtcWindow } from './timeUtils.js';

const IEM_VTEC_BASE = 'https://mesonet.agron.iastate.edu/cgi-bin/request/gis/watchwarn.py';
const FETCH_TIMEOUT_MS = 15_000;

export type WarningPhenomenon = 'SV' | 'TO' | 'FF' | 'EW';

export interface IemVtecWarning {
  /** Issue time ISO 8601 UTC. */
  issueIso: string;
  /** Expire time ISO 8601 UTC. */
  expireIso: string;
  /** Phenomenon code: SV=severe-thunderstorm, TO=tornado, FF=flash-flood, EW=extreme-wind. */
  phenomenon: WarningPhenomenon;
  /** Issuing forecast office (e.g. LWX, PHI, AKQ). */
  wfo: string;
  /** Polygon coordinates as [lng,lat] rings. */
  rings: number[][][];
  /** Free-text product/headline. May contain hail size. */
  product?: string;
}

interface VtecApiFeature {
  properties: {
    issue?: string;
    expire?: string;
    phenomena?: string;
    significance?: string;
    wfo?: string;
    eventid?: number;
    product?: string;
    productlink?: string;
  };
  geometry?: {
    type: 'Polygon' | 'MultiPolygon';
    coordinates: number[][][] | number[][][][];
  };
}

interface VtecApiResponse {
  type: 'FeatureCollection';
  features: VtecApiFeature[];
}

function fmtIemTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const min = String(d.getUTCMinutes()).padStart(2, '0');
  return `${yyyy}${mm}${dd}${hh}${min}`;
}

export interface IemVtecQuery {
  startIso: string;
  endIso: string;
  /** Phenomena to include. Default ['SV', 'TO']. */
  phenomena?: WarningPhenomenon[];
  /** Optional bbox filter applied client-side (server returns CONUS). */
  bounds?: BoundingBox;
}

export async function fetchIemVtecWarnings(
  q: IemVtecQuery,
): Promise<IemVtecWarning[]> {
  const phen = (q.phenomena ?? ['SV', 'TO']).join(',');
  const params = new URLSearchParams({
    sts: fmtIemTimestamp(q.startIso),
    ets: fmtIemTimestamp(q.endIso),
    ph: phen,
    fmt: 'geojson',
  });
  const url = `${IEM_VTEC_BASE}?${params.toString()}`;
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(url, {
      signal: ac.signal,
      headers: { 'User-Agent': 'HailYes/1.0 (storm-intelligence-app)' },
    });
    clearTimeout(timer);
    if (!res.ok) {
      console.warn(`[iem-vtec] HTTP ${res.status}`);
      return [];
    }
    const data = (await res.json()) as VtecApiResponse;
    return parseFeatures(data.features ?? [], q.bounds);
  } catch (err) {
    console.warn('[iem-vtec] fetch failed:', (err as Error).message);
    return [];
  }
}

function parseFeatures(
  features: VtecApiFeature[],
  bounds?: BoundingBox,
): IemVtecWarning[] {
  const out: IemVtecWarning[] = [];
  for (const f of features) {
    if (!f.geometry || !f.properties) continue;
    const ph = f.properties.phenomena;
    if (!ph || !['SV', 'TO', 'FF', 'EW'].includes(ph)) continue;
    if (!f.properties.issue || !f.properties.expire) continue;

    const rings = flattenPolygon(f.geometry);
    if (rings.length === 0) continue;

    if (bounds && !ringsIntersectBounds(rings, bounds)) continue;

    out.push({
      issueIso: f.properties.issue,
      expireIso: f.properties.expire,
      phenomenon: ph as WarningPhenomenon,
      wfo: (f.properties.wfo ?? '').toUpperCase(),
      rings,
      product: f.properties.product,
    });
  }
  return out;
}

function flattenPolygon(geom: NonNullable<VtecApiFeature['geometry']>): number[][][] {
  if (geom.type === 'Polygon') {
    return [geom.coordinates as number[][]];
  }
  // MultiPolygon — flatten each polygon's outer ring.
  const out: number[][][] = [];
  for (const polygon of geom.coordinates as number[][][][]) {
    if (polygon.length > 0) out.push(polygon[0]);
  }
  return out;
}

function ringsIntersectBounds(
  rings: number[][][],
  bounds: BoundingBox,
): boolean {
  // Quick bbox-overlap test. Rings here are already outer rings (number[][]).
  for (const ring of rings) {
    let minLat = Infinity;
    let maxLat = -Infinity;
    let minLng = Infinity;
    let maxLng = -Infinity;
    for (const [lng, lat] of ring) {
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
    }
    if (
      maxLat >= bounds.south &&
      minLat <= bounds.north &&
      maxLng >= bounds.west &&
      minLng <= bounds.east
    ) {
      return true;
    }
  }
  return false;
}

/** Pulls all SV+TO warnings for an Eastern calendar date. */
export async function fetchIemVtecForDate(opts: {
  date: string;
  bounds?: BoundingBox;
}): Promise<IemVtecWarning[]> {
  const w = etDayUtcWindow(opts.date);
  return fetchIemVtecWarnings({
    startIso: w.startUtc.toISOString(),
    endIso: w.endUtc.toISOString(),
    bounds: opts.bounds,
  });
}

/** Point-in-ring test — used to check if property is inside any warning polygon. */
export function pointInWarning(
  lat: number,
  lng: number,
  warning: IemVtecWarning,
): boolean {
  for (const ring of warning.rings) {
    if (pointInRing(lat, lng, ring)) return true;
  }
  return false;
}

function pointInRing(lat: number, lng: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersect =
      yi > lat !== yj > lat &&
      lng < ((xj - xi) * (lat - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}
