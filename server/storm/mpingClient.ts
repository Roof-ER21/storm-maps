/**
 * mPING (NSSL Meteorological Phenomena Identification Near the Ground) client.
 *
 * mPING is NOAA's crowdsourced ground-truth feed for hail / wind / tornado /
 * snow reports. Reports come from the mPING phone app + web reporters and
 * are GPS-tagged + timestamped. Strong signal because it's submitted by
 * humans observing the actual event, not radar inference.
 *
 * Auth:
 *   - Free public token via https://mping.ou.edu/registration/register/
 *   - Live in `MPING_API_TOKEN` env var (sa21 already uses the same name).
 *
 * Endpoint:
 *   GET https://mping.ou.edu/mping/api/v2/reports/
 *     ?obtime_gte=ISO&obtime_lte=ISO&category=Hail
 *     &north=N&south=S&east=E&west=W   (or radius variant)
 *
 * Returns paginated GeoJSON-ish features.
 */

const MPING_BASE = 'https://mping.ou.edu/mping/api/v2/reports/';

// mPING endpoint started returning HTTP 404 around April 2026 — same
// pattern as the CoCoRaHS export-aspx removal. Until upstream comes back
// (or we find the new URL) we short-circuit further requests in-process
// to keep the prewarm scheduler quiet and save round trips.
let endpointOffline = false;
let offlineLogged = false;
const FETCH_TIMEOUT_MS = 15_000;

export interface MpingReport {
  id: string;
  /** ISO 8601 UTC timestamp. */
  time: string;
  category: 'Hail' | 'Wind' | 'Tornado' | 'Rain' | 'Other';
  description: string;
  /** Hail size inches (parsed from description). 0 if not hail or unparseable. */
  hailSizeInches: number;
  lat: number;
  lng: number;
}

interface MpingApiFeature {
  id?: number;
  obtime?: string;
  category?: string;
  description?: string;
  geom?: { type?: string; coordinates?: [number, number] };
}

interface MpingApiResponse {
  results?: MpingApiFeature[];
  next?: string | null;
}

/**
 * Map mPING text descriptions (e.g. "Quarter (1.00 in.)") to a numeric
 * inches value. mPING reporters select from a fixed picklist on the app
 * and the description is "<Size Name> (<inches> in.)" — extract the number.
 * Falls back to a synonyms map if the parens version isn't present.
 */
const SIZE_SYNONYMS: Array<{ pattern: RegExp; inches: number }> = [
  { pattern: /pea/i, inches: 0.25 },
  { pattern: /marble/i, inches: 0.5 },
  { pattern: /dime/i, inches: 0.75 },
  { pattern: /penny/i, inches: 0.75 },
  { pattern: /nickel/i, inches: 0.875 },
  { pattern: /quarter/i, inches: 1.0 },
  { pattern: /half\s*dollar/i, inches: 1.25 },
  { pattern: /walnut/i, inches: 1.5 },
  { pattern: /ping[\s-]?pong|table\s*tennis/i, inches: 1.5 },
  { pattern: /golf\s*ball/i, inches: 1.75 },
  { pattern: /lime/i, inches: 2.0 },
  { pattern: /tennis/i, inches: 2.5 },
  { pattern: /baseball/i, inches: 2.75 },
  { pattern: /apple/i, inches: 3.0 },
  { pattern: /softball/i, inches: 4.0 },
  { pattern: /grapefruit/i, inches: 4.5 },
];

function parseHailInches(description: string | undefined): number {
  if (!description) return 0;
  const explicit = description.match(/(\d+(?:\.\d+)?)\s*in\.?\)/i);
  if (explicit) {
    const v = parseFloat(explicit[1]);
    if (Number.isFinite(v) && v > 0) return v;
  }
  for (const entry of SIZE_SYNONYMS) {
    if (entry.pattern.test(description)) return entry.inches;
  }
  return 0;
}

export function isMpingConfigured(): boolean {
  return Boolean(process.env.MPING_API_TOKEN?.trim());
}

function getToken(): string {
  const t = process.env.MPING_API_TOKEN?.trim();
  if (!t) {
    throw new Error(
      'MPING_API_TOKEN not set. Register at https://mping.ou.edu/registration/register/ to enable mPING crowd-source ingest.',
    );
  }
  return t;
}

export interface MpingQuery {
  startUtc: Date;
  endUtc: Date;
  /** Optional bbox; if absent, queries the full focus territory. */
  bbox?: { north: number; south: number; east: number; west: number };
  /** Defaults to 'Hail'. */
  category?: 'Hail' | 'Wind' | 'Tornado';
}

export async function fetchMpingReports(q: MpingQuery): Promise<MpingReport[]> {
  if (!isMpingConfigured()) return [];
  if (endpointOffline) return [];
  const token = getToken();
  const params = new URLSearchParams({
    obtime_gte: q.startUtc.toISOString(),
    obtime_lte: q.endUtc.toISOString(),
    category: q.category ?? 'Hail',
  });
  if (q.bbox) {
    params.set('north', String(q.bbox.north));
    params.set('south', String(q.bbox.south));
    params.set('east', String(q.bbox.east));
    params.set('west', String(q.bbox.west));
  }

  let url: string | null = `${MPING_BASE}?${params.toString()}`;
  const all: MpingReport[] = [];
  let pages = 0;

  // Cap pagination to keep a single bad query from running away.
  while (url && pages < 5) {
    pages += 1;
    try {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
      const res = await fetch(url, {
        signal: ac.signal,
        headers: {
          Authorization: `Token ${token}`,
          'User-Agent': 'HailYes/1.0 (storm-intelligence-app)',
        },
      });
      clearTimeout(timer);
      if (res.status === 404) {
        endpointOffline = true;
        if (!offlineLogged) {
          offlineLogged = true;
          if (shouldLogOptionalUpstreams()) {
            console.info('[mping] optional source disabled: endpoint returned 404');
          }
        }
        return all;
      }
      if (!res.ok) {
        return all;
      }
      const data = (await res.json()) as MpingApiResponse;
      for (const f of data.results ?? []) {
        if (
          !f.geom?.coordinates ||
          f.geom.coordinates.length !== 2 ||
          !f.obtime
        ) {
          continue;
        }
        const [lng, lat] = f.geom.coordinates;
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
        const category = (f.category ?? 'Other') as MpingReport['category'];
        all.push({
          id: f.id != null ? `mping-${f.id}` : `mping-${all.length}-${f.obtime}`,
          time: f.obtime,
          category,
          description: f.description ?? '',
          hailSizeInches: category === 'Hail' ? parseHailInches(f.description) : 0,
          lat,
          lng,
        });
      }
      url = data.next ?? null;
    } catch (err) {
      if (shouldLogOptionalUpstreams()) {
        console.info('[mping] optional source unavailable:', (err as Error).message);
      }
      return all;
    }
  }
  return all;
}

function shouldLogOptionalUpstreams(): boolean {
  return process.env.STORM_OPTIONAL_UPSTREAM_LOGS === '1';
}
