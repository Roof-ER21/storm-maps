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
const IEM_VTEC_TIMEOUT_MS = Math.max(
  1_000,
  Number.parseInt(process.env.IEM_VTEC_FETCH_TIMEOUT_MS ?? '10000', 10) || 10_000,
);
const NWS_ALERTS_TIMEOUT_MS = Math.max(
  1_000,
  Number.parseInt(process.env.NWS_ALERTS_FETCH_TIMEOUT_MS ?? '8000', 10) || 8_000,
);
const NWS_ALERTS_FALLBACK_LOOKBACK_MS =
  Math.max(
    1,
    Number.parseInt(process.env.NWS_ALERTS_FALLBACK_LOOKBACK_DAYS ?? '7', 10) || 7,
  ) *
  24 *
  60 *
  60 *
  1000;
const NWS_ALERTS_FAILURE_THRESHOLD = 3;
const NWS_ALERTS_COOLDOWN_MS = 5 * 60_000;

export type WarningPhenomenon = 'SV' | 'TO' | 'FF' | 'EW';

export interface IemVtecWarning {
  /** Issue time ISO 8601 UTC. Full warning lifetime, not polygon segment. */
  issueIso: string;
  /** Expire time ISO 8601 UTC. Full warning lifetime, not polygon segment. */
  expireIso: string;
  /** Phenomenon code: SV=severe-thunderstorm, TO=tornado, FF=flash-flood, EW=extreme-wind. */
  phenomenon: WarningPhenomenon;
  /** Issuing forecast office (e.g. LWX, PHI, AKQ). */
  wfo: string;
  /** Polygon coordinates as [lng,lat] rings. */
  rings: number[][][];
  /** Free-text product/headline. May contain hail size. */
  product?: string;
  /** Official NWS-tagged hail size in inches (HAILTAG). */
  hailTagInches?: number;
  /** Official NWS-tagged wind speed in mph (WINDTAG). */
  windTagMph?: number;
  /** NWS product id for deduping multi-polygon-segment warnings. */
  productId?: string;
}

