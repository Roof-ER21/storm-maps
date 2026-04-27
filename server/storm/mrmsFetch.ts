/**
 * MRMS GRIB2 fetcher — IEM MTArchive.
 *
 * Two products:
 *   - `MESH_Max_60min`   60-min rolling max, published every ~2 min (live)
 *   - `MESH_Max_1440min` 24-hour rolling max, published every ~30 min (archive)
 *
 * Path layout (verified 2026-04):
 *   https://mtarchive.geol.iastate.edu/YYYY/MM/DD/mrms/ncep/<product>/
 *     <product>_00.50_YYYYMMDD-HHMMSS.grib2.gz
 *
 * Returns gunzipped raw GRIB2 bytes; decode happens in `grib2/{sections,decode}.ts`.
 */

import { inflate } from 'pako';

const IEM_BASE = 'https://mtarchive.geol.iastate.edu';
const FETCH_TIMEOUT_MS = 30_000;

export type MrmsProduct = 'MESH_Max_60min' | 'MESH_Max_1440min' | 'MESH';

export interface MrmsFile {
  url: string;
  date: string;
  refTime: string;
  product: MrmsProduct;
  grib2Bytes: Uint8Array;
}

interface ProductCadence {
  /** Step size in minutes for candidate file generation. */
  stepMinutes: number;
  /** How far back/forward to walk in steps. */
  walkBack: number;
  walkForward: number;
}

const CADENCE: Record<MrmsProduct, ProductCadence> = {
  // 60-min product is published every 2 min. Walk back ~60 min, forward ~10.
  MESH_Max_60min: { stepMinutes: 2, walkBack: 30, walkForward: 5 },
  // 1440-min product is published every 30 min. Walk back ~12h, forward ~6h.
  MESH_Max_1440min: { stepMinutes: 30, walkBack: 24, walkForward: 12 },
  // Instantaneous MESH — published every 2 min. Used by the historical
  // hourly scrubber because IEM only archives MESH/ + MESH_Max_1440min/
  // for older dates (no MESH_Max_60min/ for archive). Walk window keeps
  // a snapshot within ~30 min of the requested anchor.
  MESH: { stepMinutes: 2, walkBack: 30, walkForward: 15 },
};

function pad(n: number, w = 2): string {
  return String(n).padStart(w, '0');
}

function roundToCadence(d: Date, stepMinutes: number): Date {
  const m = d.getUTCMinutes();
  const rounded = Math.floor(m / stepMinutes) * stepMinutes;
  const out = new Date(d);
  out.setUTCMinutes(rounded, 0, 0);
  return out;
}

/**
 * Build candidate URLs for a given (product, date, anchor). Tries the anchor
 * first, walks back to fill earlier-than-anchor cadences, then forward.
 *
 * Filename prefix history: NOAA renamed the product file prefix from `MRMS_*`
 * to `MESH_*` around Sept 2022. Pre-2022-09 dates on the IEM mirror still use
 * the legacy `MRMS_*` filenames; post that, only `MESH_*`. So for older dates
 * we emit BOTH variants per timestep — one of them is the live file. Emitting
 * the `MESH_*` variant first keeps modern lookups fast; the `MRMS_*` fallback
 * only runs when the modern name 404s on older archives.
 */
const PREFIX_RENAME_DATE = '2022-09-01';

