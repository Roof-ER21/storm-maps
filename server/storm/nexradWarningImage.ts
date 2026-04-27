/**
 * NEXRAD per-warning image fetcher with in-memory LRU cache + 8s soft
 * timeout. Wraps the existing `fetchNexradSnapshot` (IEM WMS-T) without
 * modifying it, per spec lock on nexradImageService.ts.
 *
 * Used by Section 6 (Severe Weather Warnings) of the redesigned PDF —
 * each warning panel embeds a radar image at the warning's effective
 * (issue) timestamp, centered on the property with a ~30 mi viewport.
 */

import { fetchNexradSnapshot } from './nexradImageService.js';
import type { BoundingBox } from './types.js';

const CACHE_MAX = 32;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const PER_WARNING_TIMEOUT_MS = 8_000;

interface CacheEntry {
  buf: Buffer | null;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

function cacheKey(snappedIso: string, lat: number, lng: number): string {
  return `${snappedIso}|${lat.toFixed(2)}|${lng.toFixed(2)}`;
}

/**
 * Round an ISO timestamp to the nearest 5 minutes (matches IEM's WMS-T
 * grid). Pure function — same input → same key.
 */
function snapToFiveMin(iso: string): string {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return iso;
  const ms = t.getTime();
  const fiveMin = 5 * 60 * 1000;
  const snapped = Math.round(ms / fiveMin) * fiveMin;
  return new Date(snapped).toISOString();
}

/**
 * 30-mile bbox helper around the property point. 30 mi was the empirical
 * sweet spot for the target PDF — close enough to see the cell that
 * triggered the warning, wide enough to give context for the property
 * pin without zooming so far that the storm looks tiny.
 */
export function bboxAroundProperty(
  lat: number,
  lng: number,
  radiusMiles = 30,
): BoundingBox {
  const milesPerLat = 69;
  const milesPerLng = 69 * Math.max(0.05, Math.cos((lat * Math.PI) / 180));
  return {
    north: lat + radiusMiles / milesPerLat,
    south: lat - radiusMiles / milesPerLat,
    east: lng + radiusMiles / milesPerLng,
    west: lng - radiusMiles / milesPerLng,
  };
}

export interface FetchNexradImageForWarningOpts {
  effectiveIso: string;
  lat: number;
  lng: number;
  /** Output image dimensions. Default 600x400 (IEM WMS-T native target). */
  width?: number;
  height?: number;
  /** Optional bbox override; otherwise a 30-mi bbox is used. */
  bbox?: BoundingBox;
}

/**
 * Fetch (or LRU-serve) a NEXRAD reflectivity PNG for the warning's
 * effective time. Returns null on miss / timeout / IEM failure — the PDF
 * renderer treats null as "leave the radar slot blank" per spec.
 */
export async function fetchNexradImageForWarning(
  opts: FetchNexradImageForWarningOpts,
): Promise<Buffer | null> {
  const snapped = snapToFiveMin(opts.effectiveIso);
  const key = cacheKey(snapped, opts.lat, opts.lng);
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.expiresAt > now) {
    // Move to MRU — re-insert so iteration order tracks recency.
    cache.delete(key);
    cache.set(key, hit);
    return hit.buf;
  }
  if (hit) cache.delete(key);

  const bbox = opts.bbox ?? bboxAroundProperty(opts.lat, opts.lng);

  // Promise.race wraps the (already 20s-bounded) fetcher with an 8s soft
  // timeout. The underlying fetcher's own timer will still cancel its
  // network request if it fires past 20s.
  const buf = await Promise.race([
    fetchNexradSnapshot({
      timeIso: snapped,
      bbox,
      width: opts.width ?? 600,
      height: opts.height ?? 400,
    }).catch(() => null),
    new Promise<null>((resolve) =>
      setTimeout(() => resolve(null), PER_WARNING_TIMEOUT_MS),
    ),
  ]);

  // LRU eviction — drop oldest if at cap, then insert.
  if (cache.size >= CACHE_MAX) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey !== undefined) cache.delete(oldestKey);
  }
  cache.set(key, { buf, expiresAt: now + CACHE_TTL_MS });
  return buf;
}

/** Test/debug — clear the in-memory cache. */
export function clearNexradWarningImageCache(): void {
  cache.clear();
}
