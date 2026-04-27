/**
 * NCEI SWDI (Severe Weather Data Inventory) — radar-derived hail signature.
 *
 * NX3HAIL is the WSR-88D Hail Detection Algorithm output, a separate signal
 * from MRMS MESH (which is a MESH-Max product). NX3HAIL gives per-cell hail
 * probability + max-expected-size from the radar's TVS analysis.
 *
 * Endpoint:
 *   https://www.ncdc.noaa.gov/swdiws/csv/nx3hail/{YYYYMMDD}?bbox=W,S,E,N
 *
 * Public — no API key required. Returns CSV with columns:
 *   #ZTIME,LON,LAT,WSR_ID,CELL_ID,RANGE,AZIMUTH,SEVPROB,PROB,MAXSIZE
 *
 * MAXSIZE is in inches (modern SWDI). Historical exports used 0.001" units
 * but the current /swdiws/ endpoint returns inches directly per the docs.
 */

const SWDI_BASE = 'https://www.ncdc.noaa.gov/swdiws/csv/nx3hail';
const FETCH_TIMEOUT_MS = 20_000;

export interface SwdiHailReport {
  /** ISO 8601 UTC. */
  time: string;
  lat: number;
  lng: number;
  /** Radar station ID (e.g. KLWX, KDOX). */
  wsrId: string;
  /** Severe-prob (0-100). */
  severeProb: number;
  /** Any-hail prob (0-100). */
  anyProb: number;
  /** Max expected hail size in inches. */
  maxSizeInches: number;
}

import { etDayUtcWindow } from './timeUtils.js';

function fmtDateRangeForSwdi(startUtc: Date, endUtc: Date): string {
  // SWDI accepts YYYYMMDDhhmm:YYYYMMDDhhmm time-range format. Use this so
  // the query window matches Eastern day exactly (rather than the UTC-day
  // single-date form which misses late-evening ET storms).
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

export interface SwdiQuery {
  date: string; // YYYY-MM-DD (interpreted as Eastern calendar day)
  bbox: { north: number; south: number; east: number; west: number };
  /** Min severe-prob to include (0-100). Default 30. */
  minSeverePct?: number;
  /** Min hail size in inches. Default 0.5. */
  minSizeInches?: number;
}

export async function fetchSwdiHailReports(q: SwdiQuery): Promise<SwdiHailReport[]> {
  const params = new URLSearchParams({
    bbox: `${q.bbox.west},${q.bbox.south},${q.bbox.east},${q.bbox.north}`,
  });
  const w = etDayUtcWindow(q.date);
  const range = fmtDateRangeForSwdi(w.startUtc, w.endUtc);
  const url = `${SWDI_BASE}/${range}?${params.toString()}`;
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(url, {
      signal: ac.signal,
      headers: { 'User-Agent': 'HailYes/1.0 (storm-intelligence-app)' },
    });
    clearTimeout(timer);
    if (!res.ok) {
      // SWDI is supplemental and frequently returns 500 from NCEI's side
      // (it's notoriously flaky). Log once per process status code so we
      // know the source dropped, but don't spam every cycle.
      if (!swdiHttpWarned.has(res.status)) {
        swdiHttpWarned.add(res.status);
        console.warn(`[swdi] HTTP ${res.status} — suppressing further warnings for this status`);
      }
      return [];
    }
    const csv = await res.text();
    return parseSwdiCsv(csv, q.minSeverePct ?? 30, q.minSizeInches ?? 0.5);
  } catch (err) {
    if (!swdiFetchWarned) {
      swdiFetchWarned = true;
      console.warn('[swdi] fetch failed (suppressing further):', (err as Error).message);
    }
    return [];
  }
}

const swdiHttpWarned = new Set<number>();
let swdiFetchWarned = false;

function parseSwdiCsv(
  csv: string,
  minSevere: number,
  minSize: number,
): SwdiHailReport[] {
  const lines = csv.split(/\r?\n/);
  const out: SwdiHailReport[] = [];
  for (const raw of lines) {
    if (!raw || raw.startsWith('#')) continue;
    const cols = raw.split(',');
    if (cols.length < 10) continue;
    // ZTIME,LON,LAT,WSR_ID,CELL_ID,RANGE,AZIMUTH,SEVPROB,PROB,MAXSIZE
    const ztime = cols[0];
    const lng = parseFloat(cols[1]);
    const lat = parseFloat(cols[2]);
    const wsr = cols[3];
    const sev = parseFloat(cols[7]);
    const any = parseFloat(cols[8]);
    const max = parseFloat(cols[9]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    if (!Number.isFinite(max) || max < minSize) continue;
    if (Number.isFinite(sev) && sev < minSevere) continue;
    out.push({
      time: parseSwdiTime(ztime),
      lat,
      lng,
      wsrId: wsr,
      severeProb: Number.isFinite(sev) ? sev : 0,
      anyProb: Number.isFinite(any) ? any : 0,
      maxSizeInches: max,
    });
  }
  return out;
}

function parseSwdiTime(s: string): string {
  // SWDI ZTIME format: "YYYY-MM-DD HH:MM:SS" UTC
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(s)) return s;
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(s)) {
    return s.replace(' ', 'T') + 'Z';
  }
  return s;
}
