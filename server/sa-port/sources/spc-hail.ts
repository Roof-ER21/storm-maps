/**
 * SPC (Storm Prediction Center) hail reports — live CSV fetch.
 *
 * SPC publishes daily hail/wind/tornado roll-ups at:
 *   today_hail.csv
 *   yesterday_hail.csv
 *   YYMMDD_rpts_hail.csv     (archive, available ~24h after the date)
 *
 * Format: Time,Size,Location,County,State,Lat,Lon,Comments
 * Time is HHMM CST (yes, CST year-round per SPC convention).
 * Size is hailstone diameter in 1/100 inch (175 = 1.75″).
 *
 * Public, no auth. Free, fast (~5KB CSV).
 */

const SPC_BASE = "https://www.spc.noaa.gov/climo/reports";
const FETCH_TIMEOUT_MS = 8_000;

export interface SpcHailReport {
  /** "HHMM CST" zero-padded, e.g. "1854". */
  time_cst: string;
  /** Hail diameter in inches (parsed from the SPC 1/100-inch field). */
  size_inches: number;
  location: string;
  county: string;
  state: string;
  lat: number;
  lng: number;
  comments: string;
}

const cache = new Map<string, { reports: SpcHailReport[]; expiresAt: number }>();
const CACHE_TTL_MS = 30 * 60 * 1000;

function ymdToYymmdd(date: string): string {
  // "2026-04-15" → "260415"
  const m = date.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return "";
  return `${m[1]!.slice(2)}${m[2]}${m[3]}`;
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function yesterdayUtc(): string {
  return new Date(Date.now() - 24 * 3600_000).toISOString().slice(0, 10);
}

/**
 * Pick the right SPC URL for the given date:
 *   - today  → today_hail.csv
 *   - y'day  → yesterday_hail.csv
 *   - older  → YYMMDD_rpts_hail.csv  (waits ~24h after the date)
 */
function urlsForDate(date: string): string[] {
  const today = todayUtc();
  const yest = yesterdayUtc();
  if (date === today) return [`${SPC_BASE}/today_hail.csv`];
  if (date === yest) return [`${SPC_BASE}/yesterday_hail.csv`];
  const yymmdd = ymdToYymmdd(date);
  return [`${SPC_BASE}/${yymmdd}_rpts_hail.csv`];
}

function parseCsv(text: string): SpcHailReport[] {
  const out: SpcHailReport[] = [];
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length === 0) return out;
  // SPC sometimes repeats the header row mid-file when wind/tornado tables
  // get appended. Skip any line that starts with "Time,Size".
  for (const line of lines) {
    if (line.startsWith("Time,Size")) continue;
    // Split with a careful regex — Comments can contain commas, so we
    // split into 8 fields max.
    const parts = splitCsvLine(line, 8);
    if (parts.length < 7) continue;
    const [time, sizeRaw, loc, county, state, latRaw, lngRaw, ...rest] = parts;
    const size = parseInt(sizeRaw ?? "", 10);
    const lat = parseFloat(latRaw ?? "");
    const lng = parseFloat(lngRaw ?? "");
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    if (!Number.isFinite(size)) continue;
    out.push({
      time_cst: (time ?? "").padStart(4, "0"),
      size_inches: size / 100,
      location: loc ?? "",
      county: county ?? "",
      state: state ?? "",
      lat, lng,
      comments: rest.join(",") || "",
    });
  }
  return out;
}

function splitCsvLine(line: string, maxFields: number): string[] {
  const out: string[] = [];
  let buf = "", inQuote = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i]!;
    if (c === '"') { inQuote = !inQuote; continue; }
    if (c === "," && !inQuote && out.length < maxFields - 1) {
      out.push(buf); buf = ""; continue;
    }
    buf += c;
  }
  out.push(buf);
  return out;
}

/**
 * Fetch SPC hail reports for one date (UTC). Filters down to the
 * specified state if given. Cached 30 minutes.
 */
export async function fetchSpcHailForDate(opts: {
  date: string;          // YYYY-MM-DD
  state?: string | null; // optional state filter
}): Promise<SpcHailReport[]> {
  const key = `${opts.date}|${opts.state ?? ""}`;
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.expiresAt > now) return hit.reports;

  for (const url of urlsForDate(opts.date)) {
    try {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
      const res = await fetch(url, {
        signal: ac.signal,
        headers: { "User-Agent": "storm-archive/0.2 (+storm-intelligence)" },
      });
      clearTimeout(timer);
      if (!res.ok) continue;
      const csv = await res.text();
      let reports = parseCsv(csv);
      if (opts.state) {
        const target = opts.state.toUpperCase();
        reports = reports.filter((r) => r.state.toUpperCase() === target);
      }
      cache.set(key, { reports, expiresAt: now + CACHE_TTL_MS });
      return reports;
    } catch { /* try next URL */ }
  }

  cache.set(key, { reports: [], expiresAt: now + CACHE_TTL_MS });
  return [];
}
