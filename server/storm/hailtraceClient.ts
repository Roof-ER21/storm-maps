/**
 * HailTrace cross-validator — optional 7th consilience source.
 *
 * HailTrace (hailtrace.com) is a commercial hail-event database used by
 * insurance adjusters. Their API gives near-real-time + historical hail
 * reports with their own QC + "meteorologist-certified" stamp on premium
 * tiers.
 *
 * Auth:
 *   - HAILTRACE_API_TOKEN env var (paid subscription required)
 *   - Returns empty array when token isn't set (silent skip)
 *
 * This is a thin wrapper — sa21 has its own deeper HailTrace import path
 * that bulk-loads into a separate table. For consilience we only need the
 * "did HailTrace see hail at this lat/lng on this date?" signal.
 *
 * NOTE: Endpoint shape and response format are subject to HailTrace's API
 * terms. Check their docs at https://hailtrace.com/api/ before deploying;
 * this client uses the most-commonly-documented v2 search shape.
 */

const HT_BASE = process.env.HAILTRACE_API_BASE?.trim() || 'https://api.hailtrace.com/v2';
const FETCH_TIMEOUT_MS = 15_000;

export interface HailtraceReport {
  id: string;
  /** ISO 8601 UTC timestamp. */
  time: string;
  lat: number;
  lng: number;
  /** Hail size inches (HailTrace algorithm). */
  sizeInches: number;
  /** HailTrace internal certification status (best-effort parse). */
  certified?: boolean;
  source: 'HailTrace';
}

export function isHailtraceConfigured(): boolean {
  return Boolean(process.env.HAILTRACE_API_TOKEN?.trim());
}

interface HailtraceApiHit {
  id?: string | number;
  time?: string;
  timestamp?: string;
  lat?: number | string;
  latitude?: number | string;
  lng?: number | string;
  longitude?: number | string;
  size_inches?: number | string;
  hail_size?: number | string;
  certified?: boolean;
  status?: string;
}

interface HailtraceApiResponse {
  results?: HailtraceApiHit[];
  data?: HailtraceApiHit[];
}

export interface HailtraceQuery {
  startUtc: Date;
  endUtc: Date;
  bbox: { north: number; south: number; east: number; west: number };
  /** Optional minimum hail size threshold (inches). Default 0.25. */
  minSizeInches?: number;
}

export async function fetchHailtraceReports(
  q: HailtraceQuery,
): Promise<HailtraceReport[]> {
  if (!isHailtraceConfigured()) return [];
  const token = process.env.HAILTRACE_API_TOKEN!.trim();
  const params = new URLSearchParams({
    start: q.startUtc.toISOString(),
    end: q.endUtc.toISOString(),
    north: String(q.bbox.north),
    south: String(q.bbox.south),
    east: String(q.bbox.east),
    west: String(q.bbox.west),
    min_size: String(q.minSizeInches ?? 0.25),
  });
  const url = `${HT_BASE}/hail/search?${params.toString()}`;
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(url, {
      signal: ac.signal,
      headers: {
        Authorization: `Bearer ${token}`,
        'User-Agent': 'HailYes/1.0 (storm-intelligence-app)',
      },
    });
    clearTimeout(timer);
    if (!res.ok) {
      console.warn(`[hailtrace] HTTP ${res.status}`);
      return [];
    }
    const data = (await res.json()) as HailtraceApiResponse;
    const hits = data.results ?? data.data ?? [];
    const out: HailtraceReport[] = [];
    for (const h of hits) {
      const lat = numOr(h.lat, h.latitude);
      const lng = numOr(h.lng, h.longitude);
      const size = numOr(h.size_inches, h.hail_size);
      const time = h.time ?? h.timestamp;
      if (
        lat === null ||
        lng === null ||
        size === null ||
        !time ||
        size <= 0
      ) {
        continue;
      }
      out.push({
        id: String(h.id ?? `ht-${time}-${lat.toFixed(3)}-${lng.toFixed(3)}`),
        time,
        lat,
        lng,
        sizeInches: size,
        certified:
          h.certified === true ||
          (typeof h.status === 'string' && /certif/i.test(h.status)),
        source: 'HailTrace',
      });
    }
    return out;
  } catch (err) {
    console.warn('[hailtrace] fetch failed:', (err as Error).message);
    return [];
  }
}

function numOr(...values: Array<number | string | undefined>): number | null {
  for (const v of values) {
    if (v === undefined || v === null) continue;
    const n = typeof v === 'number' ? v : parseFloat(String(v));
    if (Number.isFinite(n)) return n;
  }
  return null;
}

export async function fetchHailtraceReportsForDate(opts: {
  date: string;
  bbox: { north: number; south: number; east: number; west: number };
}): Promise<HailtraceReport[]> {
  const startUtc = new Date(`${opts.date}T04:00:00Z`);
  const endUtc = new Date(`${opts.date}T00:00:00Z`);
  endUtc.setUTCDate(endUtc.getUTCDate() + 1);
  endUtc.setUTCHours(12, 0, 0, 0);
  return fetchHailtraceReports({ startUtc, endUtc, bbox: opts.bbox });
}
