/**
 * SPC hail report fetcher — same shape as `spcReports.ts` (wind variant).
 *
 * Endpoints:
 *   Today:     https://www.spc.noaa.gov/climo/reports/today_hail.csv
 *   Yesterday: https://www.spc.noaa.gov/climo/reports/yesterday_hail.csv
 *   Archive:   https://www.spc.noaa.gov/climo/reports/YYMMDD_rpts_hail.csv
 *
 * CSV format (with header):
 *   Time,Size,Location,County,State,Lat,Lon,Comments
 *   Size is hundredths of inches (e.g. 175 = 1.75").
 */

const SPC_BASE = 'https://www.spc.noaa.gov/climo/reports';
const FETCH_TIMEOUT_MS = 12_000;

export interface HailPointReport {
  id: string;
  /** ISO timestamp UTC. */
  time: string;
  lat: number;
  lng: number;
  sizeInches: number;
  source: 'SPC' | 'IEM-LSR';
  state?: string;
  county?: string;
  description?: string;
}

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
    return await res.text();
  } catch {
    return null;
  }
}

function parseSpcHailCsv(
  csvText: string,
  forDate: Date,
  idPrefix: string,
): HailPointReport[] {
  const lines = csvText
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return [];

  let startIndex = 0;
  const firstLine = lines[0].toLowerCase();
  if (
    firstLine.startsWith('time') ||
    firstLine.includes('size') ||
    firstLine.includes('location')
  ) {
    startIndex = 1;
  }

  const reports: HailPointReport[] = [];
  for (let i = startIndex; i < lines.length; i += 1) {
    const parts = lines[i].split(',');
    if (parts.length < 7) continue;
    const [time, size, location, county, state, latRaw, lonRaw, ...rest] = parts;
    const t = (time ?? '').trim();
    const sizeHundredths = parseFloat((size ?? '').trim());
    const lat = parseFloat((latRaw ?? '').trim());
    const lon = parseFloat((lonRaw ?? '').trim());
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (lat === 0 || lon === 0) continue;
    if (!Number.isFinite(sizeHundredths)) continue;

    reports.push({
      id: `${idPrefix}-${i}`,
      time: buildIso(forDate, t.padStart(4, '0')),
      lat,
      lng: lon,
      sizeInches: sizeHundredths / 100,
      source: 'SPC',
      state: (state ?? '').trim() || undefined,
      county: (county ?? '').trim() || undefined,
      description: `${(location ?? '').trim()}${rest.length > 0 ? ' — ' + rest.join(',').trim() : ''}`,
    });
  }
  return reports;
}

export async function fetchSpcHailReportsForDate(
  date: string,
): Promise<HailPointReport[]> {
  const target = isoToDate(date);
  const now = new Date();
  const ageDays = (now.getTime() - target.getTime()) / 86_400_000;

  const candidates: { url: string; prefix: string }[] = [];
  if (ageDays >= -0.5 && ageDays < 1) {
    candidates.push({ url: `${SPC_BASE}/today_hail.csv`, prefix: `spc-today-${date}` });
  }
  if (ageDays >= 0.5 && ageDays < 2) {
    candidates.push({ url: `${SPC_BASE}/yesterday_hail.csv`, prefix: `spc-y-${date}` });
  }
  candidates.push({
    url: `${SPC_BASE}/${formatYymmdd(target)}_rpts_hail.csv`,
    prefix: `spc-arch-${date}`,
  });

  for (const { url, prefix } of candidates) {
    const csv = await fetchSpcCsv(url);
    if (!csv) continue;
    const reports = parseSpcHailCsv(csv, target, prefix);
    if (reports.length > 0) return reports;
  }
  return [];
}
