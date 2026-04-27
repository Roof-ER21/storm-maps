export interface GeocodingResult {
  lat: number;
  lng: number;
  normalizedAddress: string;
  placeId: string;
  city: string;
  state: string;
  zip: string;
}

/** Geocode using OpenStreetMap Nominatim (free, no API key needed) */
async function geocodeNominatim(
  address: string
): Promise<GeocodingResult | null> {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", address);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("limit", "1");
  url.searchParams.set("countrycodes", "us");

  const res = await fetch(url.toString(), {
    headers: { "User-Agent": "PropertyExteriorAnalyzer/1.0" },
    signal: AbortSignal.timeout(10000),
  });

  if (!res.ok) return null;

  const data = await res.json();
  if (!data?.length) return null;

  const result = data[0];
  const addr = result.address || {};

  return {
    lat: parseFloat(result.lat),
    lng: parseFloat(result.lon),
    normalizedAddress: result.display_name,
    placeId: `osm_${result.osm_type}_${result.osm_id}`,
    city:
      addr.city || addr.town || addr.village || addr.hamlet || "",
    state: addr.state || "",
    zip: addr.postcode || "",
  };
}

/** Geocode using Google (requires unrestricted API key) */
async function geocodeGoogle(
  address: string,
  apiKey: string
): Promise<GeocodingResult | null> {
  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("address", address);
  url.searchParams.set("key", apiKey);

  const res = await fetch(url.toString(), {
    signal: AbortSignal.timeout(10000),
  });

  if (!res.ok) return null;

  const data = await res.json();
  if (data.status !== "OK" || !data.results?.length) return null;

  const result = data.results[0];
  interface GoogleAddressComponent { long_name: string; short_name: string; types: string[] }
  const components = (result.address_components || []) as GoogleAddressComponent[];

  const getComponent = (type: string) =>
    components.find((c) => c.types.includes(type))?.long_name || "";

  return {
    lat: result.geometry.location.lat,
    lng: result.geometry.location.lng,
    normalizedAddress: result.formatted_address,
    placeId: result.place_id,
    city: getComponent("locality") || getComponent("sublocality"),
    state: getComponent("administrative_area_level_1"),
    zip: getComponent("postal_code"),
  };
}

/** Geocode using US Census Bureau (free, no API key, excellent US coverage) */
async function geocodeCensus(
  address: string
): Promise<GeocodingResult | null> {
  const url = new URL(
    "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress"
  );
  url.searchParams.set("address", address);
  url.searchParams.set("benchmark", "Public_AR_Current");
  url.searchParams.set("format", "json");

  try {
    const res = await fetch(url.toString(), {
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const matches = data?.result?.addressMatches;
    if (!matches?.length) return null;

    const match = matches[0];
    const matched = match.matchedAddress || "";
    // Parse city/state/zip from matched address: "123 MAIN ST, CITY, STATE, ZIP"
    const parts = matched.split(",").map((s: string) => s.trim());

    return {
      lat: match.coordinates.y,
      lng: match.coordinates.x,
      normalizedAddress: matched,
      placeId: `census_${match.coordinates.y.toFixed(5)}_${match.coordinates.x.toFixed(5)}`,
      city: parts[1] || "",
      state: parts[2] || "",
      zip: parts[3] || "",
    };
  } catch {
    return null;
  }
}

/** Geocode address - tries Google → Nominatim → Census Bureau */
export async function geocodeAddress(
  address: string,
  apiKey: string
): Promise<GeocodingResult | null> {
  // Try Google first
  const google = await geocodeGoogle(address, apiKey).catch(() => null);
  if (google) return google;

  // Fallback to Nominatim
  const nominatim = await geocodeNominatim(address).catch(() => null);
  if (nominatim) return nominatim;

  // Last resort: US Census Bureau (excellent US coverage, handles addresses OSM misses)
  return geocodeCensus(address);
}
