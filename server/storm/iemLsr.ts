/**
 * IEM Local Storm Reports — wind report fetcher with date-windowed query.
 *
 * Endpoint:
 *   https://mesonet.agron.iastate.edu/cgi-bin/request/gis/lsr.py
 *     ?sts=YYYYMMDDHHMI&ets=YYYYMMDDHHMI&fmt=geojson&[wfo=...|state=...]
 *
 * This is the canonical archive for LSRs across all NWS forecast offices and
 * goes back ~20 years. Same-day reports lag ~5–15 minutes from issuance.
 */

import type { BoundingBox, WindReport } from './types.js';
import { etDayUtcWindow } from './timeUtils.js';

const IEM_BASE = 'https://mesonet.agron.iastate.edu/cgi-bin/request/gis/lsr.py';
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

function isWindType(typetext?: string, type?: string): boolean {
  if (type === 'G' || type === 'D' || type === 'TSTM WND DMG') return true;
  if (!typetext) return false;
  const lower = typetext.toLowerCase();
  return (
    lower.includes('wind') ||
    lower.includes('gust') ||
    lower === 'tstm wnd gst' ||
    lower === 'tstm wnd dmg'
  );
}

/**
 * Fetch wind LSRs for a given Eastern calendar date and optional bounding
 * box. The bbox filter is applied client-side (IEM's parameters are by NWS
 * office or state, not lat/lng). The date is interpreted as ET — the UTC
 * window is computed via timeUtils.etDayUtcWindow() so EDT/EST + late-
 * evening-ET storms are handled correctly.
 */
export async function fetchIemWindReports(opts: {
  date: string;
  bounds?: BoundingBox | null;
  states?: string[];
}): Promise<WindReport[]> {
  const w = etDayUtcWindow(opts.date);
  const start = w.startUtc.toISOString();
  const end = w.endUtc.toISOString();

  const params = new URLSearchParams({
    sts: fmtIemTimestamp(start),
    ets: fmtIemTimestamp(end),
    fmt: 'geojson',
  });

  // IEM accepts state= filters; passing them narrows the response payload
  // dramatically for VA/MD/PA queries.
  if (opts.states && opts.states.length > 0) {
    for (const st of opts.states) {
      params.append('state', st);
    }
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
    const reports: WindReport[] = [];
    for (const f of features) {
      if (!isWindType(f.properties.typetext, f.properties.type)) continue;
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
      // Damage-only reports without a measured gust still mark a footprint —
      // assume a conservative 60 mph (lower bound for "damaging") so they show
      // in the map without inflating to severe.
      const gustMph = Number.isFinite(mag) && mag > 0 ? mag : 60;
      reports.push({
        id: `iem-${f.properties.valid}-${reports.length}`,
        time: f.properties.valid,
        lat,
        lng,
        gustMph,
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
