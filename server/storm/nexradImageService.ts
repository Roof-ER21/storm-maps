/**
 * NEXRAD radar imagery service — uses IEM's WMS-T endpoint for time-stamped
 * base reflectivity (N0R) snapshots.
 *
 * IEM hosts a redistribution of NWS NEXRAD Level III mosaics and serves them
 * via WMS with a `TIME` parameter. We use it for static PNGs embedded in the
 * adjuster PDF — much lighter than fetching Level II from AWS S3 and
 * decoding ourselves.
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
 */

const IEM_NEXRAD_BASE =
  'https://mesonet.agron.iastate.edu/cgi-bin/wms/nexrad/n0r-t.cgi';
const FETCH_TIMEOUT_MS = 20_000;

export interface NexradSnapshotInput {
  /** ISO 8601 UTC. Snapped to the nearest 5-min boundary IEM publishes. */
  timeIso: string;
  bbox: { north: number; south: number; east: number; west: number };
  /** Image dimensions in px. Default 600×400. */
  width?: number;
  height?: number;
}

function snapToFiveMin(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const m = d.getUTCMinutes();
  d.setUTCMinutes(Math.floor(m / 5) * 5, 0, 0);
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function buildNexradSnapshotUrl(input: NexradSnapshotInput): string {
  const w = input.width ?? 600;
  const h = input.height ?? 400;
  const params = new URLSearchParams({
    SERVICE: 'WMS',
    REQUEST: 'GetMap',
    VERSION: '1.1.1',
    LAYERS: 'nexrad-n0r-wmst',
    STYLES: '',
    SRS: 'EPSG:4326',
    BBOX: `${input.bbox.west},${input.bbox.south},${input.bbox.east},${input.bbox.north}`,
    WIDTH: String(w),
    HEIGHT: String(h),
    TIME: snapToFiveMin(input.timeIso),
    FORMAT: 'image/png',
    TRANSPARENT: 'TRUE',
  });
  return `${IEM_NEXRAD_BASE}?${params.toString()}`;
}

/**
 * Fetch a NEXRAD snapshot as PNG bytes for embedding in PDFKit. Returns
 * null on any failure — caller should fall through gracefully.
 */
export async function fetchNexradSnapshot(
  input: NexradSnapshotInput,
): Promise<Buffer | null> {
  const url = buildNexradSnapshotUrl(input);
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(url, {
      signal: ac.signal,
      headers: { 'User-Agent': 'HailYes/1.0 (storm-intelligence-app)' },
    });
    clearTimeout(timer);
    if (!res.ok) {
      console.warn(`[nexrad] HTTP ${res.status} for ${input.timeIso}`);
      return null;
    }
    const ab = await res.arrayBuffer();
    if (ab.byteLength < 200) {
      // IEM serves a tiny "no data" image for times outside the archive
      // window — treat anything <200 bytes as absent.
      return null;
    }
    return Buffer.from(ab);
  } catch (err) {
    console.warn('[nexrad] fetch failed:', (err as Error).message);
    return null;
  }
}
