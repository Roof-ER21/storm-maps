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

export type MrmsOverlayProduct = 'mesh60' | 'mesh1440';

// ---------------------------------------------------------------------------
// Oracle Tile Server Config
// ---------------------------------------------------------------------------

// Use the field assistant's HTTPS proxy to avoid mixed-content blocking
// Falls back to direct Oracle if proxy unavailable
const PROXY_BASE = 'https://sa21.up.railway.app/api/mrms';
// Direct Oracle URL (for non-HTTPS contexts): http://129.159.190.3:8080/overlays

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
      `https://sa21.up.railway.app/api/hail/mrms-historical-meta?${toHistoricalQuery(params)}`,
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
  return `https://sa21.up.railway.app/api/hail/mrms-historical-image?${toHistoricalQuery(params)}`;
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
