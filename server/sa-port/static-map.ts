/**
 * Google Static Maps API wrapper for the adjuster PDF.
 *
 * Renders a small property-location image (with a red pin) for the
 * Property Information block, and a wider area map for the storm
 * activity section.
 *
 * Requires GOOGLE_MAPS_API_KEY env var (already configured).
 */

const STATIC_MAPS = "https://maps.googleapis.com/maps/api/staticmap";
const FETCH_TIMEOUT_MS = 8_000;

const KEY = process.env.GOOGLE_MAPS_API_KEY ?? null;

export function staticMapsConfigured(): boolean {
  return !!KEY;
}

export interface PropertyMapOpts {
  lat: number;
  lng: number;
  /** Pixel size. Max 640×640 standard, 1280×1280 with scale=2. */
  width?: number;
  height?: number;
  /** Zoom 0–20. 16 = ~city block, 13 = neighborhood, 10 = metro. */
  zoom?: number;
  /** "roadmap" | "satellite" | "hybrid" | "terrain". */
  maptype?: "roadmap" | "satellite" | "hybrid" | "terrain";
}

export async function fetchPropertyMap(opts: PropertyMapOpts): Promise<Buffer | null> {
  if (!KEY) return null;
  const w = Math.min(640, Math.max(120, opts.width ?? 200));
  const h = Math.min(640, Math.max(120, opts.height ?? 160));
  const zoom = Math.min(20, Math.max(0, opts.zoom ?? 16));
  const params = new URLSearchParams({
    center: `${opts.lat.toFixed(6)},${opts.lng.toFixed(6)}`,
    zoom: String(zoom),
    size: `${w}x${h}`,
    scale: "2",
    maptype: opts.maptype ?? "roadmap",
    markers: `color:red|${opts.lat.toFixed(6)},${opts.lng.toFixed(6)}`,
    key: KEY,
  });
  return await fetch_(`${STATIC_MAPS}?${params.toString()}`);
}

export interface AreaMapOpts {
  lat: number;
  lng: number;
  /** Highlight this hail polygon (GeoJSON MultiPolygon coordinates). */
  swathPolygon?: number[][][][] | null;
  /** Polygon stroke/fill color. */
  swathColor?: string;
  width?: number;
  height?: number;
  zoom?: number;
}

/**
 * Wider regional map showing the property pin + (optionally) a hail swath
 * polygon overlaid as a colored region. Used for the per-storm detail
 * section of the PDF.
 */
export async function fetchAreaMap(opts: AreaMapOpts): Promise<Buffer | null> {
  if (!KEY) return null;
  const w = Math.min(640, Math.max(200, opts.width ?? 480));
  const h = Math.min(640, Math.max(200, opts.height ?? 320));
  const zoom = Math.min(20, Math.max(0, opts.zoom ?? 10));

  const params = new URLSearchParams({
    center: `${opts.lat.toFixed(6)},${opts.lng.toFixed(6)}`,
    zoom: String(zoom),
    size: `${w}x${h}`,
    scale: "2",
    maptype: "roadmap",
    markers: `color:red|${opts.lat.toFixed(6)},${opts.lng.toFixed(6)}`,
    key: KEY,
  });

  // Append polygon paths if provided. Google Static Maps caps URL length
  // at 16,384 chars; we sample the polygon down to keep within that.
  if (opts.swathPolygon && opts.swathPolygon.length > 0) {
    const color = (opts.swathColor ?? "#FF8800").replace("#", "0x") + "AA";
    for (const polygon of opts.swathPolygon.slice(0, 3)) {
      if (!polygon[0]) continue;
      const sampled = samplePoints(polygon[0], 32);
      const pathStr = `color:${color}|fillcolor:${color}|weight:1|` +
        sampled.map((pt) => {
          const [lng, lat] = pt;
          if (lng == null || lat == null) return "";
          return `${lat.toFixed(4)},${lng.toFixed(4)}`;
        }).filter((s) => s.length > 0).join("|");
      params.append("path", pathStr);
    }
  }

  return await fetch_(`${STATIC_MAPS}?${params.toString()}`);
}

function samplePoints(ring: number[][], target: number): number[][] {
  if (ring.length <= target) return ring;
  const step = Math.max(1, Math.floor(ring.length / target));
  const out: number[][] = [];
  for (let i = 0; i < ring.length; i += step) out.push(ring[i]!);
  // Always close the ring
  if (out[out.length - 1] !== ring[ring.length - 1]) out.push(ring[ring.length - 1]!);
  return out;
}

async function fetch_(url: string): Promise<Buffer | null> {
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(url, {
      signal: ac.signal,
      headers: { "User-Agent": "storm-archive/0.1" },
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const ab = await res.arrayBuffer();
    if (ab.byteLength < 1000) return null;
    return Buffer.from(ab);
  } catch {
    return null;
  }
}
