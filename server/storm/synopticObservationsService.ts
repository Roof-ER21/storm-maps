/**
 * Synoptic observations service — corroborate hail/severe-wind signals
 * from MADIS-fed surface stations against a query window.
 *
 * Ported from ~/synoptic-poc/src/corroborate.ts. Unchanged signal logic;
 * service shape matches `iemHailReports.ts` + `nwsAlerts.ts` style.
 *
 * Detection rules (`detectHailSignal`):
 *   - Explicit hail: weather text matches "hail"/"GR"/"GS"/"ice pellets"
 *     OR weather_cond_code in {87,88,89,90,92,93,94,96,99}
 *   - Convective signature (no explicit hail keyword): gust ≥ 40 mph AND
 *     (1h precip ≥ 0.5" OR 15-min precip ≥ 0.25")
 *
 * Single-station outliers can still produce false positives (e.g. the 135 mph
 * sensor-error case noted in the POC). Consumers wanting cross-station
 * consensus should require ≥2 stations with `signal.hailReported = true`.
 */

import {
  fetchSynopticTimeseriesByBbox,
  fetchSynopticTimeseriesByRadius,
  isSynopticConfigured,
  type GroundStation,
  type ObservationPoint,
} from './synopticClient.js';

export interface SignalThresholds {
  severeGustMph: number;
  heavyPrecipOneHourIn: number;
  burstPrecipFifteenMinIn: number;
}

export const DEFAULT_THRESHOLDS: SignalThresholds = {
  severeGustMph: 40,
  heavyPrecipOneHourIn: 0.5,
  burstPrecipFifteenMinIn: 0.25,
};

const HAIL_COND_CODES = new Set([87, 88, 89, 90, 92, 93, 94, 96, 99]);
const HAIL_KEYWORDS = [
  'hail',
  'thunderstorm',
  'tstm',
  'ts ',
  'gr',
  'gs ',
  'small hail',
  'ice pellets',
];

export interface HailSignal {
  hailReported: boolean;
  reason: string[];
  peakGustMph: number | null;
  peakPrecipOneHourIn: number | null;
  peakPrecipFifteenMinIn: number | null;
  hailKeywordHits: string[];
  hailCondCodeHits: number[];
}

export interface CorroboratedStation extends GroundStation {
  signal: HailSignal;
}

export interface SynopticCorroboration {
  query: {
    lat?: number;
    lng?: number;
    radiusMiles?: number;
    bbox?: { minLat: number; minLng: number; maxLat: number; maxLng: number };
    startUtc: string;
    endUtc: string;
  };
  stationsTotal: number;
  stationsWithHailSignal: number;
  stationsWithSevereWindSignal: number;
  stations: CorroboratedStation[];
  fetchedAt: string;
}

export interface SynopticCorroborateInput {
  lat?: number;
  lng?: number;
  radiusMiles?: number;
  bbox?: { minLat: number; minLng: number; maxLat: number; maxLng: number };
  startUtc: Date;
  endUtc: Date;
  thresholds?: Partial<SignalThresholds>;
}

export async function corroborateSynopticObservations(
  input: SynopticCorroborateInput,
): Promise<SynopticCorroboration> {
  const thresholds: SignalThresholds = {
    ...DEFAULT_THRESHOLDS,
    ...(input.thresholds ?? {}),
  };

  // Graceful no-op when token isn't configured — caller can still receive an
  // empty result and decide whether to surface "no data" vs failing.
  if (!isSynopticConfigured()) {
    return emptyResult(input, thresholds);
  }

  let stations: GroundStation[] = [];
  try {
    if (input.bbox) {
      stations = await fetchSynopticTimeseriesByBbox({
        bbox: input.bbox,
        startUtc: input.startUtc,
        endUtc: input.endUtc,
      });
    } else if (
      typeof input.lat === 'number' &&
      typeof input.lng === 'number' &&
      typeof input.radiusMiles === 'number'
    ) {
      stations = await fetchSynopticTimeseriesByRadius({
        lat: input.lat,
        lng: input.lng,
        radiusMiles: input.radiusMiles,
        startUtc: input.startUtc,
        endUtc: input.endUtc,
      });
    } else {
      throw new Error(
        'corroborateSynopticObservations(): provide either {lat,lng,radiusMiles} or {bbox}',
      );
    }
  } catch (err) {
    console.warn('[synoptic-corroborate] fetch failed:', (err as Error).message);
    return emptyResult(input, thresholds);
  }

  const corroborated: CorroboratedStation[] = stations.map((s) => ({
    ...s,
    signal: detectHailSignal(s.observations, thresholds),
  }));

  return {
    query: {
      lat: input.lat,
      lng: input.lng,
      radiusMiles: input.radiusMiles,
      bbox: input.bbox,
      startUtc: input.startUtc.toISOString(),
      endUtc: input.endUtc.toISOString(),
    },
    stationsTotal: corroborated.length,
    stationsWithHailSignal: corroborated.filter((s) => s.signal.hailReported)
      .length,
    stationsWithSevereWindSignal: corroborated.filter(
      (s) =>
        s.signal.peakGustMph !== null &&
        s.signal.peakGustMph >= thresholds.severeGustMph,
    ).length,
    stations: corroborated,
    fetchedAt: new Date().toISOString(),
  };
}

