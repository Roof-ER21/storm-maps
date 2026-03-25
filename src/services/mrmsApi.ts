// TODO: MRMS tile server API service
// - Fetch MRMS (Multi-Radar/Multi-Sensor) hail tiles
// - Oracle MRMS tile server integration
// - Products: MESH, SHI (Severe Hail Index), POSH, MHP
// - Tile URL template generation for Google Maps overlay
// - Historical and real-time data

import type { MrmsHailData } from '../types/storm';

/**
 * Get MRMS tile URL template for a given product and timestamp.
 */
export function getMrmsTileUrl(
  _product: MrmsHailData['product'],
  _timestamp: string,
): string {
  // TODO: Implement MRMS tile URL generation
  // Example: https://mrms.nssl.noaa.gov/qvs/product_viewer/
  console.warn('mrmsApi.getMrmsTileUrl not yet implemented');
  return '';
}

/**
 * Fetch available MRMS timestamps for a given date.
 */
export async function fetchMrmsTimestamps(
  _date: string,
  _product: MrmsHailData['product'],
): Promise<string[]> {
  // TODO: Implement MRMS timestamp query
  console.warn('mrmsApi.fetchMrmsTimestamps not yet implemented');
  return [];
}
