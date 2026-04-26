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
  // IEM upgraded the watchwarn endpoint to Pydantic-validated query
  // params expecting ISO 8601 (e.g. 2025-05-03T04:00:00Z). Sending the
  // legacy YYYYMMDDHHMM format returns HTTP 422 with no warnings —
  // which is what was silently breaking the consilience NWS-warnings
  // source AND the new PDF Active NWS Warnings panel.
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
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
  // Try IEM VTEC first (legacy path; might work for older queries).
  const iemResult = await fetchIemVtecWarnings({
    startIso: w.startUtc.toISOString(),
    endIso: w.endUtc.toISOString(),
    bounds: opts.bounds,
  });
  if (iemResult.length > 0) return iemResult;
  // Fall back to NWS api.weather.gov which is what SA21 uses and which
  // actually returns GeoJSON (IEM watchwarn returns ZIP shapefile only,
  // and `fmt=geojson` is silently ignored by the upgraded endpoint).
  if (!opts.bounds) return [];
  const lat = (opts.bounds.north + opts.bounds.south) / 2;
  const lng = (opts.bounds.east + opts.bounds.west) / 2;
  return fetchNwsAlertsForPoint({
    lat,
    lng,
    startIso: w.startUtc.toISOString(),
    endIso: w.endUtc.toISOString(),
    bounds: opts.bounds,
  });
}

/** Fetch warnings/alerts from api.weather.gov for a property point and a
 *  time window. Returns IemVtecWarning[] for parity with the existing
 *  point-in-polygon helpers downstream. */
async function fetchNwsAlertsForPoint(opts: {
  lat: number;
  lng: number;
  startIso: string;
  endIso: string;
  bounds?: BoundingBox;
}): Promise<IemVtecWarning[]> {
  const url = new URL('https://api.weather.gov/alerts');
  url.searchParams.set('point', `${opts.lat.toFixed(4)},${opts.lng.toFixed(4)}`);
  url.searchParams.set('start', new Date(opts.startIso).toISOString());
  url.searchParams.set('end', new Date(opts.endIso).toISOString());
  url.searchParams.set('status', 'actual');
  url.searchParams.set('message_type', 'alert');
  url.searchParams.set(
    'event',
    'Severe Thunderstorm Warning,Tornado Warning,Flash Flood Warning,Extreme Wind Warning',
  );

  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(url.toString(), {
      signal: ac.signal,
      headers: {
        'User-Agent': 'HailYes/1.0 (storm-intelligence-app marketing@theroofdocs.com)',
        Accept: 'application/geo+json',
      },
    });
    clearTimeout(timer);
    if (!res.ok) {
      if (res.status !== 404) {
        console.warn(`[nws-alerts] HTTP ${res.status}`);
      }
      return [];
    }
    const data = (await res.json()) as {
      features?: Array<{
        properties?: {
          event?: string;
          onset?: string;
          effective?: string;
          expires?: string;
          ends?: string;
          description?: string;
          headline?: string;
          senderName?: string;
        };
        geometry?: VtecApiFeature['geometry'];
      }>;
    };
    const features = data.features ?? [];
    const out: IemVtecWarning[] = [];
    for (const f of features) {
      const p = f.properties ?? {};
      const event = (p.event ?? '').toLowerCase();
      let phenomenon: WarningPhenomenon | null = null;
      if (event.includes('tornado')) phenomenon = 'TO';
      else if (event.includes('severe thunderstorm')) phenomenon = 'SV';
      else if (event.includes('flash flood')) phenomenon = 'FF';
      else if (event.includes('extreme wind')) phenomenon = 'EW';
      else continue;
      const issueIso = p.onset ?? p.effective ?? '';
      const expireIso = p.expires ?? p.ends ?? '';
      if (!issueIso || !expireIso) continue;
      // Geometry may be null for zone-based alerts (county-level only). In
      // that case treat the property point as inside via a synthetic ring
      // around the property — the api.weather.gov ?point query already
      // confirmed this alert applies to that point.
      const rings = f.geometry ? flattenPolygon(f.geometry) : [];
      const finalRings: number[][][] =
        rings.length > 0
          ? rings
          : [
              [
                [opts.lng - 0.05, opts.lat - 0.05],
                [opts.lng + 0.05, opts.lat - 0.05],
                [opts.lng + 0.05, opts.lat + 0.05],
                [opts.lng - 0.05, opts.lat + 0.05],
                [opts.lng - 0.05, opts.lat - 0.05],
              ],
            ];
      out.push({
        issueIso,
        expireIso,
        phenomenon,
        wfo: (p.senderName ?? '').replace(/^NWS\s+/i, '').slice(0, 4).toUpperCase(),
        rings: finalRings,
        product: p.description ?? p.headline ?? '',
      });
    }
    return out;
  } catch (err) {
    console.warn('[nws-alerts] fetch failed:', (err as Error).message);
    return [];
  }
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
