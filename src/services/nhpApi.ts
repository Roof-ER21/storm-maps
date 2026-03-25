// TODO: National Hail Project API service
// - Fetch MESH hail swath data by date
// - Return GeoJSON polygons for map overlay
// - Supports date range queries
// - NHP provides high-resolution MESH-derived hail swaths

import type { MeshSwath } from '../types/storm';

/**
 * Fetch MESH hail swath polygons from the National Hail Project.
 */
export async function fetchMeshSwaths(
  _date: string,
): Promise<MeshSwath[]> {
  // TODO: Implement NHP API integration
  console.warn('nhpApi.fetchMeshSwaths not yet implemented');
  return [];
}

/**
 * Fetch available storm dates from NHP.
 * Returns dates that have MESH swath data available.
 */
export async function fetchAvailableStormDates(
  _startDate: string,
  _endDate: string,
): Promise<string[]> {
  // TODO: Implement NHP date availability query
  console.warn('nhpApi.fetchAvailableStormDates not yet implemented');
  return [];
}
