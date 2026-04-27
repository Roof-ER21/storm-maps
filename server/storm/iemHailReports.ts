/**
 * IEM Local Storm Reports — hail variant. Same shape as `iemLsr.ts` (wind).
 *
 * Endpoint:
 *   https://mesonet.agron.iastate.edu/geojson/lsr.geojson
 *     ?sts=YYYYMMDDHHMI&ets=YYYYMMDDHHMI&[states=VA,MD,...]
 *
 * (Old `cgi-bin/request/gis/lsr.py` no longer accepts `fmt=geojson`; it
 * returned 422 with `pattern '^(csv|kml|excel|shp)$'`. The geojson endpoint
 * still serves the same FeatureCollection shape and accepts a comma-separated
 * `states=` filter rather than repeating `state=`.)
 *
 * Filters server-side responses to type='H' (hail) and applies the optional
 * client bbox before returning.
 */

import type { BoundingBox } from './types.js';
import type { HailPointReport } from './spcHailReports.js';
import { etDayUtcWindow } from './timeUtils.js';

const IEM_BASE = 'https://mesonet.agron.iastate.edu/geojson/lsr.geojson';
const FETCH_TIMEOUT_MS = 15_000;

interface LsrFeature {
  type: 'Feature';
  properties: {
    valid: string;
    typetext?: string;
    type?: string;
    magnitude?: number | string;
    city?: string;
    county?: string;
    state?: string;
    source?: string;
    remark?: string;
  };
  geometry: { type: 'Point'; coordinates: [number, number] };
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

function isHailType(typetext?: string, type?: string): boolean {
  if (type === 'H') return true;
  if (!typetext) return false;
  return typetext.toLowerCase().includes('hail');
}

/**
 * Fetch hail LSRs for a date or date range. Pass either:
 *   - `{ date: 'YYYY-MM-DD' }` for a single Eastern day, or
 *   - `{ startIso, endIso }` for a span (used by the event-cache backfill).
 */
export async function fetchIemHailReports(
  opts:
    | { date: string; bounds?: BoundingBox | null; states?: string[] }
    | {
        startIso: string;
        endIso: string;
        bounds?: BoundingBox | null;
        states?: string[];
      },
): Promise<HailPointReport[]> {
  let start: string;
  let end: string;
  if ('date' in opts) {
    // Eastern calendar day → exact UTC window (handles EDT/EST + the
    // late-evening-ET storms that fall into next UTC day).
    const w = etDayUtcWindow(opts.date);
    start = w.startUtc.toISOString();
    end = w.endUtc.toISOString();
  } else {
    start = opts.startIso;
    end = opts.endIso;
  }

  const params = new URLSearchParams({
    sts: fmtIemTimestamp(start),
    ets: fmtIemTimestamp(end),
  });
  if (opts.states && opts.states.length > 0) {
    params.set('states', opts.states.join(','));
  }

  const url = `${IEM_BASE}?${params.toString()}`;
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(url, {
      signal: ac.signal,
      headers: { 'User-Agent': 'HailYes/1.0 (storm-intelligence-app)' },
    });
    clearTimeout(timer);
    if (!res.ok) return [];
    const data = (await res.json()) as { features?: LsrFeature[] };
    const features = data.features ?? [];
    const reports: HailPointReport[] = [];
    for (const f of features) {
      if (!isHailType(f.properties.typetext, f.properties.type)) continue;
      const [lng, lat] = f.geometry.coordinates;
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      if (
        opts.bounds &&
        (lat < opts.bounds.south ||
          lat > opts.bounds.north ||
          lng < opts.bounds.west ||
          lng > opts.bounds.east)
      ) {
        continue;
      }
      const mag = Number(f.properties.magnitude);
      // IEM LSR magnitudes for hail are diameter inches; reports without a
      // measured size still indicate a hail event — assume a conservative ½".
      const sizeInches = Number.isFinite(mag) && mag > 0 ? mag : 0.5;
      reports.push({
        id: `iem-h-${f.properties.valid}-${reports.length}`,
        time: f.properties.valid,
        lat,
        lng,
        sizeInches,
        source: 'IEM-LSR',
        state: f.properties.state,
        county: f.properties.county,
        description: f.properties.remark || f.properties.city,
      });
    }
    return reports;
  } catch {
    return [];
  }
}
