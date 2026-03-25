// TODO: Address geocoding service
// - Google Maps Geocoding API integration
// - Address to lat/lng conversion
// - ZIP code geocoding
// - Reverse geocoding (lat/lng to address)
// - Places Autocomplete integration

import type { SearchResult } from '../types/storm';

/**
 * Geocode an address or ZIP code to lat/lng coordinates.
 */
export async function geocodeAddress(
  _query: string,
): Promise<SearchResult | null> {
  // TODO: Implement Google Geocoding API
  // Uses VITE_GOOGLE_MAPS_API_KEY from environment
  console.warn('geocodeApi.geocodeAddress not yet implemented');
  return null;
}

/**
 * Reverse geocode a lat/lng position to a street address.
 */
export async function reverseGeocode(
  _lat: number,
  _lng: number,
): Promise<string | null> {
  // TODO: Implement reverse geocoding
  console.warn('geocodeApi.reverseGeocode not yet implemented');
  return null;
}
