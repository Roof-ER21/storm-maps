/**
 * Roof-ER21 territory definitions — VA / MD / PA / DE / NJ + DC focus.
 *
 * Each territory has:
 *   - a state code (used to filter events by `state` field and to scope IEM
 *     LSR queries server-side)
 *   - a coarse bounding box (used for "is this within our territory?" checks
 *     when an event has only lat/lng and no state attribution)
 *
 * The bbox values are conservative — they cover the whole state plus a small
 * pad — and are intentionally hand-tuned rather than pulled from a Census
 * shapefile, because:
 *   1. Reps occasionally walk into adjacent counties (NC, OH, NY) and we
 *      don't want to silently drop those events.
 *   2. NOAA Storm Events records sometimes attribute a hail report to the
 *      nearest forecast zone rather than the lat/lng's actual state.
 *
 * These are "include if either state matches OR point falls inside any bbox"
 * — see `isInFocusTerritory()`.
 */

import type { BoundingBox, LatLng } from '../types/storm';

export interface Territory {
  code: string;
  name: string;
  /** ISO 3166-2 state code(s) — use the first as the canonical one. */
  stateCodes: string[];
  /** Coarse bbox covering the territory. */
  bounds: BoundingBox;
  /** Anchor center used when "Reset to territory" is hit. */
  center: LatLng;
  /** Default zoom when re-centered on this territory. */
  defaultZoom: number;
}

export const FOCUS_TERRITORIES: Territory[] = [
  {
    code: 'VA',
    name: 'Virginia',
    stateCodes: ['VA'],
    bounds: { north: 39.5, south: 36.4, east: -75.1, west: -83.7 },
    center: { lat: 38.0, lng: -78.5 },
    defaultZoom: 7,
  },
  {
    code: 'MD',
    name: 'Maryland + DC',
    stateCodes: ['MD', 'DC'],
    bounds: { north: 39.8, south: 37.8, east: -75.0, west: -79.5 },
    center: { lat: 39.0, lng: -76.7 },
    defaultZoom: 8,
  },
  {
    code: 'PA',
    name: 'Pennsylvania',
    stateCodes: ['PA'],
    bounds: { north: 42.4, south: 39.6, east: -74.6, west: -80.6 },
    center: { lat: 40.9, lng: -77.5 },
    defaultZoom: 7,
  },
  {
    code: 'DE',
    name: 'Delaware',
    stateCodes: ['DE'],
    bounds: { north: 39.95, south: 38.4, east: -74.95, west: -75.85 },
    center: { lat: 39.05, lng: -75.45 },
    defaultZoom: 9,
  },
  {
    code: 'NJ',
    name: 'New Jersey',
    stateCodes: ['NJ'],
    bounds: { north: 41.4, south: 38.85, east: -73.85, west: -75.6 },
    center: { lat: 40.1, lng: -74.65 },
    defaultZoom: 8,
  },
];

/**
 * All states inside the focus zone PLUS direct neighbors used for IEM/SPC
 * queries (so reps walking into adjacent counties don't silently lose data).
 */
export const FOCUS_STATE_CODES = [
  'VA',
  'MD',
  'PA',
  'WV',
  'DC',
  'DE',
  'NJ',
  // Neighbor pads — events on the wrong side of a state line still count.
  'NC',
  'NY',
  'OH',
];

/** Just the primary focus states (no neighbors). For UI labeling. */
export const PRIMARY_FOCUS_STATES = ['VA', 'MD', 'PA', 'DE', 'NJ', 'DC'];

/** Combined focus bbox (used as a default search frame). */
export const FOCUS_BOUNDS: BoundingBox = {
  north: Math.max(...FOCUS_TERRITORIES.map((t) => t.bounds.north)),
  south: Math.min(...FOCUS_TERRITORIES.map((t) => t.bounds.south)),
  east: Math.max(...FOCUS_TERRITORIES.map((t) => t.bounds.east)),
  west: Math.min(...FOCUS_TERRITORIES.map((t) => t.bounds.west)),
};

export function getTerritory(code: string): Territory | null {
  return FOCUS_TERRITORIES.find((t) => t.code === code) ?? null;
}

export function isInBounds(point: LatLng, bounds: BoundingBox): boolean {
  return (
    point.lat <= bounds.north &&
    point.lat >= bounds.south &&
    point.lng <= bounds.east &&
    point.lng >= bounds.west
  );
}

export function isInFocusTerritory(opts: {
  state?: string | null;
  lat?: number;
  lng?: number;
}): boolean {
  if (opts.state && FOCUS_STATE_CODES.includes(opts.state.toUpperCase())) {
    return true;
  }
  if (
    typeof opts.lat === 'number' &&
    typeof opts.lng === 'number' &&
    Number.isFinite(opts.lat) &&
    Number.isFinite(opts.lng)
  ) {
    return isInBounds({ lat: opts.lat, lng: opts.lng }, FOCUS_BOUNDS);
  }
  return false;
}

/** Storm-event filter: keep only events that are inside the focus territory. */
export function filterEventsToFocusTerritory<
  T extends { state?: string; beginLat?: number; beginLon?: number },
>(events: T[]): T[] {
  return events.filter((e) =>
    isInFocusTerritory({
      state: e.state ?? null,
      lat: typeof e.beginLat === 'number' ? e.beginLat : undefined,
      lng: typeof e.beginLon === 'number' ? e.beginLon : undefined,
    }),
  );
}
