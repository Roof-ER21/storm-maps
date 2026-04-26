/**
 * MRMS (Multi-Radar/Multi-Sensor) Overlay Service
 *
 * Fetches MRMS MESH overlay metadata and image URLs from the
 * Oracle Cloud tile server at 129.159.190.3:8080.
 *
 * Products:
 * - MESH 60-min: Recent hail estimates (last hour)
 * - MESH 1440-min (24h): Full-day composite hail map
 */

import type { MrmsHailData } from '../types/storm';
import type { BoundingBox } from '../types/storm';
import { HAIL_YES_HAIL_API_BASE, HAIL_YES_MRMS_API_BASE } from './backendConfig';

export type MrmsOverlayProduct = 'mesh60' | 'mesh1440';

// ---------------------------------------------------------------------------
// Oracle Tile Server Config
// ---------------------------------------------------------------------------

// Hail Yes backend MRMS proxy.
// This remains a core standalone feature because archived MRMS imagery and
// overlay metadata need server-side handling.
const PROXY_BASE = HAIL_YES_MRMS_API_BASE;

/** CONUS bounding box for the MRMS image overlays */
export const CONUS_BOUNDS = {
  north: 55.0,
  south: 20.0,
  east: -60.0,
  west: -130.0,
} as const;

// ---------------------------------------------------------------------------
// MRMS Metadata Response
// ---------------------------------------------------------------------------

interface MrmsMetadata {
  timestamp?: string;
  generated?: string;
  product?: string;
  ref_time?: string;
  generated_at?: string;
  has_hail?: boolean;
  max_mesh_mm?: number;
  max_mesh_inches?: number;
  hail_pixels?: number;
  bounds?: {
    north: number;
    south: number;
    east: number;
    west: number;
  };
}

