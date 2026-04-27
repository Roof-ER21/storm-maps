/**
 * Synoptic Data API client — surface observations from MADIS/CWOP/METAR.
 *
 * Ported from ~/synoptic-poc/src/synopticClient.ts (POC vetted against the
 * Thursday Weather Co negotiation evidence track). Functional style to match
 * the rest of `server/storm/`.
 *
 * Free-tier limits (empirical, as of Apr 2026):
 *   - 5,000 calls/day per token
 *   - ~365 days of history; older dates → HTTP 403 with
 *     "Account associated with this token does not have access to the
 *     requested history"
 *
 * Token sourcing:
 *   - SYNOPTIC_TOKEN env var (32-char hex public token, safe in code/env)
 *   - DO NOT use the master SYNOPTIC_API_KEY — it mints/rotates tokens.
 *
 * Variable name caveats:
 *   - It's `wind_gust`, NOT `peak_wind_gust`
 *   - Bbox order: minLng,minLat,maxLng,maxLat (Synoptic is lng-first)
 *   - Time format: UTC `YYYYMMDDhhmm` no separators
 *   - Returned obs fields suffixed `_set_1` (or `_set_1d` for derived)
 */

const SYNOPTIC_BASE = 'https://api.synopticdata.com/v2';
const FETCH_TIMEOUT_MS = 15_000;

const REQUESTED_VARS = [
  'wind_speed',
  'wind_gust',
  'precip_accum_one_hour',
  'precip_accum_fifteen_minute',
  'air_temp',
  'weather_summary',
  'weather_cond_code',
];

export interface ObservationPoint {
  timestamp: string;
  windSpeedMph: number | null;
  windGustMph: number | null;
  precipOneHourIn: number | null;
  precipFifteenMinIn: number | null;
  airTempF: number | null;
  weatherSummary: string | null;
  weatherCondCode: number | null;
}

export interface GroundStation {
  stationId: string;
  name: string;
  network: string;
  latitude: number;
  longitude: number;
  distanceMiles: number | null;
  observations: ObservationPoint[];
}

interface SynopticEnvelope {
  SUMMARY: {
    NUMBER_OF_OBJECTS?: number;
    RESPONSE_CODE: number;
    RESPONSE_MESSAGE: string;
    RESPONSE_TIME?: number;
    VERSION?: string | null;
  };
  STATION?: SynopticRawStation[];
}

interface SynopticRawStation {
  STID: string;
  NAME?: string;
  LATITUDE?: string;
  LONGITUDE?: string;
  STATE?: string;
  MNET_ID?: string;
  DISTANCE?: number;
  STATUS?: string;
  OBSERVATIONS?: Record<string, unknown>;
}

export interface SynopticRadiusQuery {
  lat: number;
  lng: number;
  radiusMiles: number;
  startUtc: Date;
  endUtc: Date;
}

export interface SynopticBboxQuery {
  bbox: { minLat: number; minLng: number; maxLat: number; maxLng: number };
  startUtc: Date;
  endUtc: Date;
}

export function isSynopticConfigured(): boolean {
  return Boolean(process.env.SYNOPTIC_TOKEN?.trim());
}

function getToken(): string {
  const t = process.env.SYNOPTIC_TOKEN?.trim();
  if (!t) {
    throw new Error(
      'SYNOPTIC_TOKEN not set. Add it to .env.local / Railway env to enable surface-obs corroboration.',
    );
  }
  return t;
}

export async function fetchSynopticTimeseriesByRadius(
  q: SynopticRadiusQuery,
): Promise<GroundStation[]> {
  const params = new URLSearchParams({
    token: getToken(),
    radius: `${q.lat},${q.lng},${q.radiusMiles}`,
    start: toSynopticUtc(q.startUtc),
    end: toSynopticUtc(q.endUtc),
    vars: REQUESTED_VARS.join(','),
    units: 'english,speed|mph,precip|in',
    obtimezone: 'utc',
  });
  return fetchAndParse(params);
}

export async function fetchSynopticTimeseriesByBbox(
  q: SynopticBboxQuery,
): Promise<GroundStation[]> {
  const { minLat, minLng, maxLat, maxLng } = q.bbox;
  // Synoptic bbox order: minLng,minLat,maxLng,maxLat (lng first).
  const params = new URLSearchParams({
    token: getToken(),
    bbox: `${minLng},${minLat},${maxLng},${maxLat}`,
    start: toSynopticUtc(q.startUtc),
    end: toSynopticUtc(q.endUtc),
    vars: REQUESTED_VARS.join(','),
    units: 'english,speed|mph,precip|in',
    obtimezone: 'utc',
  });
  return fetchAndParse(params);
}

