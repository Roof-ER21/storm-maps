/**
 * NEXRAD radar imagery via IEM's WMS-T endpoint — time-stamped base
 * reflectivity (N0R) snapshots. Same source Hail Yes uses for its
 * adjuster PDF radar tiles; transparent PNG, 5-min archive grid.
 *
 * Endpoint:
 *   https://mesonet.agron.iastate.edu/cgi-bin/wms/nexrad/n0r-t.cgi
 *     ?SERVICE=WMS&REQUEST=GetMap&VERSION=1.1.1
 *     &LAYERS=nexrad-n0r-wmst
 *     &SRS=EPSG:4326
 *     &BBOX=west,south,east,north
 *     &WIDTH=600&HEIGHT=400
 *     &TIME=YYYY-MM-DDTHH:MM:00Z
 *     &FORMAT=image/png&TRANSPARENT=TRUE
 *
 * Falls through to null on miss/timeout/IEM hiccup; caller leaves the
 * radar slot blank or substitutes a Static Maps thumbnail.
 */

const IEM_NEXRAD_BASE = "https://mesonet.agron.iastate.edu/cgi-bin/wms/nexrad/n0r-t.cgi";
const FETCH_TIMEOUT_MS = 8_000;

export interface BBox { north: number; south: number; east: number; west: number; }

export function bboxAroundProperty(lat: number, lng: number, radiusMiles = 30): BBox {
  const milesPerLat = 69;
  const milesPerLng = 69 * Math.max(0.05, Math.cos((lat * Math.PI) / 180));
  return {
    north: lat + radiusMiles / milesPerLat,
    south: lat - radiusMiles / milesPerLat,
    east: lng + radiusMiles / milesPerLng,
    west: lng - radiusMiles / milesPerLng,
  };
}

function snapToFiveMin(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const ms = d.getTime();
  const fiveMin = 5 * 60 * 1000;
  const snapped = Math.round(ms / fiveMin) * fiveMin;
  return new Date(snapped).toISOString().replace(/\.\d{3}Z$/, "Z");
}

export interface NexradFetchOpts {
  /** ISO 8601 UTC. Snapped to nearest 5-min boundary IEM publishes. */
  timeIso: string;
  lat: number;
  lng: number;
  /** BBox radius miles. Default 30 mi (Hail Yes parity). */
  radiusMiles?: number;
  width?: number;
  height?: number;
}

export interface NexradFetchResult {
  buffer: Buffer;
  /** Snapped time used for the actual fetch — for caption/citation in PDF. */
  snappedIso: string;
  /** Source product label (NEXRAD N0R Base Reflectivity). */
  productLabel: string;
  bbox: BBox;
}

const cache = new Map<string, { buf: Buffer | null; snapped: string; bbox: BBox; expiresAt: number }>();
const CACHE_TTL_MS = 60 * 60 * 1000;
const CACHE_MAX = 32;

export async function fetchNexradSnapshot(
  opts: NexradFetchOpts,
): Promise<NexradFetchResult | null> {
  const snapped = snapToFiveMin(opts.timeIso);
  const bbox = bboxAroundProperty(opts.lat, opts.lng, opts.radiusMiles ?? 30);
  const key = `${snapped}|${opts.lat.toFixed(2)}|${opts.lng.toFixed(2)}`;
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.expiresAt > now) {
    cache.delete(key); cache.set(key, hit);
    return hit.buf ? { buffer: hit.buf, snappedIso: hit.snapped, productLabel: "NEXRAD N0R Base Reflectivity", bbox: hit.bbox } : null;
  }

  const w = opts.width ?? 600, h = opts.height ?? 400;
  const params = new URLSearchParams({
    SERVICE: "WMS", REQUEST: "GetMap", VERSION: "1.1.1",
    LAYERS: "nexrad-n0r-wmst", STYLES: "", SRS: "EPSG:4326",
    BBOX: `${bbox.west},${bbox.south},${bbox.east},${bbox.north}`,
    WIDTH: String(w), HEIGHT: String(h),
    TIME: snapped,
    FORMAT: "image/png", TRANSPARENT: "TRUE",
  });
  const url = `${IEM_NEXRAD_BASE}?${params.toString()}`;

  let buf: Buffer | null = null;
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(url, {
      signal: ac.signal,
      headers: { "User-Agent": "storm-archive/0.2 (storm-intelligence)" },
    });
    clearTimeout(timer);
    if (res.ok) {
      const ab = await res.arrayBuffer();
      // IEM serves a tiny "no data" PNG outside its archive window
      if (ab.byteLength >= 200) buf = Buffer.from(ab);
    }
  } catch { /* return null below */ }

  if (cache.size >= CACHE_MAX) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey !== undefined) cache.delete(oldestKey);
  }
  cache.set(key, { buf, snapped, bbox, expiresAt: now + CACHE_TTL_MS });

  return buf ? { buffer: buf, snappedIso: snapped, productLabel: "NEXRAD N0R Base Reflectivity", bbox } : null;
}

/**
 * Format snapped UTC ISO as the citation string seen on the Hail Yes PDF:
 *   "202604012043-KLWX-WUUS51-SVRLWX"
 * If we don't know the WFO/product header, use:
 *   "<YYYYMMDDHHMM>Z-NEXRAD-N0R"
 */
export function radarCitationLabel(snappedIso: string, wfo?: string | null): string {
  const m = snappedIso.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return snappedIso;
  const [, Y, Mo, D, H, Mi] = m;
  const stamp = `${Y}${Mo}${D}${H}${Mi}`;
  return wfo ? `${stamp}Z-K${wfo}-NEXRAD-N0R` : `${stamp}Z-NEXRAD-N0R`;
}
