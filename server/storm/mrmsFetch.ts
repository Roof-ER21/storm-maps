/**
 * MRMS GRIB2 fetcher — pulls MESH_Max_1440min hourly grids from IEM MTArchive.
 *
 * Path layout (verified 2026-04):
 *   https://mtarchive.geol.iastate.edu/YYYY/MM/DD/mrms/ncep/MESH_Max_1440min/
 *     MESH_Max_1440min_00.50_YYYYMMDD-HHMMSS.grib2.gz
 *
 * MRMS publishes a new file every ~2 minutes; the .grib2.gz files persist
 * for at least 2 years on IEM. For a 24-hour composite view we pick the
 * file closest to 23:58:00 UTC (the day's last frame). For a different
 * "anchor" timestamp (e.g. when the storm hit), the caller can override.
 *
 * Returns the gunzipped raw GRIB2 bytes; decode happens in `mrmsDecode.ts`.
 */

import { inflate } from 'pako';

const IEM_BASE = 'https://mtarchive.geol.iastate.edu';
const FETCH_TIMEOUT_MS = 30_000;

export interface MrmsFile {
  url: string;
  date: string;
  refTime: string;
  grib2Bytes: Uint8Array;
}

function pad(n: number, w = 2): string {
  return String(n).padStart(w, '0');
}

/**
 * IEM publishes MESH_Max_1440min on a 30-minute cadence (HH:00 + HH:30).
 * Round any anchor down to the nearest half-hour so we hit a real file.
 */
function roundToHalfHour(d: Date): Date {
  const m = d.getUTCMinutes();
  const rounded = m < 30 ? 0 : 30;
  const out = new Date(d);
  out.setUTCMinutes(rounded, 0, 0);
  return out;
}

/**
 * Build candidate URLs for a given date + anchor time. Tries the anchor
 * first, then walks back in 30-min steps to the start of the day, then
 * walks forward — covers the common case where we want the day's last
 * complete 24-h composite (latest file) but want to retry earlier files
 * if the latest is missing.
 */
function buildCandidateUrls(date: string, anchorIso: string): string[] {
  // Default anchor: 23:30 UTC (last published file of the day).
  const anchor = anchorIso ? new Date(anchorIso) : new Date(`${date}T23:30:00Z`);
  const target = Number.isFinite(anchor.getTime())
    ? roundToHalfHour(anchor)
    : roundToHalfHour(new Date(`${date}T23:30:00Z`));

  const yyyy = pad(target.getUTCFullYear(), 4);
  const mm = pad(target.getUTCMonth() + 1);
  const dd = pad(target.getUTCDate());
  const dir = `${IEM_BASE}/${yyyy}/${mm}/${dd}/mrms/ncep/MESH_Max_1440min`;

  const buildName = (t: Date): string => {
    const yh = pad(t.getUTCHours());
    const ym = pad(t.getUTCMinutes());
    return `MESH_Max_1440min_00.50_${pad(t.getUTCFullYear(), 4)}${pad(t.getUTCMonth() + 1)}${pad(t.getUTCDate())}-${yh}${ym}00.grib2.gz`;
  };

  const urls: string[] = [`${dir}/${buildName(target)}`];

  // Walk back up to 12 hours, then forward up to 6 hours. Far more than
  // enough — IEM rarely has gaps that wide.
  for (let step = 1; step <= 24; step += 1) {
    const back = new Date(target.getTime() - step * 30 * 60 * 1000);
    const fwd = new Date(target.getTime() + step * 30 * 60 * 1000);
    urls.push(`${dir}/${buildName(back)}`);
    if (step <= 12) urls.push(`${dir}/${buildName(fwd)}`);
  }

  return urls;
}

async function tryFetch(url: string): Promise<Uint8Array | null> {
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(url, {
      signal: ac.signal,
      headers: { 'User-Agent': 'HailYes/1.0 (storm-intelligence-app)' },
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const ab = await res.arrayBuffer();
    return new Uint8Array(ab);
  } catch {
    return null;
  }
}

export async function fetchMrmsMesh1440(opts: {
  date: string;
  anchorIso?: string;
}): Promise<MrmsFile | null> {
  const candidates = buildCandidateUrls(opts.date, opts.anchorIso ?? '');
  for (const url of candidates) {
    const gz = await tryFetch(url);
    if (!gz || gz.length < 64) continue;
    try {
      const grib2Bytes = inflate(gz);
      // Parse the timestamp from the URL filename for refTime.
      const match = url.match(/(\d{8})-(\d{6})\.grib2\.gz$/);
      const refTime = match
        ? `${match[1].slice(0, 4)}-${match[1].slice(4, 6)}-${match[1].slice(6, 8)}T${match[2].slice(0, 2)}:${match[2].slice(2, 4)}:${match[2].slice(4, 6)}Z`
        : `${opts.date}T23:58:00Z`;
      return { url, date: opts.date, refTime, grib2Bytes };
    } catch (err) {
      console.warn('[mrms] gzip inflate failed for', url, err);
      continue;
    }
  }
  return null;
}
