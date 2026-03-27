/**
 * Geocoding Service
 *
 * Provides address-to-coordinates conversion with two backends:
 * 1. Google Maps Geocoding API (when VITE_GOOGLE_MAPS_API_KEY is set)
 * 2. US Census Bureau Geocoder (free fallback, no key required)
 *
 * The Census geocoder only works for US addresses but is fully free
 * and sufficient for a roofing-focused app.
 */

import type { BoundingBox, SearchResult, SearchResultType } from '../types/storm';

// ---------------------------------------------------------------------------
// Google Maps Geocoding
// ---------------------------------------------------------------------------

interface GoogleGeoResult {
  formatted_address: string;
  place_id: string;
  types?: string[];
  geometry: {
    location: {
      lat: number;
      lng: number;
    };
    viewport?: google.maps.LatLngBounds;
  };
}

interface GoogleGeoResponse {
  status: string;
  results: GoogleGeoResult[];
}

async function geocodeWithGoogle(query: string): Promise<SearchResult | null> {
  // Use the Google Maps JavaScript Geocoder (loaded via Maps JS API)
  // This avoids CORS issues and REST API referrer restrictions
  if (!window.google?.maps?.Geocoder) {
    return null;
  }

  try {
    const geocoder = new window.google.maps.Geocoder();
    const result = await geocoder.geocode({ address: query });

    if (!result.results || result.results.length === 0) return null;

    const first = result.results[0];
    const viewport = first.geometry.viewport?.toJSON();

    return {
      address: first.formatted_address,
      lat: first.geometry.location.lat(),
      lng: first.geometry.location.lng(),
      placeId: first.place_id,
      viewport: viewport
        ? {
            north: viewport.north,
            south: viewport.south,
            east: viewport.east,
            west: viewport.west,
          }
        : null,
      resultType: getGoogleResultType(first.types),
    };
  } catch (err) {
    console.error('[geocodeApi] Google geocode failed:', err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// US Census Bureau Geocoder (free, no API key)
// ---------------------------------------------------------------------------

interface CensusMatch {
  matchedAddress: string;
  coordinates: {
    x: number; // longitude
    y: number; // latitude
  };
}

interface CensusAddressMatch {
  addressMatches: CensusMatch[];
}

interface CensusResponse {
  result: CensusAddressMatch;
}

async function geocodeWithCensus(query: string): Promise<SearchResult | null> {
  const params = new URLSearchParams({
    address: query,
    benchmark: 'Public_AR_Current',
    format: 'json',
  });

  try {
    const res = await fetch(
      `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?${params}`,
    );
    if (!res.ok) throw new Error(`Census geocoder returned ${res.status}`);

    const data: CensusResponse = await res.json();
    const matches = data.result?.addressMatches;
    if (!matches || matches.length === 0) return null;

    const first = matches[0];
    return {
      address: first.matchedAddress,
      lat: first.coordinates.y,
      lng: first.coordinates.x,
      placeId: `census-${first.coordinates.y}-${first.coordinates.x}`,
      viewport: inferCensusViewport(first.coordinates.y, first.coordinates.x, query),
      resultType: isZipCode(query) ? 'postal_code' : 'address',
    };
  } catch (err) {
    console.error('[geocodeApi] Census geocode failed:', err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// ZIP Code Geocoding (approximate center via Census)
// ---------------------------------------------------------------------------

/**
 * Check if input looks like a US ZIP code.
 */
function isZipCode(query: string): boolean {
  return /^\d{5}(-\d{4})?$/.test(query.trim());
}

function getGoogleResultType(types?: string[]): SearchResultType {
  if (!types || types.length === 0) {
    return 'unknown';
  }

  if (
    types.includes('street_address') ||
    types.includes('premise') ||
    types.includes('subpremise') ||
    types.includes('route')
  ) {
    return 'address';
  }
  if (types.includes('postal_code')) {
    return 'postal_code';
  }
  if (
    types.includes('locality') ||
    types.includes('neighborhood') ||
    types.includes('sublocality')
  ) {
    return 'locality';
  }
  if (types.some((type) => type.startsWith('administrative_area_level_'))) {
    return 'administrative_area';
  }

  return 'unknown';
}

function inferCensusViewport(
  lat: number,
  lng: number,
  query: string,
): BoundingBox | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }

  if (isZipCode(query)) {
    return {
      north: lat + 0.08,
      south: lat - 0.08,
      east: lng + 0.08,
      west: lng - 0.08,
    };
  }

  return {
    north: lat + 0.01,
    south: lat - 0.01,
    east: lng + 0.01,
    west: lng - 0.01,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Geocode an address or ZIP code to lat/lng coordinates.
 * Tries Google Maps first, falls back to US Census Bureau geocoder.
 */
export async function geocodeAddress(
  query: string,
): Promise<SearchResult | null> {
  if (!query || query.trim().length === 0) return null;

  const cleaned = query.trim();

  // If it's a ZIP code, format it for the Census geocoder
  const searchQuery = isZipCode(cleaned) ? `${cleaned}` : cleaned;

  // Try Google first (if API key is available)
  const googleResult = await geocodeWithGoogle(searchQuery);
  if (googleResult) return googleResult;

  // Fallback to Census Bureau
  const censusResult = await geocodeWithCensus(searchQuery);
  if (censusResult) return censusResult;

  return null;
}

/**
 * Reverse geocode a lat/lng position to a street address.
 * Tries Google Maps first, then returns a formatted coordinate string.
 */
export async function reverseGeocode(
  lat: number,
  lng: number,
): Promise<string | null> {
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
  if (apiKey && apiKey !== 'your_google_maps_api_key_here') {
    try {
      const params = new URLSearchParams({
        latlng: `${lat},${lng}`,
        key: apiKey,
      });
      const res = await fetch(
        `https://maps.googleapis.com/maps/api/geocode/json?${params}`,
      );
      if (res.ok) {
        const data: GoogleGeoResponse = await res.json();
        if (data.status === 'OK' && data.results.length > 0) {
          return data.results[0].formatted_address;
        }
      }
    } catch {
      // Fall through to coordinate string
    }
  }

  // Fallback: return formatted coordinates
  return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
}
