/**
 * CoCoRaHS — Community Collaborative Rain, Hail and Snow Network.
 *
 * Citizen-scientist precip + hail observers (~30K active reporters in 2026).
 * Free, no key. Different from mPING: mPING is real-time crowd via app;
 * CoCoRaHS is structured daily reports from registered observers with
 * standardized hail-pad measurements.
 *
 * 2026 partnership: NASA SEaRCH project is increasing southeast-US density.
 *
 * Endpoint pattern (CSV export):
 *   https://data.cocorahs.org/cocorahs/export/exporthailreports.aspx
 *     ?ReportDateType=ReportDate&Format=CSV
 *     &State={STATE}&date={MM/DD/YYYY}
 *
 * The CoCoRaHS API is undocumented and occasionally flaky — we wrap with
 * generous timeout + try/catch so a CoCoRaHS outage doesn't block consilience.
 */

const COCORAHS_BASE =
  'https://data.cocorahs.org/cocorahs/export/exporthailreports.aspx';
const FETCH_TIMEOUT_MS = 20_000;

export interface CocorahsHailReport {
  /** ISO 8601 timestamp. */
  time: string;
  lat: number;
  lng: number;
  /** Reported hail size in inches (max stone). */
  hailSizeInches: number;
  /** Duration of hail in minutes (when reported). */
  durationMinutes: number | null;
  observerStation: string | null;
  state: string | null;
  county: string | null;
}

export interface CocorahsQuery {
  /** YYYY-MM-DD (Eastern calendar day). */
  date: string;
  state: string;
  /** Optional bbox to filter results client-side. */
  bbox?: { north: number; south: number; east: number; west: number };
}

function formatDateMmDdYyyy(isoDate: string): string {
  const [yyyy, mm, dd] = isoDate.split('-');
  return `${mm}/${dd}/${yyyy}`;
}

export async function fetchCocorahsHailReports(
  q: CocorahsQuery,
): Promise<CocorahsHailReport[]> {
  const params = new URLSearchParams({
    ReportDateType: 'ReportDate',
    Format: 'CSV',
    State: q.state.toUpperCase(),
    date: formatDateMmDdYyyy(q.date),
  });
  const url = `${COCORAHS_BASE}?${params.toString()}`;
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(url, {
      signal: ac.signal,
      headers: { 'User-Agent': 'HailYes/1.0 (storm-intelligence-app)' },
    });
    clearTimeout(timer);
    if (!res.ok) {
      // CoCoRaHS occasionally returns 500 or HTML error pages — log + empty.
      console.warn(`[cocorahs] HTTP ${res.status} for ${q.state} ${q.date}`);
      return [];
    }
    const text = await res.text();
    if (!text || text.trim().length < 50) return [];
    return parseCocorahsCsv(text, q.bbox);
  } catch (err) {
    console.warn('[cocorahs] fetch failed:', (err as Error).message);
    return [];
  }
}

function parseCocorahsCsv(
  csv: string,
  bbox?: CocorahsQuery['bbox'],
): CocorahsHailReport[] {
  // CoCoRaHS hail-export CSV doesn't have a fully stable schema, but the
  // common columns observed: StationNumber, StationName, Latitude,
  // Longitude, Date, Time, MaxHailSize_Inches, HailDuration_minutes,
  // State, County. Defensive parse: build column map by header name.
  const lines = csv.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];
  const headers = lines[0]
    .split(',')
    .map((h) => h.trim().replace(/^"|"$/g, '').toLowerCase());
  const idx = (...names: string[]): number => {
    for (const n of names) {
      const j = headers.findIndex((h) => h.includes(n.toLowerCase()));
      if (j !== -1) return j;
    }
    return -1;
  };
  const iLat = idx('latitude', 'lat');
  const iLng = idx('longitude', 'lng');
  const iSize = idx('maxhailsize', 'hailsize', 'maxstone');
  const iDate = idx('date');
  const iTime = idx('time');
  const iDur = idx('duration', 'hailduration');
  const iStation = idx('stationnumber', 'station');
  const iState = idx('state');
  const iCounty = idx('county');

  if (iLat < 0 || iLng < 0) return [];

  const out: CocorahsHailReport[] = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cols = parseCsvLine(lines[i]);
    const lat = parseFloat(cols[iLat] ?? '');
    const lng = parseFloat(cols[iLng] ?? '');
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    if (
      bbox &&
      (lat < bbox.south ||
        lat > bbox.north ||
        lng < bbox.west ||
        lng > bbox.east)
    ) {
      continue;
    }
    const sizeRaw = (cols[iSize] ?? '').toString().trim();
    const size = parseFloat(sizeRaw);
    if (!Number.isFinite(size) || size <= 0) continue;
    const dateStr = (cols[iDate] ?? '').trim();
    const timeStr = (cols[iTime] ?? '').trim();
    const dur = parseFloat(cols[iDur] ?? '');
    out.push({
      time: combineDateTimeIso(dateStr, timeStr),
      lat,
      lng,
      hailSizeInches: size,
      durationMinutes: Number.isFinite(dur) ? dur : null,
      observerStation: cols[iStation]?.trim() || null,
      state: cols[iState]?.trim() || null,
      county: cols[iCounty]?.trim() || null,
    });
  }
  return out;
}

function parseCsvLine(line: string): string[] {
  // CoCoRaHS CSVs sometimes have quoted fields with commas inside — handle
  // a basic quoted/escaped-quote parse.
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function combineDateTimeIso(date: string, time: string): string {
  // CoCoRaHS reports are stamped in observer's local time; without TZ info
  // we treat them as ET (the focus territory). Fallback: midnight ET.
  const m = date.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (!m) return new Date().toISOString();
  const mm = m[1].padStart(2, '0');
  const dd = m[2].padStart(2, '0');
  const yyyy = m[3];
  let timePart = '07:00';
  const tm = (time || '').match(/^(\d{1,2}):(\d{2})/);
  if (tm) {
    timePart = `${tm[1].padStart(2, '0')}:${tm[2].padStart(2, '0')}`;
  }
  // Construct an ET-anchored ISO string; -04:00 (EDT) is the typical case
  // for hail season (Apr-Oct), -05:00 winter. Without month-specific lookup
  // we use -04:00 — the consilience time window has slack on either side
  // so a 1-hour TZ misalignment doesn't matter for confirmation purposes.
  return `${yyyy}-${mm}-${dd}T${timePart}:00-04:00`;
}
