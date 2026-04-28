/**
 * IEM VTEC archive — historical NWS warnings (Severe Thunderstorm + Tornado).
 *
 * Endpoint:
 *   https://mesonet.agron.iastate.edu/geojson/sbw.geojson
 *     ?sts=ISO8601&ets=ISO8601&[wfo=XXX]
 *
 * Public — no key required. Returns GeoJSON FeatureCollection of "Storm
 * Based Warning" polygons with `phenomena`, `significance`, `issue`,
 * `expire`, plus a `wfo` (forecast office) tag. Goes back ~2003 to present.
 *
 * (Old `cgi-bin/request/gis/watchwarn.py?fmt=geojson` returns 422 since
 * IEM upgraded the param validator; the SBW GeoJSON endpoint is the live
 * replacement with parity coverage.)
 *
 * For consilience we use this to answer "did the NWS issue an SVR or
 * tornado warning over this property on this date?" — strong corroboration
 * because warnings are issued by humans (NWS forecasters) based on radar +
 * spotter reports.
 */

import type { BoundingBox } from './types.js';
import { etDayUtcWindow } from './timeUtils.js';

const IEM_VTEC_BASE = 'https://mesonet.agron.iastate.edu/geojson/sbw.geojson';
const FETCH_TIMEOUT_MS = 20_000;
const NWS_ALERTS_FAILURE_THRESHOLD = 3;
const NWS_ALERTS_COOLDOWN_MS = 5 * 60_000;

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
    /** SBW endpoint uses `polygon_begin` / `polygon_end` for the actual
     *  effective window. `expire` exists too but for some products it's
     *  the long-tail expiration (multi-day flood warnings etc.). */
    polygon_begin?: string;
    polygon_end?: string;
    expire?: string;
    phenomena?: string;
    significance?: string;
    wfo?: string;
    eventid?: number;
    /** SBW lookup link to the rendered product page. */
    product_id?: string;
    /** Legacy field kept for back-compat with older callers. */
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
  // SBW endpoint accepts ISO 8601 with second precision and a Z suffix.
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
  const allowed = new Set<WarningPhenomenon>(q.phenomena ?? ['SV', 'TO']);
  // SBW endpoint doesn't filter server-side by phenomena; we filter client-
  // side. Significance=W only (warnings, not watches/advisories) is enforced
  // in parseFeatures because some old archive features omit `significance`.
  const params = new URLSearchParams({
    sts: fmtIemTimestamp(q.startIso),
    ets: fmtIemTimestamp(q.endIso),
  });
  const url = `${IEM_VTEC_BASE}?${params.toString()}`;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ac.signal,
      headers: { 'User-Agent': 'HailYes/1.0 (storm-intelligence-app)' },
    });
    if (!res.ok) {
      if (!iemVtecHttpWarned.has(res.status)) {
        iemVtecHttpWarned.add(res.status);
        console.info(`[iem-vtec] optional archive HTTP ${res.status} (suppressing further)`);
      }
      return [];
    }
    const data = (await res.json()) as VtecApiResponse;
    return parseFeatures(data.features ?? [], q.bounds, allowed);
  } catch (err) {
    if (!isAbortLike(err) && !iemVtecFetchWarned) {
      iemVtecFetchWarned = true;
      console.info(
        '[iem-vtec] optional archive unavailable (suppressing further):',
        errorMessage(err),
      );
    }
    return [];
  } finally {
    clearTimeout(timer);
  }
}

const iemVtecHttpWarned = new Set<number>();
let iemVtecFetchWarned = false;
const nwsAlertsHttpWarned = new Set<number>();
let nwsAlertsFetchWarned = false;
let nwsAlertsConsecutiveFailures = 0;
let nwsAlertsCooldownUntil = 0;
let nwsAlertsCooldownWarned = false;

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isAbortLike(err: unknown): boolean {
  const maybe = err as { name?: unknown; message?: unknown };
  const name = typeof maybe.name === 'string' ? maybe.name : '';
  const message =
    typeof maybe.message === 'string' ? maybe.message.toLowerCase() : String(err).toLowerCase();
  return (
    name === 'AbortError' ||
    name === 'TimeoutError' ||
    message.includes('aborted') ||
    message.includes('timed out')
  );
}