export interface HistoricalMrmsMetadata extends MrmsMetadata {
  overlay_url?: string;
  archive_file?: string;
  archive_url?: string;
  requested_bounds?: BoundingBox;
  image_size?: {
    width: number;
    height: number;
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Fetch MRMS overlay metadata from the MRMS proxy.
 */
export async function fetchMrmsMetadata(
  product: MrmsOverlayProduct = 'mesh60',
): Promise<MrmsMetadata | null> {
  try {
    const res = await fetch(`${PROXY_BASE}/${product}.json`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`MRMS metadata returned ${res.status}`);
    return await res.json();
  } catch (err) {
    console.error('[mrmsApi] Failed to fetch MRMS metadata:', err);
    return null;
  }
}

interface HistoricalMrmsParams {
  date: string;
  bounds: BoundingBox;
  anchorTimestamp?: string | null;
}

function toHistoricalQuery(params: HistoricalMrmsParams): string {
  const query = new URLSearchParams({
    date: params.date,
    north: params.bounds.north.toString(),
    south: params.bounds.south.toString(),
    east: params.bounds.east.toString(),
    west: params.bounds.west.toString(),
  });

  if (params.anchorTimestamp) {
    query.set('anchorTimestamp', params.anchorTimestamp);
  }

  return query.toString();
}

/**
 * Fetch historical MRMS metadata. Tries the in-repo `/api/hail/mrms-meta`
 * first; falls back to the Susan21 endpoint when that's unreachable.
 */
export async function fetchHistoricalMrmsMetadata(
  params: HistoricalMrmsParams,
): Promise<HistoricalMrmsMetadata | null> {
  // 1. In-repo
  try {
    const res = await fetch(
      `/api/hail/mrms-meta?${toHistoricalQuery(params)}`,
      { signal: AbortSignal.timeout(45000) },
    );
    if (res.ok) {
      return (await res.json()) as HistoricalMrmsMetadata;
    }
  } catch (err) {
    console.warn('[mrmsApi] in-repo MRMS meta failed, trying Susan21', err);
  }

  // 2. Susan21 legacy
  try {
    const res = await fetch(
      `${HAIL_YES_HAIL_API_BASE}/mrms-historical-meta?${toHistoricalQuery(params)}`,
      { signal: AbortSignal.timeout(45000) },
    );
    if (!res.ok) {
      throw new Error(`Historical MRMS metadata returned ${res.status}`);
    }
    return await res.json();
  } catch (err) {
    console.error('[mrmsApi] Failed to fetch historical MRMS metadata:', err);
    return null;
  }
}

/**
 * Build the URL for the historical MRMS PNG overlay. Returns the in-repo
 * path; the frontend overlay falls back gracefully because if the in-repo
 * endpoint isn't reachable the GroundOverlay just shows a broken image
 * (and the vector polygons render anyway). The Susan21 URL is exposed via
 * `getHistoricalMrmsOverlayUrlSusan21` for explicit fallback wiring if
 * needed.
 */
export function getHistoricalMrmsOverlayUrl(params: HistoricalMrmsParams): string {
  return `/api/hail/mrms-image?${toHistoricalQuery(params)}`;
}

export function getHistoricalMrmsOverlayUrlSusan21(
  params: HistoricalMrmsParams,
): string {
  return `${HAIL_YES_HAIL_API_BASE}/mrms-historical-image?${toHistoricalQuery(params)}`;
}

// ---------------------------------------------------------------------------
// Vector Swath Polygons — 10-level contour polygons from MRMS MESH grid
// ---------------------------------------------------------------------------

export interface SwathPolygonFeature {
  type: 'Feature';
  properties: {
    level: number;
    sizeInches: number;
    sizeMm: number;
    label: string;
    color: string;
    severity: string;
  };
  geometry: {
    type: 'MultiPolygon';
    coordinates: number[][][][];
  };
}

export interface SwathPolygonCollection {
  type: 'FeatureCollection';
  features: SwathPolygonFeature[];
  metadata: {
    date: string;
    refTime: string;
    maxMeshInches: number;
    hailCells: number;
    bounds: BoundingBox;
    sourceFiles: string[];
    generatedAt: string;
  };
}

// ---------------------------------------------------------------------------
// Storm Impact — "was this address hit?" point-in-polygon API
// ---------------------------------------------------------------------------

export interface StormImpactPoint {
  id: string;
  lat: number;
  lng: number;
}

export interface StormImpactResult {
  id: string;
  maxHailInches: number | null;
  level: number | null;
  color: string | null;
  label: string | null;
  severity: string | null;
  directHit: boolean;
}

export interface StormImpactResponse {
  date: string;
  anchorTimestamp: string | null;
  metadata: {
    stormMaxInches: number;
    stormHailCells: number;
    stormFeatureCount: number;
    pointsChecked: number;
    directHits: number;
  };
  results: StormImpactResult[];
}

/**
 * "Which hail band contains each of these points?" Used by the
 * AddressImpactBadge and the click-anywhere bubble.
 *
 * Source priority:
 *   1. In-repo `/api/hail/mrms-impact` — needs bounds, runs against the
 *      same MRMS-decoded polygons we already cache in swath_cache.
 *   2. Susan21 `/api/hail/storm-impact` — legacy, doesn't need bounds.
 *
 * If bounds are missing we skip the in-repo path and go straight to Susan21.
 */
export async function fetchStormImpact(params: {
  date: string;
  anchorTimestamp?: string | null;
  bounds?: BoundingBox | null;
  points: StormImpactPoint[];
}): Promise<StormImpactResponse | null> {
  if (params.points.length === 0) return null;

  // 1. In-repo MRMS impact (preferred when we have bounds).
  if (params.bounds) {
    try {
      const res = await fetch('/api/hail/mrms-impact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: params.date,
          bounds: params.bounds,
          anchorTimestamp: params.anchorTimestamp || null,
          points: params.points,
        }),
        signal: AbortSignal.timeout(60000),
      });
      if (res.ok) {
        return (await res.json()) as StormImpactResponse;
      }
    } catch (err) {
      console.warn('[mrmsApi] in-repo MRMS impact failed, trying Susan21', err);
    }
  }

  // 2. Susan21 legacy.
  try {
    const res = await fetch(`${HAIL_YES_HAIL_API_BASE}/storm-impact`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        date: params.date,
        anchorTimestamp: params.anchorTimestamp || null,
        points: params.points,
      }),
      signal: AbortSignal.timeout(45000),
    });
    if (!res.ok) {
      throw new Error(`Storm impact returned ${res.status}`);
    }
    return await res.json();
  } catch (err) {
    console.error('[mrmsApi] Failed to fetch storm impact:', err);
    return null;
  }
}

/**
 * Fetch LIVE vector swath polygons (now-cast) — pulls the most recent
 * MRMS MESH 1440min (24h rolling max) from IEM MTArchive. Updated every
 * ~30 minutes upstream.
 */
export async function fetchLiveSwathPolygons(bounds: BoundingBox): Promise<
  (SwathPolygonCollection & { live: true; refTime: string }) | null
> {
  const query = new URLSearchParams({
    north: bounds.north.toString(),
    south: bounds.south.toString(),
    east: bounds.east.toString(),
    west: bounds.west.toString(),
  });

  // 1. In-repo MRMS now-cast.
  try {
    const res = await fetch(`/api/hail/mrms-now-vector?${query.toString()}`, {
      signal: AbortSignal.timeout(60000),
    });
    if (res.ok) {
      const data = (await res.json()) as SwathPolygonCollection & {
        live?: boolean;
        refTime?: string;
      };
      if (data.features && data.features.length > 0) {
        return {
          ...(data as SwathPolygonCollection),
          live: true,
          refTime: data.refTime || new Date().toISOString(),
        };
      }
    }
  } catch (err) {
    console.warn('[mrmsApi] in-repo MRMS now-cast failed, trying Susan21', err);
  }

  // 2. Susan21 legacy.
  try {
    const res = await fetch(
      `${HAIL_YES_HAIL_API_BASE}/mrms-now-polygons?${query}`,
      { signal: AbortSignal.timeout(45000) },
    );
    if (!res.ok) throw new Error(`Live swath polygons ${res.status}`);
    return await res.json();
  } catch (err) {
    console.error('[mrmsApi] Failed to fetch live swath polygons:', err);
    return null;
  }
}