interface VtecApiFeature {
  properties: {
    issue?: string;
    /** SBW endpoint also returns `polygon_begin` / `polygon_end` per
     *  POLYGON SEGMENT (a 5-min slice as the storm moves). For displaying
     *  the warning duration to reps + adjusters we want issue/expire (the
     *  full warning lifetime). polygon_begin/end is kept around in case a
     *  consumer needs segment-level timing. */
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
    /** Official NWS hail size tag (inches). */
    hailtag?: number | string | null;
    /** Official NWS wind speed tag (mph). */
    windtag?: number | string | null;
    /** Tornado damage tag — present field, not currently used. */
    tornadotag?: string | null;
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

interface VtecFetchResult {
  warnings: IemVtecWarning[];
  ok: boolean;
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
  return (await fetchIemVtecWarningsWithStatus(q)).warnings;
}

async function fetchIemVtecWarningsWithStatus(
  q: IemVtecQuery,
): Promise<VtecFetchResult> {
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
  const timer = setTimeout(() => ac.abort(), IEM_VTEC_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ac.signal,
      headers: { 'User-Agent': 'HailYes/1.0 (storm-intelligence-app)' },
    });
    if (!res.ok) {
      if (shouldLogOptionalUpstreams() && !iemVtecHttpWarned.has(res.status)) {
        iemVtecHttpWarned.add(res.status);
        console.info(`[iem-vtec] optional archive HTTP ${res.status} (suppressing further)`);
      }
      return { warnings: [], ok: false };
    }
    const data = (await res.json()) as VtecApiResponse;
    return { warnings: parseFeatures(data.features ?? [], q.bounds, allowed), ok: true };
  } catch (err) {
    if (shouldLogOptionalUpstreams() && !isAbortLike(err) && !iemVtecFetchWarned) {
      iemVtecFetchWarned = true;
      console.info(
        '[iem-vtec] optional archive unavailable (suppressing further):',
        errorMessage(err),
      );
    }
    return { warnings: [], ok: false };
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

function shouldLogOptionalUpstreams(): boolean {
  return process.env.STORM_OPTIONAL_UPSTREAM_LOGS === '1';
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
    if (shouldLogOptionalUpstreams()) {
      console.info(
        `[nws-alerts] optional fallback disabled for ${Math.round(
          NWS_ALERTS_COOLDOWN_MS / 60_000,
        )} min after repeated failures; latest=${reason}`,
      );
    }
  }
}

function parseFeatures(
  features: VtecApiFeature[],
  bounds: BoundingBox | undefined,
  allowedPhenomena: Set<WarningPhenomenon>,
): IemVtecWarning[] {
  // Use a map keyed by product_id (or fallback eventid+wfo) so multi-
  // segment warnings (5-min polygon updates as a storm moves) collapse
  // to ONE entry. Reese (2026-04-30) flagged that Hail Yes was showing
  // a 5-min duration like "4:42 PM EDT until 4:47 PM EDT" instead of
  // the full warning lifetime "4:42 PM EDT until 5:30 PM EDT" — caused
  // by treating each polygon segment as a separate warning. We now
  // pick the FIRST segment we see for each product_id; rings track the
  // initial polygon (which is normally the broadest coverage area).
  const byProduct = new Map<string, IemVtecWarning>();
  let anonId = 0;
  for (const f of features) {
    if (!f.geometry || !f.properties) continue;
    const ph = f.properties.phenomena;
    if (!ph || !allowedPhenomena.has(ph as WarningPhenomenon)) continue;
    if (f.properties.significance && f.properties.significance !== 'W') continue;

    // Use issue/expire (full warning lifetime). Only fall through to
    // polygon_begin/polygon_end if the upstream is missing the full
    // window — older archive rows occasionally do.
    const issueIso =
      f.properties.issue ?? f.properties.polygon_begin ?? '';
    const expireIso =
      f.properties.expire ?? f.properties.polygon_end ?? '';
    if (!issueIso || !expireIso) continue;

    const rings = flattenPolygon(f.geometry);
    if (rings.length === 0) continue;

    if (bounds && !ringsIntersectBounds(rings, bounds)) continue;

    const productId =
      f.properties.product_id ??
      (f.properties.wfo && f.properties.eventid
        ? `${f.properties.wfo}-${f.properties.eventid}`
        : `anon-${(anonId += 1)}`);

    const hailTag = toNumberOrUndef(f.properties.hailtag);
    const windTag = toNumberOrUndef(f.properties.windtag);

    const existing = byProduct.get(productId);
    if (existing) {
      // Union polygon segments — pointInWarning needs to return true if
      // the property was in ANY segment. Without this, dedupe by-first
      // would miss properties covered by later segments only.
      for (const ring of rings) existing.rings.push(ring);
      // Tags stay from first segment; promote if missing.
      if (existing.hailTagInches === undefined && hailTag !== undefined) {
        existing.hailTagInches = hailTag;
      }
      if (existing.windTagMph === undefined && windTag !== undefined) {
        existing.windTagMph = windTag;
      }
      continue;
    }

    byProduct.set(productId, {
      issueIso,
      expireIso,
      phenomenon: ph as WarningPhenomenon,
      wfo: (f.properties.wfo ?? '').toUpperCase(),
      rings: [...rings],
      product: f.properties.product ?? f.properties.product_id,
      hailTagInches: hailTag,
      windTagMph: windTag,
      productId,
    });
  }
  return Array.from(byProduct.values());
}

function toNumberOrUndef(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
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
  const iemResult = await fetchIemVtecWarningsWithStatus({
    startIso: w.startUtc.toISOString(),
    endIso: w.endUtc.toISOString(),
    bounds: opts.bounds,
  });
  if (iemResult.ok || iemResult.warnings.length > 0) return iemResult.warnings;
  // Fall back to NWS api.weather.gov which is what SA21 uses and which
  // returns GeoJSON. Only use it when the archive fetch itself failed and
  // the date is recent enough for the NWS alerts API to be relevant. An
  // empty IEM archive response usually means "no warnings", not "fallback".
  if (!opts.bounds) return [];
  if (!shouldUseNwsAlertsFallback(w.startUtc, w.endUtc)) return [];
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

function shouldUseNwsAlertsFallback(
  startUtc: Date,
  endUtc: Date,
  now = Date.now(),
): boolean {
  return (
    endUtc.getTime() >= now - NWS_ALERTS_FALLBACK_LOOKBACK_MS &&
    startUtc.getTime() <= now + 24 * 60 * 60 * 1000
  );
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
  const timer = setTimeout(() => ac.abort(), NWS_ALERTS_TIMEOUT_MS);
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
        if (shouldLogOptionalUpstreams() && !nwsAlertsHttpWarned.has(res.status)) {
          nwsAlertsHttpWarned.add(res.status);
          console.info(`[nws-alerts] optional fallback HTTP ${res.status} (suppressing further)`);
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
    if (shouldLogOptionalUpstreams() && !isAbortLike(err) && !nwsAlertsFetchWarned) {
      nwsAlertsFetchWarned = true;
      console.info('[nws-alerts] optional fallback unavailable (suppressing further):', errorMessage(err));
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
