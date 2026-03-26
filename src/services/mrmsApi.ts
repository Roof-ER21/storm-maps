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
  bounds?: {
    north: number;
    south: number;
    east: number;
    west: number;
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Fetch MRMS MESH 60-minute overlay metadata from Oracle server.
 */
export async function fetchMrmsMetadata(): Promise<MrmsMetadata | null> {
  try {
    const res = await fetch(`${PROXY_BASE}/mesh60.json`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`MRMS metadata returned ${res.status}`);
    return await res.json();
  } catch (err) {
    console.error('[mrmsApi] Failed to fetch MRMS metadata:', err);
    return null;
  }
}

/**
 * Get the MRMS MESH overlay image URL (1440-min / 24h composite).
 */
export function getMrmsOverlayUrl(): string {
  return `${PROXY_BASE}/mesh1440.png`;
}

/**
 * Get the MRMS MESH 60-min overlay image URL.
 */
export function getMrms60MinUrl(): string {
  return `${PROXY_BASE}/mesh60.png`;
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
      return getMrmsOverlayUrl();
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
  const meta = await fetchMrmsMetadata();
  if (meta?.timestamp) {
    return [meta.timestamp];
  }
  if (meta?.generated) {
    return [meta.generated];
  }
  return [];
}

/**
 * Build MrmsHailData object for the current MESH overlay.
 */
export async function getCurrentMeshOverlay(): Promise<MrmsHailData | null> {
  const meta = await fetchMrmsMetadata();

  return {
    product: 'MESH',
    timestamp: meta?.timestamp || meta?.generated || new Date().toISOString(),
    tileUrl: getMrmsOverlayUrl(),
    opacity: 0.6,
  };
}