/**
 * Fetch vector swath polygons for a storm date — crisp, clickable,
 * 13-level hail contours derived from MRMS MESH radar data.
 *
 * Source priority chain:
 *   1. In-repo `/api/hail/mrms-vector` — pure-JS GRIB2 decode + d3-contour.
 *      No cross-repo dependency.
 *   2. Susan21 `/api/hail/mrms-swath-polygons` — same pipeline, hosted in
 *      the field-assistant repo. Fallback for legacy deployments.
 *   3. In-repo `/api/hail/swath-fallback` — SPC + IEM point reports
 *      buffered into 13-band polygons. Last resort.
 *
 * All three return the same `SwathPolygonCollection` shape.
 */
export async function fetchSwathPolygons(
  params: HistoricalMrmsParams,
): Promise<SwathPolygonCollection | null> {
  const localQ = new URLSearchParams({
    date: params.date,
    north: params.bounds.north.toString(),
    south: params.bounds.south.toString(),
    east: params.bounds.east.toString(),
    west: params.bounds.west.toString(),
  });
  if (params.anchorTimestamp) {
    localQ.set('anchorTimestamp', params.anchorTimestamp);
  }

  // 1. In-repo MRMS GRIB pipeline.
  try {
    const res = await fetch(`/api/hail/mrms-vector?${localQ.toString()}`, {
      signal: AbortSignal.timeout(60000),
    });
    if (res.ok) {
      const data = (await res.json()) as SwathPolygonCollection;
      if (data.features && data.features.length > 0) return data;
    }
  } catch (err) {
    console.warn('[mrmsApi] in-repo MRMS pipeline failed, trying Susan21', err);
  }

  // 2. Susan21 backend (legacy).
  try {
    const res = await fetch(
      `${HAIL_YES_HAIL_API_BASE}/mrms-swath-polygons?${toHistoricalQuery(params)}`,
      { signal: AbortSignal.timeout(45000) },
    );
    if (res.ok) {
      const data = (await res.json()) as SwathPolygonCollection;
      if (data.features && data.features.length > 0) return data;
    }
  } catch (err) {
    console.warn('[mrmsApi] Susan21 MRMS unavailable, trying fallback', err);
  }

  // 3. In-repo SPC/LSR fallback.
  try {
    const res = await fetch(`/api/hail/swath-fallback?${localQ.toString()}`, {
      signal: AbortSignal.timeout(45000),
    });
    if (!res.ok) {
      throw new Error(`Hail fallback returned ${res.status}`);
    }
    return (await res.json()) as SwathPolygonCollection;
  } catch (err) {
    console.error('[mrmsApi] All hail polygon paths failed:', err);
    return null;
  }
}

/**
 * Get the MRMS overlay image URL for the given product.
 */
export function getMrmsOverlayUrl(
  product: MrmsOverlayProduct = 'mesh1440',
): string {
  return `${PROXY_BASE}/${product}.png`;
}

/**
 * Get the MRMS MESH 60-min overlay image URL.
 */
export function getMrms60MinUrl(): string {
  return getMrmsOverlayUrl('mesh60');
}

/**
 * Get MRMS tile URL template for a given product and timestamp.
 * Returns the image URL that can be placed as a ground overlay on the map.
 */
export function getMrmsTileUrl(
  product: MrmsHailData['product'],
): string {
  switch (product) {
    case 'MESH':
      return getMrmsOverlayUrl('mesh1440');
    case 'SHI':
    case 'POSH':
    case 'MHP':
      // Other products use the same Oracle endpoint pattern
      return `${PROXY_BASE}/${product.toLowerCase()}.png`;
    default:
      return getMrmsOverlayUrl();
  }
}

/**
 * Fetch available MRMS timestamps for a given date.
 * Returns ISO timestamp strings for available overlays.
 */
export async function fetchMrmsTimestamps(): Promise<string[]> {
  const meta = await fetchMrmsMetadata('mesh60');
  if (meta?.timestamp || meta?.ref_time) {
    return [meta.timestamp || meta.ref_time || ''];
  }
  if (meta?.generated || meta?.generated_at) {
    return [meta.generated || meta.generated_at || ''];
  }
  return [];
}

/**
 * Build MrmsHailData object for the current MESH overlay.
 */
export async function getCurrentMeshOverlay(): Promise<MrmsHailData | null> {
  const meta = await fetchMrmsMetadata('mesh1440');

  return {
    product: 'MESH',
    timestamp:
      meta?.timestamp ||
      meta?.ref_time ||
      meta?.generated ||
      meta?.generated_at ||
      new Date().toISOString(),
    tileUrl: getMrmsOverlayUrl('mesh1440'),
    opacity: 0.6,
  };
}
