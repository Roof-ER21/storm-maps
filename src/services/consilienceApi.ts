/**
 * Client-side consilience helper. Hits the server's `/api/storm/consilience`
 * endpoint and returns a slim shape the dashboard's yellow-flag indicator
 * cares about.
 *
 * Cache strategy: in-memory keyed by `${date}:${latBucket}:${lngBucket}` so
 * re-renders / toggles don't refire. Browser HTTP cache (10min) covers cross-
 * tab sharing.
 */

const API_BASE = '/api/storm/consilience';
const memCache = new Map<string, ConsilienceFlag>();

export interface ConsilienceFlag {
  confirmedCount: number;
  /** Configured-source denominator (12 normally, 11 without HailTrace token). */
  totalSources: number;
  confidenceTier:
    | 'none'
    | 'single'
    | 'cross-verified'
    | 'triple-verified'
    | 'quadruple-verified'
    | 'quintuple-verified'
    | 'sextuple-verified'
    | 'septuple-verified'
    | 'octuple-verified'
    | 'nontuple-verified'
    | 'decuple-verified'
    | 'undecuple-verified'
    | 'duodecuple-verified';
  /** <2 sources confirm — yellow caution flag. */
  lowConfidence: boolean;
  /** ≥3 sources confirm — green certified badge (matches PDF's Forensic Verification). */
  certified: boolean;
}

function cacheKey(lat: number, lng: number, date: string): string {
  return `${date}:${lat.toFixed(3)}:${lng.toFixed(3)}`;
}

export async function fetchConsilienceFlag(
  lat: number,
  lng: number,
  date: string,
): Promise<ConsilienceFlag | null> {
  const key = cacheKey(lat, lng, date);
  const hit = memCache.get(key);
  if (hit) return hit;
  try {
    const url = `${API_BASE}?lat=${lat}&lng=${lng}&date=${encodeURIComponent(date)}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = (await res.json()) as {
      confirmedCount: number;
      totalSources?: number;
      confidenceTier: ConsilienceFlag['confidenceTier'];
    };
    const flag: ConsilienceFlag = {
      confirmedCount: data.confirmedCount,
      // Pre-12-source cache rows ship without totalSources — fall back to 12.
      totalSources: data.totalSources ?? 12,
      confidenceTier: data.confidenceTier,
      lowConfidence: data.confirmedCount < 2,
      certified: data.confirmedCount >= 3,
    };
    memCache.set(key, flag);
    return flag;
  } catch {
    return null;
  }
}
