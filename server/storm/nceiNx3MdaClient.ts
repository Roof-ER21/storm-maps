/**
 * NCEI SWDI nx3mda — NEXRAD Level-3 Mesocyclone Detection Algorithm.
 *
 * Detects rotating updrafts (mesocyclones) — supercells, the parent
 * thunderstorms of most significant tornadoes. Active 2013+. Different
 * signal from nx3hail (which tracks hail cells); this catches rotation
 * before the tornado touches down.
 *
 * Endpoint:
 *   https://www.ncei.noaa.gov/swdiws/csv/nx3mda/{YYYYMMDDhhmm:YYYYMMDDhhmm}?bbox=W,S,E,N
 *
 * Public, no key. CSV columns vary slightly by version; we parse defensively.
 * Common columns:
 *   ZTIME, LON, LAT, WSR_ID, AZIMUTH, RANGE, MDA_STRENGTH (or RANK),
 *   BASE, TOP, ROT_VEL, GTG, MOTION_DIR, MOTION_SPEED
 *
 * Mesocyclone strength rating (NSSL):
 *   1-5  weak
 *   6-10 moderate (≈ supercell signature)
 *   11+  strong (high tornado potential)
 */

import { etDayUtcWindow } from './timeUtils.js';
import {
  recordSwdiFailure,
  recordSwdiSuccess,
  swdiHostDown,
} from './swdiCircuitBreaker.js';

const SWDI_BASE = 'https://www.ncei.noaa.gov/swdiws/csv/nx3mda';
const FETCH_TIMEOUT_MS = Math.max(
  1_000,
  Number.parseInt(process.env.SWDI_FETCH_TIMEOUT_MS ?? '6000', 10) || 6_000,
);

export interface MesocycloneDetection {
  /** ISO 8601 UTC. */
  time: string;
  lat: number;
  lng: number;
  wsrId: string;
  /** MDA strength/rank (1-30+; ≥6 supercell-like). */
  strength: number;
  /** Rotational velocity (m/s). */
  rotVel: number | null;
  /** Mesocyclone base height (km). */
  baseKm: number | null;
  /** Storm motion direction (deg). */
  motionDir: number | null;
}

export interface MesoQuery {
  /** YYYY-MM-DD (Eastern calendar day). */
  date: string;
  bbox: { north: number; south: number; east: number; west: number };
  /** Min strength to keep. Default 5 (weak supercell signature). */
  minStrength?: number;
}

function fmtSwdiRange(startUtc: Date, endUtc: Date): string {
  const fmt = (d: Date): string => {
    const yyyy = d.getUTCFullYear().toString().padStart(4, '0');
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    const hh = String(d.getUTCHours()).padStart(2, '0');
    const mi = String(d.getUTCMinutes()).padStart(2, '0');
    return `${yyyy}${mm}${dd}${hh}${mi}`;
  };
  return `${fmt(startUtc)}:${fmt(endUtc)}`;
}

export async function fetchMesocyclones(
  q: MesoQuery,
): Promise<MesocycloneDetection[]> {
  if (swdiHostDown()) return [];

  const w = etDayUtcWindow(q.date);
  const range = fmtSwdiRange(w.startUtc, w.endUtc);
  const params = new URLSearchParams({
    bbox: `${q.bbox.west},${q.bbox.south},${q.bbox.east},${q.bbox.north}`,
  });
  const url = `${SWDI_BASE}/${range}?${params.toString()}`;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ac.signal,
      headers: { 'User-Agent': 'HailYes/1.0 (storm-intelligence-app)' },
    });
    if (!res.ok) {
      recordSwdiFailure('nx3mda');
      if (shouldLogOptionalUpstreams() && !nx3mdaHttpWarned.has(res.status)) {
        nx3mdaHttpWarned.add(res.status);
        console.info(`[nx3mda] optional source HTTP ${res.status} (suppressing further)`);
      }
      return [];
    }
    const csv = await res.text();
    recordSwdiSuccess();
    return parseMesoCsv(csv, q.minStrength ?? 5);
  } catch (err) {
    recordSwdiFailure('nx3mda');
    if (shouldLogOptionalUpstreams() && !isAbortLike(err) && !nx3mdaFetchWarned) {
      nx3mdaFetchWarned = true;
      console.info('[nx3mda] optional source unavailable (suppressing further):', errorMessage(err));
    }
    return [];
  } finally {
    clearTimeout(timer);
  }
}

const nx3mdaHttpWarned = new Set<number>();
let nx3mdaFetchWarned = false;

function shouldLogOptionalUpstreams(): boolean {
  return process.env.STORM_OPTIONAL_UPSTREAM_LOGS === '1';
}

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

function parseMesoCsv(csv: string, minStrength: number): MesocycloneDetection[] {
  const lines = csv.split(/\r?\n/);
  if (lines.length < 2) return [];
  // Find the header row (first non-comment line) and build a column index.
  let headerIdx = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const l = lines[i].trim();
    if (l && !l.startsWith('#')) {
      headerIdx = i;
      break;
    }
  }
  const headers = lines[headerIdx].split(',').map((h) => h.trim().toUpperCase());
  const idx = (name: string): number => headers.indexOf(name);

  const out: MesocycloneDetection[] = [];
  for (let i = headerIdx + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line || line.startsWith('#')) continue;
    const cols = line.split(',');
    if (cols.length < 6) continue;
    const ztime = cols[idx('ZTIME')] ?? cols[0];
    const lng = parseFloat(cols[idx('LON')] ?? cols[1] ?? '');
    const lat = parseFloat(cols[idx('LAT')] ?? cols[2] ?? '');
    const wsr = cols[idx('WSR_ID')] ?? cols[3] ?? '';
    const strengthRaw =
      cols[idx('MDA_STRENGTH')] ?? cols[idx('STRENGTH_RANK')] ?? cols[idx('RANK')] ?? '';
    const strength = parseFloat(strengthRaw);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    if (!Number.isFinite(strength) || strength < minStrength) continue;
    const rotVel = parseFloat(cols[idx('ROT_VEL')] ?? '');
    const baseKm = parseFloat(cols[idx('BASE')] ?? '');
    const motionDir = parseFloat(cols[idx('MOTION_DIR')] ?? '');
    out.push({
      time: parseSwdiTime(ztime ?? ''),
      lat,
      lng,
      wsrId: wsr,
      strength,
      rotVel: Number.isFinite(rotVel) ? rotVel : null,
      baseKm: Number.isFinite(baseKm) ? baseKm : null,
      motionDir: Number.isFinite(motionDir) ? motionDir : null,
    });
  }
  return out;
}

function parseSwdiTime(s: string): string {
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(s)) return s;
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(s)) {
    return s.replace(' ', 'T') + 'Z';
  }
  return s;
}
