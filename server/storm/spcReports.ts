/**
 * SPC Storm Prediction Center same-day / yesterday / archive wind report
 * fetcher.
 *
 * Endpoints:
 *   Today:     https://www.spc.noaa.gov/climo/reports/today_wind.csv
 *   Yesterday: https://www.spc.noaa.gov/climo/reports/yesterday_wind.csv
 *   Archive:   https://www.spc.noaa.gov/climo/reports/YYMMDD_rpts_wind.csv
 *
 * CSV format (with header):
 *   Time,Speed,Location,County,State,Lat,Lon,Comments
 *   Speed is gust mph (e.g. 65). Time is HHMM UTC.
 */

import type { WindReport } from './types.js';

const SPC_BASE = 'https://www.spc.noaa.gov/climo/reports';
const FETCH_TIMEOUT_MS = 12_000;

function buildIso(date: Date, hhmm: string): string {
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const hh = (hhmm.slice(0, 2) || '00').padStart(2, '0');
  const min = (hhmm.slice(2, 4) || '00').padStart(2, '0');
  return `${yyyy}-${mm}-${dd}T${hh}:${min}:00Z`;
}

function formatYymmdd(date: Date): string {
  const yy = String(date.getUTCFullYear()).slice(2);
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  return `${yy}${mm}${dd}`;
}

function isoToDate(iso: string): Date {
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

async function fetchSpcCsv(url: string): Promise<string | null> {
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(url, {
      signal: ac.signal,
      headers: { 'User-Agent': 'HailYes/1.0 (storm-intelligence-app)' },
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const text = await res.text();
    return text;
  } catch {
    return null;
  }
}

function parseSpcWindCsv(
  csvText: string,
  forDate: Date,
  idPrefix: string,
): WindReport[] {
  const lines = csvText
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return [];

  let startIndex = 0;
  const firstLine = lines[0].toLowerCase();
  if (
    firstLine.startsWith('time') ||
    firstLine.includes('speed') ||
    firstLine.includes('location')
  ) {
    startIndex = 1;
  }

  const reports: WindReport[] = [];
  for (let i = startIndex; i < lines.length; i += 1) {
    const parts = lines[i].split(',');
    if (parts.length < 7) continue;
    const [time, speed, location, county, state, latRaw, lonRaw, ...rest] = parts;
    const t = (time ?? '').trim();
    const mph = parseFloat((speed ?? '').trim());
    const lat = parseFloat((latRaw ?? '').trim());
    const lon = parseFloat((lonRaw ?? '').trim());
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (lat === 0 || lon === 0) continue;
    if (!Number.isFinite(mph)) continue;

    reports.push({
      id: `${idPrefix}-${i}`,
      time: buildIso(forDate, t.padStart(4, '0')),
      lat,
      lng: lon,
      gustMph: mph,
      source: 'SPC',
      state: (state ?? '').trim() || undefined,
      county: (county ?? '').trim() || undefined,
      description: `${(location ?? '').trim()}${rest.length > 0 ? ' — ' + rest.join(',').trim() : ''}`,
    });
  }
  return reports;
}

/**
 * Fetch SPC wind reports for the given date.
 *
 * The strategy mirrors what the frontend does for hail:
 * - "today"/"yesterday" CSVs while they're hot (< 48h)
 * - Archive YYMMDD CSV for older dates (typically published the next morning,
 *   covers ~7 days reliably; older dates exist but aren't guaranteed).
 */
export async function fetchSpcWindReports(
  date: string,
): Promise<WindReport[]> {
  const target = isoToDate(date);
  const now = new Date();
  const ageMs = now.getTime() - target.getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);

  const candidates: { url: string; prefix: string }[] = [];
  if (ageDays >= -0.5 && ageDays < 1) {
    candidates.push({ url: `${SPC_BASE}/today_wind.csv`, prefix: `spc-today-${date}` });
  }
  if (ageDays >= 0.5 && ageDays < 2) {
    candidates.push({ url: `${SPC_BASE}/yesterday_wind.csv`, prefix: `spc-yesterday-${date}` });
  }
  // Archive form covers any date.
  candidates.push({
    url: `${SPC_BASE}/${formatYymmdd(target)}_rpts_wind.csv`,
    prefix: `spc-archive-${date}`,
  });

  for (const { url, prefix } of candidates) {
    const csv = await fetchSpcCsv(url);
    if (!csv) continue;
    const reports = parseSpcWindCsv(csv, target, prefix);
    if (reports.length > 0) return reports;
  }
  return [];
}
