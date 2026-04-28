/**
 * Wind swath API client. Talks to this app's own backend (the wind pipeline
 * is hosted in-repo, unlike the MRMS hail pipeline which currently lives in
 * the field-assistant project).
 */

import type { BoundingBox } from '../types/storm';

export type WindSeverity =
  | 'breezy'
  | 'damaging'
  | 'severe'
  | 'very_severe'
  | 'extreme';

export interface WindSwathFeature {
  type: 'Feature';
  properties: {
    level: number;
    minMph: number;
    maxMph: number;
    label: string;
    color: string;
    severity: WindSeverity;
    reportCount: number;
  };
  geometry: {
    type: 'MultiPolygon';
    coordinates: number[][][][];
  };
}

export interface WindSwathCollection {
  type: 'FeatureCollection';
  features: WindSwathFeature[];
  metadata: {
    date: string;
    bounds: BoundingBox;
    reportCount: number;
    maxGustMph: number;
    sources: string[];
    generatedAt: string;
    freshness: 'live' | 'archive' | 'mixed';
  };
}

export interface WindImpactResult {
  id: string;
  maxGustMph: number | null;
  level: number | null;
  color: string | null;
  label: string | null;
  severity: WindSeverity | null;
  directHit: boolean;
}

export interface WindImpactResponse {
  date: string;
  metadata: {
    stormMaxMph: number;
    reportCount: number;
    pointsChecked: number;
    directHits: number;
  };
  results: WindImpactResult[];
}

/**
 * The wind endpoints live on this app's server. Default to a relative URL so
 * dev (vite proxy → localhost:3100) and production (same origin) both work
 * without extra config.
 */
function windApiBase(): string {
  const explicit = (import.meta.env.VITE_WIND_API_BASE as string | undefined)?.trim();
  if (explicit) return explicit.replace(/\/+$/, '');
  return '/api/wind';
}

const warnedOptionalWindFailures = new Set<string>();
const OPTIONAL_WIND_TIMEOUT_MS = 15000;

function isTimeoutError(err: unknown): boolean {
  const maybeError = err as { name?: unknown; message?: unknown };
  const name = typeof maybeError.name === 'string' ? maybeError.name : '';
  const message = typeof maybeError.message === 'string' ? maybeError.message : String(err);
  return (
    name === 'TimeoutError' ||
    name === 'AbortError' ||
    message.toLowerCase().includes('timed out')
  );
}

function warnOptionalWindFailure(key: string, err: unknown): void {
  if (isTimeoutError(err) || warnedOptionalWindFailures.has(key)) return;
  warnedOptionalWindFailures.add(key);
  console.warn(`[windApi] ${key} unavailable (suppressing further):`, err);
}

interface WindSwathParams {
  date: string;
  bounds: BoundingBox;
  states?: string[];
  live?: boolean;
  /** Optional ISO timestamp slice — drives the storm timeline scrubber. */
  windowStartIso?: string;
  windowEndIso?: string;
}

function toBoundsQuery(params: WindSwathParams): string {
  const q = new URLSearchParams({
    date: params.date,
    north: params.bounds.north.toString(),
    south: params.bounds.south.toString(),
    east: params.bounds.east.toString(),
    west: params.bounds.west.toString(),
  });
  if (params.states && params.states.length > 0) {
    q.set('states', params.states.join(','));
  }
  if (params.live) {
    q.set('live', '1');
  }
  if (params.windowStartIso && params.windowEndIso) {
    q.set('windowStart', params.windowStartIso);
    q.set('windowEnd', params.windowEndIso);
  }
  return q.toString();
}

export async function fetchWindSwathPolygons(
  params: WindSwathParams,
): Promise<WindSwathCollection | null> {
  try {
    const url = `${windApiBase()}/swath-polygons?${toBoundsQuery(params)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(OPTIONAL_WIND_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`Wind swath returned ${res.status}`);
    return await res.json();
  } catch (err) {
    warnOptionalWindFailure('fetchWindSwathPolygons', err);
    return null;
  }
}

export async function fetchLiveWindSwathPolygons(
  bounds: BoundingBox,
  states?: string[],
): Promise<WindSwathCollection | null> {
  try {
    const params = new URLSearchParams({
      north: bounds.north.toString(),
      south: bounds.south.toString(),
      east: bounds.east.toString(),
      west: bounds.west.toString(),
    });
    if (states && states.length > 0) {
      params.set('states', states.join(','));
    }
    const url = `${windApiBase()}/now-polygons?${params.toString()}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(OPTIONAL_WIND_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`Wind now returned ${res.status}`);
    return await res.json();
  } catch (err) {
    warnOptionalWindFailure('fetchLiveWindSwathPolygons', err);
    return null;
  }
}

export interface WindImpactPoint {
  id: string;
  lat: number;
  lng: number;
}

export async function fetchWindImpact(req: {
  date: string;
  bounds: BoundingBox;
  states?: string[];
  live?: boolean;
  points: WindImpactPoint[];
}): Promise<WindImpactResponse | null> {
  if (req.points.length === 0) return null;
  try {
    const res = await fetch(`${windApiBase()}/impact`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
      signal: AbortSignal.timeout(OPTIONAL_WIND_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`Wind impact returned ${res.status}`);
    return await res.json();
  } catch (err) {
    warnOptionalWindFailure('fetchWindImpact', err);
    return null;
  }
}