function nwsAlertsFallbackDown(now = Date.now()): boolean {
  return now < nwsAlertsCooldownUntil;
}

function recordNwsAlertsSuccess(): void {
  nwsAlertsConsecutiveFailures = 0;
  nwsAlertsCooldownUntil = 0;
  nwsAlertsCooldownWarned = false;
}

function recordNwsAlertsFailure(reason: string, now = Date.now()): void {
  if (nwsAlertsFallbackDown(now)) return;
  nwsAlertsConsecutiveFailures += 1;
  if (nwsAlertsConsecutiveFailures < NWS_ALERTS_FAILURE_THRESHOLD) return;
  nwsAlertsCooldownUntil = now + NWS_ALERTS_COOLDOWN_MS;
  if (!nwsAlertsCooldownWarned) {
    nwsAlertsCooldownWarned = true;
    console.warn(
      `[nws-alerts] optional fallback disabled for ${Math.round(
        NWS_ALERTS_COOLDOWN_MS / 60_000,
      )} min after repeated failures; latest=${reason}`,
    );
  }
}

function parseFeatures(
  features: VtecApiFeature[],
  bounds: BoundingBox | undefined,
  allowedPhenomena: Set<WarningPhenomenon>,
): IemVtecWarning[] {
  const out: IemVtecWarning[] = [];
  for (const f of features) {
    if (!f.geometry || !f.properties) continue;
    const ph = f.properties.phenomena;
    if (!ph || !allowedPhenomena.has(ph as WarningPhenomenon)) continue;
    // SBW returns watches/advisories (sig A/Y) too — keep only warnings.
    if (f.properties.significance && f.properties.significance !== 'W') continue;
    // SBW issue/expire window: prefer polygon_begin/polygon_end (the
    // active polygon period). Fall back to issue/expire for back-compat
    // with the legacy watchwarn payload shape.
    const issueIso =
      f.properties.polygon_begin ?? f.properties.issue ?? '';
    const expireIso =
      f.properties.polygon_end ?? f.properties.expire ?? '';
    if (!issueIso || !expireIso) continue;

    const rings = flattenPolygon(f.geometry);
    if (rings.length === 0) continue;

    if (bounds && !ringsIntersectBounds(rings, bounds)) continue;

    out.push({
      issueIso,
      expireIso,
      phenomenon: ph as WarningPhenomenon,
      wfo: (f.properties.wfo ?? '').toUpperCase(),
      rings,
      product: f.properties.product ?? f.properties.product_id,
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
  if (nwsAlertsFallbackDown()) return [];

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

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url.toString(), {
      signal: ac.signal,
      headers: {
        'User-Agent': 'HailYes/1.0 (storm-intelligence-app marketing@theroofdocs.com)',
        Accept: 'application/geo+json',
      },
    });
    if (!res.ok) {
      if (res.status !== 404) {
        recordNwsAlertsFailure(`HTTP ${res.status}`);
        if (!nwsAlertsHttpWarned.has(res.status)) {
          nwsAlertsHttpWarned.add(res.status);
          console.warn(`[nws-alerts] HTTP ${res.status} (suppressing further)`);
        }
      }
      return [];
    }
    recordNwsAlertsSuccess();
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
    recordNwsAlertsFailure(errorMessage(err));
    if (!isAbortLike(err) && !nwsAlertsFetchWarned) {
      nwsAlertsFetchWarned = true;
      console.warn('[nws-alerts] fetch failed (suppressing further):', errorMessage(err));
    }
    return [];
  } finally {
    clearTimeout(timer);
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
