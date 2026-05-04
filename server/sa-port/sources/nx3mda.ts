/**
 * NCEI SWDI nx3mda — NEXRAD Level-3 Mesocyclone Detection Algorithm.
 *
 * Catches rotation signatures (supercells, tornado-warning class) that
 * radar hail products miss. A confirming nx3mda detection at the property
 * radius is strong corroboration that the storm cell was severe enough to
 * cause damage.
 *
 * Endpoint:
 *   https://www.ncei.noaa.gov/swdiws/csv/nx3mda/{YYYYMMDDhhmm:YYYYMMDDhhmm}
 *     ?bbox=W,S,E,N
 *
 * Public, no auth. Returns CSV: ZTIME,WSR_ID,CELL_ID,STRENGTH,LAT,LON,...
 */

const SWDI_BASE = "https://www.ncei.noaa.gov/swdiws/csv/nx3mda";
const FETCH_TIMEOUT_MS = 12_000;

export interface MesocycloneDetection {
  /** ISO 8601 UTC. */
  time: string;
  /** Reporting WSR-88D radar (e.g. "KLWX"). */
  radar: string;
  /** 0–10ish scalar; ≥8 = tornado-warning class. */
  strength: number;
  lat: number;
  lng: number;
}

const cache = new Map<string, { detections: MesocycloneDetection[]; expiresAt: number }>();
const CACHE_TTL_MS = 60 * 60 * 1000;

function dayWindowUtc(date: string): { start: string; end: string } {
  // YYYY-MM-DD → YYYYMMDD0000 to YYYYMMDD2359 UTC
  const stripped = date.replace(/-/g, "");
  return { start: `${stripped}0000`, end: `${stripped}2359` };
}

function bboxAround(lat: number, lng: number, miles: number): { w: number; s: number; e: number; n: number } {
  const milesPerLat = 69;
  const milesPerLng = 69 * Math.max(0.05, Math.cos((lat * Math.PI) / 180));
  return {
    n: lat + miles / milesPerLat,
    s: lat - miles / milesPerLat,
    e: lng + miles / milesPerLng,
    w: lng - miles / milesPerLng,
  };
}

/**
 * Fetch NEXRAD mesocyclone detections within a bbox around (lat,lng) on
 * the given UTC calendar date.
 */
export async function fetchMesocycloneDetections(opts: {
  date: string;
  lat: number;
  lng: number;
  /** Bbox radius in miles. Default 30. */
  radiusMiles?: number;
}): Promise<MesocycloneDetection[]> {
  const radius = opts.radiusMiles ?? 30;
  const key = `${opts.date}|${opts.lat.toFixed(2)}|${opts.lng.toFixed(2)}|${radius}`;
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.expiresAt > now) return hit.detections;

  const { start, end } = dayWindowUtc(opts.date);
  const { w, s, e, n } = bboxAround(opts.lat, opts.lng, radius);
  const url =
    `${SWDI_BASE}/${start}:${end}?bbox=${w.toFixed(4)},${s.toFixed(4)},${e.toFixed(4)},${n.toFixed(4)}`;

  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(url, {
      signal: ac.signal,
      headers: { "User-Agent": "storm-archive/0.2 (+storm-intelligence)" },
    });
    clearTimeout(timer);
    if (!res.ok) {
      cache.set(key, { detections: [], expiresAt: now + CACHE_TTL_MS });
      return [];
    }
    const csv = await res.text();
    const detections = parseCsv(csv);
    cache.set(key, { detections, expiresAt: now + CACHE_TTL_MS });
    return detections;
  } catch {
    return [];
  }
}

function parseCsv(csv: string): MesocycloneDetection[] {
  const lines = csv.split(/\r?\n/).filter((l) => l.length > 0 && !l.startsWith("#"));
  if (lines.length === 0) return [];
  // Header: ZTIME,WSR_ID,CELL_ID,STRENGTH,...,LAT,LON,SHAPE
  const header = lines[0]!.split(",").map((h) => h.trim().toUpperCase());
  const idxTime = header.indexOf("ZTIME");
  const idxRadar = header.indexOf("WSR_ID");
  const idxStr = header.indexOf("STRENGTHRANK");      // newer schema
  const idxStrFallback = header.indexOf("STRENGTH");  // older schema
  const idxLat = header.indexOf("LAT");
  const idxLon = header.indexOf("LON");
  if (idxTime < 0 || idxLat < 0 || idxLon < 0) return [];

  const out: MesocycloneDetection[] = [];
  for (let i = 1; i < lines.length; i += 1) {
    const parts = lines[i]!.split(",");
    const t = parts[idxTime] ?? "";
    const lat = parseFloat(parts[idxLat] ?? "");
    const lng = parseFloat(parts[idxLon] ?? "");
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const strRaw = parts[idxStr >= 0 ? idxStr : idxStrFallback] ?? "0";
    out.push({
      time: parseSwdiTime(t),
      radar: parts[idxRadar] ?? "",
      strength: parseFloat(strRaw) || 0,
      lat, lng,
    });
  }
  return out;
}

/** SWDI ZTIME is "YYYYMMDDhhmm" or "YYYY-MM-DDTHH:MM:SS"; normalize to ISO. */
function parseSwdiTime(s: string): string {
  if (!s) return "";
  if (/^\d{12}$/.test(s)) {
    const Y = s.slice(0, 4), Mo = s.slice(4, 6), D = s.slice(6, 8);
    const H = s.slice(8, 10), Mi = s.slice(10, 12);
    return `${Y}-${Mo}-${D}T${H}:${Mi}:00Z`;
  }
  return s;
}
