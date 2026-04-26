/**
 * Parcel geometry fetcher — pulls the actual lot polygon from county
 * ArcGIS REST services so the map can outline the property the rep is
 * looking at, not just drop a pin in the middle.
 *
 * Mirrors the county lookup table used by the frontend propertyLookup
 * service, but issues a `returnGeometry=true` query so we get the rings.
 * Falls through quickly when no county endpoint covers the lat/lng — the
 * client layer just stays empty in that case.
 */

interface CountyEndpoint {
  name: string;
  state: string;
  latMin: number;
  latMax: number;
  lngMin: number;
  lngMax: number;
  url: string;
}

// Subset of the heavy CountyEndpoint table from src/services/propertyLookup.ts.
// Everything in our VA/MD/PA/DC/DE/NJ focus territory + a handful of high-
// value markets. Sources verified to support `returnGeometry=true`.
const PARCEL_ENDPOINTS: CountyEndpoint[] = [
  {
    name: 'District of Columbia',
    state: 'DC',
    latMin: 38.79, latMax: 38.99, lngMin: -77.12, lngMax: -76.91,
    url: 'https://maps2.dcgis.dc.gov/dcgis/rest/services/Property_and_Land/MapServer/40/query',
  },
  {
    name: 'Loudoun County, VA',
    state: 'VA',
    latMin: 38.83, latMax: 39.32, lngMin: -77.95, lngMax: -77.25,
    url: 'https://maps.loudoun.gov/loudoungis/rest/services/Hosted/Parcels_Public/FeatureServer/0/query',
  },
  {
    name: 'Fairfax County, VA',
    state: 'VA',
    latMin: 38.59, latMax: 39.07, lngMin: -77.55, lngMax: -77.07,
    url: 'https://www.fairfaxcounty.gov/mercator/rest/services/DPZ/parcels/MapServer/0/query',
  },
  {
    name: 'Prince William County, VA',
    state: 'VA',
    latMin: 38.51, latMax: 38.96, lngMin: -77.71, lngMax: -77.18,
    url: 'https://gis.pwcgov.org/server/rest/services/PublicMaps/Parcels/MapServer/0/query',
  },
  {
    name: 'Arlington County, VA',
    state: 'VA',
    latMin: 38.83, latMax: 38.94, lngMin: -77.18, lngMax: -77.04,
    url: 'https://arlgis.arlingtonva.us/arcgis/rest/services/Public_Maps/Parcel_Map/MapServer/1/query',
  },
  {
    name: 'Montgomery County, MD',
    state: 'MD',
    latMin: 38.93, latMax: 39.36, lngMin: -77.50, lngMax: -76.91,
    url: 'https://mcatlas.org/arcgis/rest/services/property/Property/MapServer/3/query',
  },
  {
    name: 'Prince George\'s County, MD',
    state: 'MD',
    latMin: 38.66, latMax: 39.10, lngMin: -77.07, lngMax: -76.66,
    url: 'https://services1.arcgis.com/QXZbWTdcAUIIXfqt/arcgis/rest/services/Tax_Parcels/FeatureServer/0/query',
  },
];

export interface ParcelGeometry {
  /** Polygon outer rings (multi-polygon supported). Each ring is [lng, lat][]. */
  rings: number[][][];
  county: string;
  state: string;
  /** Approximate centroid lng/lat for label/legend positioning. */
  centroid: { lat: number; lng: number };
}

function findEndpoint(lat: number, lng: number): CountyEndpoint | null {
  return (
    PARCEL_ENDPOINTS.find(
      (ep) => lat >= ep.latMin && lat <= ep.latMax && lng >= ep.lngMin && lng <= ep.lngMax,
    ) ?? null
  );
}

interface ArcgisFeature {
  attributes?: Record<string, unknown>;
  geometry?: {
    rings?: number[][][];
  };
}

interface ArcgisResponse {
  features?: ArcgisFeature[];
}

function ringsCentroid(rings: number[][][]): { lat: number; lng: number } | null {
  if (!rings.length || !rings[0].length) return null;
  // Average of the outer ring vertices — fine for visual labeling, not for
  // legal centroid calculations.
  const outer = rings[0];
  let sumLat = 0;
  let sumLng = 0;
  for (const [lng, lat] of outer) {
    sumLat += lat;
    sumLng += lng;
  }
  return { lat: sumLat / outer.length, lng: sumLng / outer.length };
}

/**
 * Fetch the parcel polygon at this lat/lng from the county GIS. Returns
 * null when no endpoint covers the point or the upstream returns nothing.
 * Soft-fails on any network/parse error — the map just won't draw a
 * boundary, which is non-fatal.
 */
export async function fetchParcelGeometry(
  lat: number,
  lng: number,
  timeoutMs = 8_000,
): Promise<ParcelGeometry | null> {
  const ep = findEndpoint(lat, lng);
  if (!ep) return null;

  const params = new URLSearchParams({
    geometry: `${lng},${lat}`,
    geometryType: 'esriGeometryPoint',
    inSR: '4326',
    outSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: '*',
    returnGeometry: 'true',
    f: 'json',
  });

  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    const res = await fetch(`${ep.url}?${params.toString()}`, {
      signal: ac.signal,
      headers: { Accept: 'application/json' },
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = (await res.json()) as ArcgisResponse;
    const feat = data.features?.[0];
    const rings = feat?.geometry?.rings;
    if (!rings || rings.length === 0) return null;
    // Validate: every vertex should be a [lng, lat] pair.
    for (const ring of rings) {
      for (const v of ring) {
        if (
          v.length < 2 ||
          !Number.isFinite(v[0]) ||
          !Number.isFinite(v[1])
        ) {
          return null;
        }
      }
    }
    const centroid = ringsCentroid(rings) ?? { lat, lng };
    return {
      rings,
      county: ep.name,
      state: ep.state,
      centroid,
    };
  } catch {
    return null;
  }
}
