/**
 * mPING (Meteorological Phenomena Identification Near the Ground).
 *
 * NOAA/NSSL crowdsourced ground-truth feed — phone-app reports of
 * hail/wind/tornado submitted by humans observing the actual event.
 *
 * Endpoint:
 *   GET https://mping.ou.edu/mping/api/v2/reports/
 *     ?obtime_gte=ISO&obtime_lte=ISO&category=Hail
 *     &north=N&south=S&east=E&west=W
 *
 * Auth: free public token, env var `MPING_API_TOKEN`.
 *
 * Status note (2026-04-30): the public endpoint has been returning HTTP
 * 404 since approximately April 2026 — same outage hitting multiple
 * crowdsource clients in this generation of the backend. We keep the
 * client wired so that when upstream comes back the consilience source
 * activates with no code change. While offline, the source contributes 0
 * confirmations and is annotated "endpoint offline" in the result.
 */

const MPING_BASE = "https://mping.ou.edu/mping/api/v2/reports/";
const FETCH_TIMEOUT_MS = 8_000;

export interface MpingReport {
  id: string;
  /** ISO 8601 UTC. */
  time: string;
  category: string;
  description: string;
  /** Hail diameter inches (parsed from description, 0 if unknown). */
  hail_size_inches: number;
  lat: number;
  lng: number;
}

export interface MpingFetchResult {
  reports: MpingReport[];
  /** True when the upstream endpoint is reachable; false when 404/timeout. */
  endpoint_online: boolean;
  /** Brief reason when offline. */
  offline_reason: string | null;
}

let cachedOffline = false;
let lastProbeAt = 0;
const RE_PROBE_AFTER_MS = 60 * 60 * 1000;

const cache = new Map<string, { result: MpingFetchResult; expiresAt: number }>();
const CACHE_TTL_MS = 30 * 60 * 1000;

function bboxAround(lat: number, lng: number, miles: number): { n: number; s: number; e: number; w: number } {
  const milesPerLat = 69;
  const milesPerLng = 69 * Math.max(0.05, Math.cos((lat * Math.PI) / 180));
  return {
    n: lat + miles / milesPerLat, s: lat - miles / milesPerLat,
    e: lng + miles / milesPerLng, w: lng - miles / milesPerLng,
  };
}

function parseHailSize(desc: string): number {
  // mPING descriptions look like: "Quarter (1.00 in.)" / "Penny (0.75 in.)"
  const m = desc.match(/(\d+\.?\d*)\s*in/i);
  if (m && m[1]) {
    const v = parseFloat(m[1]);
    if (Number.isFinite(v)) return v;
  }
  // Word fallbacks (rough)
  const lower = desc.toLowerCase();
  if (lower.includes("pea")) return 0.25;
  if (lower.includes("dime")) return 0.7;
  if (lower.includes("nickel")) return 0.875;
  if (lower.includes("quarter")) return 1.0;
  if (lower.includes("half dollar")) return 1.25;
  if (lower.includes("walnut")) return 1.5;
  if (lower.includes("golf")) return 1.75;
  if (lower.includes("tennis")) return 2.5;
  if (lower.includes("baseball")) return 2.75;
  if (lower.includes("softball")) return 4.0;
  return 0;
}

export async function fetchMpingHailReports(opts: {
  date: string;
  lat: number;
  lng: number;
  radiusMiles?: number;
}): Promise<MpingFetchResult> {
  const radius = opts.radiusMiles ?? 30;
  const key = `${opts.date}|${opts.lat.toFixed(2)}|${opts.lng.toFixed(2)}|${radius}`;
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.expiresAt > now) return hit.result;

  // Short-circuit while we know the endpoint is offline (re-probe every 60 min)
  if (cachedOffline && (now - lastProbeAt) < RE_PROBE_AFTER_MS) {
    const offline: MpingFetchResult = {
      reports: [], endpoint_online: false,
      offline_reason: "mPING upstream returned 404 — re-probing in ≤ 60 min",
    };
    cache.set(key, { result: offline, expiresAt: now + 5 * 60 * 1000 });
    return offline;
  }

  const token = process.env.MPING_API_TOKEN ?? "";
  const bbox = bboxAround(opts.lat, opts.lng, radius);
  const params = new URLSearchParams({
    obtime_gte: `${opts.date}T00:00:00Z`,
    obtime_lte: `${opts.date}T23:59:59Z`,
    category: "Hail",
    north: bbox.n.toFixed(4), south: bbox.s.toFixed(4),
    east: bbox.e.toFixed(4),  west:  bbox.w.toFixed(4),
  });
  const url = `${MPING_BASE}?${params.toString()}`;

  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(url, {
      signal: ac.signal,
      headers: {
        "User-Agent": "storm-archive/0.2 (+storm-intelligence)",
        ...(token ? { Authorization: `Token ${token}` } : {}),
      },
    });
    clearTimeout(timer);
    lastProbeAt = now;
    if (res.status === 404) {
      cachedOffline = true;
      const offline: MpingFetchResult = {
        reports: [], endpoint_online: false,
        offline_reason: "mPING upstream returned 404",
      };
      cache.set(key, { result: offline, expiresAt: now + 5 * 60 * 1000 });
      return offline;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    cachedOffline = false;
    const json = await res.json() as { results?: Array<{
      id?: number; obtime?: string; category?: string;
      description?: string; geom?: { coordinates?: [number, number] };
    }> };
    const reports = (json.results ?? []).map((r) => ({
      id: String(r.id ?? ""),
      time: r.obtime ?? "",
      category: r.category ?? "Hail",
      description: r.description ?? "",
      hail_size_inches: parseHailSize(r.description ?? ""),
      lng: r.geom?.coordinates?.[0] ?? 0,
      lat: r.geom?.coordinates?.[1] ?? 0,
    }));
    const result: MpingFetchResult = {
      reports, endpoint_online: true, offline_reason: null,
    };
    cache.set(key, { result, expiresAt: now + CACHE_TTL_MS });
    return result;
  } catch (err) {
    return {
      reports: [], endpoint_online: false,
      offline_reason: err instanceof Error ? err.message : String(err),
    };
  }
}