export function detectHailSignal(
  obs: ObservationPoint[],
  th: SignalThresholds,
): HailSignal {
  const reasons: string[] = [];
  const hailKeywordHits = new Set<string>();
  const hailCondCodeHits = new Set<number>();

  let peakGust: number | null = null;
  let peakPrecip1h: number | null = null;
  let peakPrecip15: number | null = null;

  for (const o of obs) {
    if (
      o.windGustMph !== null &&
      (peakGust === null || o.windGustMph > peakGust)
    ) {
      peakGust = o.windGustMph;
    }
    if (
      o.precipOneHourIn !== null &&
      (peakPrecip1h === null || o.precipOneHourIn > peakPrecip1h)
    ) {
      peakPrecip1h = o.precipOneHourIn;
    }
    if (
      o.precipFifteenMinIn !== null &&
      (peakPrecip15 === null || o.precipFifteenMinIn > peakPrecip15)
    ) {
      peakPrecip15 = o.precipFifteenMinIn;
    }
    if (
      o.weatherCondCode !== null &&
      HAIL_COND_CODES.has(o.weatherCondCode)
    ) {
      hailCondCodeHits.add(o.weatherCondCode);
    }
    if (o.weatherSummary) {
      const lower = o.weatherSummary.toLowerCase();
      for (const kw of HAIL_KEYWORDS) {
        if (lower.includes(kw)) hailKeywordHits.add(kw);
      }
    }
  }

  if (hailKeywordHits.has('hail') || hailKeywordHits.has('gr')) {
    reasons.push(
      `weather text reported hail keyword(s): ${[...hailKeywordHits].join(',')}`,
    );
  }
  if (hailCondCodeHits.size > 0) {
    reasons.push(
      `hail-bearing storm codes: ${[...hailCondCodeHits].join(',')}`,
    );
  }
  if (peakGust !== null && peakGust >= th.severeGustMph) {
    reasons.push(`severe wind gust ${peakGust} mph >= ${th.severeGustMph}`);
  }
  if (peakPrecip1h !== null && peakPrecip1h >= th.heavyPrecipOneHourIn) {
    reasons.push(
      `heavy 1h precip ${peakPrecip1h.toFixed(2)}" >= ${th.heavyPrecipOneHourIn}"`,
    );
  }
  if (peakPrecip15 !== null && peakPrecip15 >= th.burstPrecipFifteenMinIn) {
    reasons.push(
      `15-min burst ${peakPrecip15.toFixed(2)}" >= ${th.burstPrecipFifteenMinIn}"`,
    );
  }

  const explicitHail =
    hailKeywordHits.has('hail') ||
    hailKeywordHits.has('gr') ||
    hailCondCodeHits.size > 0;
  const convective =
    peakGust !== null &&
    peakGust >= th.severeGustMph &&
    ((peakPrecip1h ?? 0) >= th.heavyPrecipOneHourIn ||
      (peakPrecip15 ?? 0) >= th.burstPrecipFifteenMinIn);

  return {
    hailReported: explicitHail || convective,
    reason: reasons,
    peakGustMph: peakGust,
    peakPrecipOneHourIn: peakPrecip1h,
    peakPrecipFifteenMinIn: peakPrecip15,
    hailKeywordHits: [...hailKeywordHits],
    hailCondCodeHits: [...hailCondCodeHits],
  };
}

function emptyResult(
  input: SynopticCorroborateInput,
  _thresholds: SignalThresholds,
): SynopticCorroboration {
  return {
    query: {
      lat: input.lat,
      lng: input.lng,
      radiusMiles: input.radiusMiles,
      bbox: input.bbox,
      startUtc: input.startUtc.toISOString(),
      endUtc: input.endUtc.toISOString(),
    },
    stationsTotal: 0,
    stationsWithHailSignal: 0,
    stationsWithSevereWindSignal: 0,
    stations: [],
    fetchedAt: new Date().toISOString(),
  };
}