function buildCandidateUrls(
  product: MrmsProduct,
  date: string,
  anchorIso: string,
): string[] {
  const cad = CADENCE[product];
  // Default anchor: now if `date` is today, otherwise 23:30 UTC of `date`.
  const todayKey = new Date().toISOString().slice(0, 10);
  const defaultAnchor =
    date === todayKey ? new Date() : new Date(`${date}T23:30:00Z`);
  const anchor = anchorIso ? new Date(anchorIso) : defaultAnchor;
  const target = Number.isFinite(anchor.getTime())
    ? roundToCadence(anchor, cad.stepMinutes)
    : roundToCadence(defaultAnchor, cad.stepMinutes);

  const yyyy = pad(target.getUTCFullYear(), 4);
  const mm = pad(target.getUTCMonth() + 1);
  const dd = pad(target.getUTCDate());
  const dir = `${IEM_BASE}/${yyyy}/${mm}/${dd}/mrms/ncep/${product}`;

  // For dates before Sept 2022, also emit the legacy `MRMS_*` filename. We
  // emit `MESH_*` first so modern dates short-circuit on the first hit.
  const tryLegacyPrefix = date < PREFIX_RENAME_DATE;

  const buildName = (t: Date, prefix: 'MESH' | 'MRMS'): string => {
    const yh = pad(t.getUTCHours());
    const ym = pad(t.getUTCMinutes());
    // The legacy prefix only swaps the leading "MESH" → "MRMS"; the rest of
    // the product name (e.g. "_Max_1440min") stays the same.
    const productName = product.replace(/^MESH/, prefix);
    return `${productName}_00.50_${pad(t.getUTCFullYear(), 4)}${pad(t.getUTCMonth() + 1)}${pad(t.getUTCDate())}-${yh}${ym}00.grib2.gz`;
  };

  const urls: string[] = [`${dir}/${buildName(target, 'MESH')}`];
  if (tryLegacyPrefix) urls.push(`${dir}/${buildName(target, 'MRMS')}`);

  for (let step = 1; step <= Math.max(cad.walkBack, cad.walkForward); step += 1) {
    if (step <= cad.walkBack) {
      const back = new Date(target.getTime() - step * cad.stepMinutes * 60 * 1000);
      urls.push(`${dir}/${buildName(back, 'MESH')}`);
      if (tryLegacyPrefix) urls.push(`${dir}/${buildName(back, 'MRMS')}`);
    }
    if (step <= cad.walkForward) {
      const fwd = new Date(target.getTime() + step * cad.stepMinutes * 60 * 1000);
      urls.push(`${dir}/${buildName(fwd, 'MESH')}`);
      if (tryLegacyPrefix) urls.push(`${dir}/${buildName(fwd, 'MRMS')}`);
    }
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

export async function fetchMrmsGrib(opts: {
  product: MrmsProduct;
  date: string;
  anchorIso?: string;
}): Promise<MrmsFile | null> {
  const candidates = buildCandidateUrls(opts.product, opts.date, opts.anchorIso ?? '');
  for (const url of candidates) {
    const gz = await tryFetch(url);
    if (!gz || gz.length < 64) continue;
    try {
      const grib2Bytes = inflate(gz);
      const match = url.match(/(\d{8})-(\d{6})\.grib2\.gz$/);
      const refTime = match
        ? `${match[1].slice(0, 4)}-${match[1].slice(4, 6)}-${match[1].slice(6, 8)}T${match[2].slice(0, 2)}:${match[2].slice(2, 4)}:${match[2].slice(4, 6)}Z`
        : `${opts.date}T23:58:00Z`;
      return { url, date: opts.date, refTime, product: opts.product, grib2Bytes };
    } catch (err) {
      console.warn('[mrms] gzip inflate failed for', url, err);
      continue;
    }
  }
  return null;
}

/** Backwards-compatible: defaults to the 1440-min archive product. */
export async function fetchMrmsMesh1440(opts: {
  date: string;
  anchorIso?: string;
}): Promise<MrmsFile | null> {
  return fetchMrmsGrib({
    product: 'MESH_Max_1440min',
    date: opts.date,
    anchorIso: opts.anchorIso,
  });
}

/** True now-cast — 60-min rolling max, ~2 min refresh cadence. */
export async function fetchMrmsMesh60(opts: {
  date: string;
  anchorIso?: string;
}): Promise<MrmsFile | null> {
  return fetchMrmsGrib({
    product: 'MESH_Max_60min',
    date: opts.date,
    anchorIso: opts.anchorIso,
  });
}

/**
 * Instantaneous MESH — every 2 min snapshot, archived back through 2010.
 * Used by the historical hourly scrubber because IEM doesn't archive
 * MESH_Max_60min/ for older dates. Trade-off: snapshot vs rolling max,
 * but reps watching hour-by-hour evolution see meaningful frame deltas.
 */
export async function fetchMrmsMeshInstantaneous(opts: {
  date: string;
  anchorIso?: string;
}): Promise<MrmsFile | null> {
  return fetchMrmsGrib({
    product: 'MESH',
    date: opts.date,
    anchorIso: opts.anchorIso,
  });
}
