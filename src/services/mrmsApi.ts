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

export async function fetchHistoricalMrmsMetadata(
  params: HistoricalMrmsParams,
): Promise<HistoricalMrmsMetadata | null> {
  try {
    const res = await fetch(
      `${HAIL_YES_HAIL_API_BASE}/mrms-historical-meta?${toHistoricalQuery(params)}`,
      {
        signal: AbortSignal.timeout(45000),
      },
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

export function getHistoricalMrmsOverlayUrl(params: HistoricalMrmsParams): string {
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
 * Ask the backend "which hail band contains each of these points?" —
 * returns the max hail size at each provided location for the given storm
 * date. Used for "DIRECT HIT 1.75"" badges in the address search UI.
 */
export async function fetchStormImpact(params: {
  date: string;
  anchorTimestamp?: string | null;
  points: StormImpactPoint[];
}): Promise<StormImpactResponse | null> {
  if (params.points.length === 0) return null;
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
 * 10-level hail contours derived from MRMS MESH radar data.
 */
export async function fetchSwathPolygons(
  params: HistoricalMrmsParams,
): Promise<SwathPolygonCollection | null> {
  try {
    const res = await fetch(
      `${HAIL_YES_HAIL_API_BASE}/mrms-swath-polygons?${toHistoricalQuery(params)}`,
      { signal: AbortSignal.timeout(45000) },
    );
    if (!res.ok) {
      throw new Error(`Swath polygons returned ${res.status}`);
    }
    return await res.json();
  } catch (err) {
    console.error('[mrmsApi] Failed to fetch swath polygons:', err);
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