async function fetchAndParse(
  params: URLSearchParams,
): Promise<GroundStation[]> {
  const url = `${SYNOPTIC_BASE}/stations/timeseries?${params.toString()}`;
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(url, {
      signal: ac.signal,
      headers: { 'User-Agent': 'HailYes/1.0 (storm-intelligence-app)' },
    });
    clearTimeout(timer);
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      // Free-tier history-depth gate is a 403 with a known message.
      if (res.status === 403 && body.includes('does not have access to the requested history')) {
        console.warn(
          '[synoptic] 365-day free-tier history limit hit (request older than ~1y). Apply for academic token to extend.',
        );
        return [];
      }
      console.warn(`[synoptic] HTTP ${res.status}: ${body.slice(0, 200)}`);
      return [];
    }
    const env = (await res.json()) as SynopticEnvelope;
    const code = env.SUMMARY?.RESPONSE_CODE;
    if (code !== 1) {
      const msg = env.SUMMARY?.RESPONSE_MESSAGE ?? '';
      // Free-tier history-depth limit is the dominant non-success path
      // (every PDF for a >1y-old date hits it). Log once per process and
      // suppress thereafter — otherwise each report floods stderr.
      if (typeof msg === 'string' && msg.includes('does not have access to the requested history')) {
        if (!historyLimitWarned) {
          historyLimitWarned = true;
          console.warn(
            '[synoptic] free-tier 365-day history limit reached — suppressing further per-request warnings',
          );
        }
        return [];
      }
      console.warn(`[synoptic] response_code=${code} msg=${msg}`);
      return [];
    }
    return (env.STATION ?? []).map(toGroundStation);
  } catch (err) {
    if (!fetchFailWarned) {
      fetchFailWarned = true;
      console.warn(
        '[synoptic] fetch failed (suppressing further):',
        (err as Error).message,
      );
    }
    return [];
  }
}

let historyLimitWarned = false;
let fetchFailWarned = false;

function toSynopticUtc(d: Date): string {
  const yyyy = d.getUTCFullYear().toString().padStart(4, '0');
  const mm = (d.getUTCMonth() + 1).toString().padStart(2, '0');
  const dd = d.getUTCDate().toString().padStart(2, '0');
  const hh = d.getUTCHours().toString().padStart(2, '0');
  const mi = d.getUTCMinutes().toString().padStart(2, '0');
  return `${yyyy}${mm}${dd}${hh}${mi}`;
}

function toGroundStation(s: SynopticRawStation): GroundStation {
  const obs = s.OBSERVATIONS ?? {};
  const dateTime = (obs['date_time'] as string[] | undefined) ?? [];

  const pickArr = (...keys: string[]): unknown[] => {
    for (const k of keys) {
      const v = obs[k];
      if (Array.isArray(v)) return v;
    }
    return [];
  };

  const windSpeed = pickArr('wind_speed_set_1', 'wind_speed_value_1');
  const windGust = pickArr('wind_gust_set_1', 'wind_gust_value_1');
  const precip1h = pickArr(
    'precip_accum_one_hour_set_1',
    'precip_accum_one_hour_value_1',
  );
  const precip15 = pickArr(
    'precip_accum_fifteen_minute_set_1',
    'precip_accum_fifteen_minute_value_1',
  );
  const airTemp = pickArr('air_temp_set_1', 'air_temp_value_1');
  const weatherSummary = pickArr(
    'weather_summary_set_1d',
    'weather_summary_set_1',
  );
  const weatherCondCode = pickArr(
    'weather_cond_code_set_1d',
    'weather_cond_code_set_1',
  );

  const observations: ObservationPoint[] = dateTime.map((ts, i) => ({
    timestamp: ts,
    windSpeedMph: numOrNull(windSpeed[i]),
    windGustMph: numOrNull(windGust[i]),
    precipOneHourIn: numOrNull(precip1h[i]),
    precipFifteenMinIn: numOrNull(precip15[i]),
    airTempF: numOrNull(airTemp[i]),
    weatherSummary: strOrNull(weatherSummary[i]),
    weatherCondCode: numOrNull(weatherCondCode[i]),
  }));

  return {
    stationId: s.STID,
    name: s.NAME ?? s.STID,
    network: s.MNET_ID ?? '?',
    latitude: parseFloat(s.LATITUDE ?? 'NaN'),
    longitude: parseFloat(s.LONGITUDE ?? 'NaN'),
    distanceMiles: typeof s.DISTANCE === 'number' ? s.DISTANCE : null,
    observations,
  };
}

function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

function strOrNull(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length > 0 ? s : null;
}
