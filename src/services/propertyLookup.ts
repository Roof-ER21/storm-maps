/**
 * Property Owner Lookup Service
 *
 * Strategy:
 * 1. Try county ArcGIS REST services (free, no key, unlimited)
 * 2. Fall back to Regrid API if configured (paid, 100 free calls)
 *
 * County ArcGIS services are published by most US counties as public
 * parcel/assessor data. The challenge is each county has a different URL.
 * We maintain a lookup table of known endpoints for top hail markets.
 */

export interface PropertyInfo {
  owner: string;
  owner2?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  yearBuilt?: string;
  roofType?: string;
  assessedValue?: string;
  marketValue?: string;
  buildingSqft?: string;
  bedrooms?: string;
  bathrooms?: string;
  lastSaleDate?: string;
  lastSaleAmount?: string;
  landUse?: string;
  source: 'county-gis' | 'regrid' | 'manual';
}

// ── County ArcGIS Endpoints ─────────────────────────────
// Each entry: lat/lng bounding box + ArcGIS REST query URL
// To find more: search hub.arcgis.com for "{county} parcels"

interface CountyEndpoint {
  name: string;
  state: string;
  latMin: number;
  latMax: number;
  lngMin: number;
  lngMax: number;
  url: string;
  ownerField: string;
  addressField?: string;
  yearBuiltField?: string;
  valueField?: string;
}

const COUNTY_ENDPOINTS: CountyEndpoint[] = [
  // Maryland
  {
    name: 'Baltimore County, MD',
    state: 'MD',
    latMin: 39.17, latMax: 39.72, lngMin: -76.87, lngMax: -76.32,
    url: 'https://bcgis.baltimorecountymd.gov/arcgis/rest/services/Property/Parcels/MapServer/0/query',
    ownerField: 'OWNNAME1', addressField: 'STRTADDR', yearBuiltField: 'YRBUILT',
  },
  // Texas — Dallas County
  {
    name: 'Dallas County, TX',
    state: 'TX',
    latMin: 32.55, latMax: 33.02, lngMin: -97.0, lngMax: -96.46,
    url: 'https://maps.dcad.org/prdarcgis/rest/services/Public/Parcel_Public/MapServer/0/query',
    ownerField: 'OwnerName', addressField: 'SitusAddress', yearBuiltField: 'YearBuilt', valueField: 'TotalMarketValue',
  },
  // Texas — Tarrant County (Fort Worth)
  {
    name: 'Tarrant County, TX',
    state: 'TX',
    latMin: 32.55, latMax: 33.0, lngMin: -97.55, lngMax: -97.0,
    url: 'https://gis.tarrantcounty.com/arcgis/rest/services/Parcels/Parcels/MapServer/0/query',
    ownerField: 'OWNER_NAME', addressField: 'SITUS_ADDR',
  },
  // Texas — Harris County (Houston)
  {
    name: 'Harris County, TX',
    state: 'TX',
    latMin: 29.5, latMax: 30.2, lngMin: -95.9, lngMax: -95.0,
    url: 'https://arcgis.hcad.org/server/rest/services/public/parcel_public/MapServer/0/query',
    ownerField: 'OWN_NAME', addressField: 'SITE_ADDR',
  },
  // Colorado — Denver
  {
    name: 'Denver County, CO',
    state: 'CO',
    latMin: 39.61, latMax: 39.79, lngMin: -105.11, lngMax: -104.6,
    url: 'https://www.denvergov.org/gis/rest/services/Parcels/MapServer/0/query',
    ownerField: 'OWNER1',
  },
  // Oklahoma — Oklahoma County (OKC)
  {
    name: 'Oklahoma County, OK',
    state: 'OK',
    latMin: 35.32, latMax: 35.72, lngMin: -97.68, lngMax: -97.14,
    url: 'https://gis.oklahomacounty.org/arcgis/rest/services/AssessorParcels/MapServer/0/query',
    ownerField: 'OWNER',
  },
  // Kansas — Sedgwick County (Wichita)
  {
    name: 'Sedgwick County, KS',
    state: 'KS',
    latMin: 37.45, latMax: 37.85, lngMin: -97.6, lngMax: -97.05,
    url: 'https://gisdata.sedgwickcounty.org/arcgis/rest/services/Parcels/MapServer/0/query',
    ownerField: 'OWNER_NAME',
  },
  // Georgia — Fulton County (Atlanta)
  {
    name: 'Fulton County, GA',
    state: 'GA',
    latMin: 33.25, latMax: 34.0, lngMin: -84.65, lngMax: -84.25,
    url: 'https://gisdata.fultoncountyga.gov/arcgis/rest/services/Cadastral/Parcels/MapServer/0/query',
    ownerField: 'OWNER',
  },
  // Tennessee — Davidson County (Nashville)
  {
    name: 'Davidson County, TN',
    state: 'TN',
    latMin: 35.97, latMax: 36.4, lngMin: -87.05, lngMax: -86.51,
    url: 'https://maps.nashville.gov/arcgis/rest/services/Parcels/MapServer/0/query',
    ownerField: 'OWNERNAME',
  },
  // North Carolina — Mecklenburg County (Charlotte)
  {
    name: 'Mecklenburg County, NC',
    state: 'NC',
    latMin: 35.0, latMax: 35.5, lngMin: -81.1, lngMax: -80.55,
    url: 'https://maps.mecklenburgcountync.gov/arcgis/rest/services/Parcels/MapServer/0/query',
    ownerField: 'OWNER_NAME',
  },
  // Missouri — Jackson County (Kansas City)
  {
    name: 'Jackson County, MO',
    state: 'MO',
    latMin: 38.82, latMax: 39.32, lngMin: -94.61, lngMax: -94.1,
    url: 'https://gis2.jacksongov.org/arcgis/rest/services/Cadastral/Parcels/MapServer/0/query',
    ownerField: 'OWNER_NAME',
  },
  // Nebraska — Douglas County (Omaha)
  {
    name: 'Douglas County, NE',
    state: 'NE',
    latMin: 41.17, latMax: 41.4, lngMin: -96.25, lngMax: -95.87,
    url: 'https://maps.dogis.org/arcgis/rest/services/Cadastral/Parcels/MapServer/0/query',
    ownerField: 'OWNER',
  },
];

// ── Lookup Functions ────────────────────────────────────

function findCountyEndpoint(lat: number, lng: number): CountyEndpoint | null {
  return COUNTY_ENDPOINTS.find((ep) =>
    lat >= ep.latMin && lat <= ep.latMax && lng >= ep.lngMin && lng <= ep.lngMax,
  ) || null;
}

async function queryCountyGis(endpoint: CountyEndpoint, lat: number, lng: number): Promise<PropertyInfo | null> {
  const params = new URLSearchParams({
    geometry: `${lng},${lat}`,
    geometryType: 'esriGeometryPoint',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: '*',
    returnGeometry: 'false',
    f: 'json',
  });

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(`${endpoint.url}?${params}`, { signal: controller.signal });
    clearTimeout(timeout);

    if (!res.ok) return null;
    const data = await res.json();

    if (!data.features || data.features.length === 0) return null;
    const attrs = data.features[0].attributes;

    return {
      owner: attrs[endpoint.ownerField] || '',
      address: endpoint.addressField ? attrs[endpoint.addressField] : undefined,
      yearBuilt: endpoint.yearBuiltField ? attrs[endpoint.yearBuiltField]?.toString() : undefined,
      assessedValue: endpoint.valueField ? attrs[endpoint.valueField]?.toString() : undefined,
      source: 'county-gis',
    };
  } catch {
    return null;
  }
}

async function queryRegrid(lat: number, lng: number, token: string): Promise<PropertyInfo | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(
      `https://app.regrid.com/api/v2/parcels/point?lat=${lat}&lng=${lng}&token=${token}`,
      { signal: controller.signal },
    );
    clearTimeout(timeout);

    if (!res.ok) return null;
    const data = await res.json();

    if (!data.features || data.features.length === 0) return null;
    const props = data.features[0].properties;

    return {
      owner: props.owner || '',
      owner2: props.owner2,
      address: props.address,
      city: props.scity,
      state: props.sstate,
      zip: props.szip,
      yearBuilt: props.yearbuilt || props.year_built,
      roofType: props.rooftype || props.roof_cover,
      assessedValue: props.assessed_value || props.assdtotval,
      marketValue: props.market_value || props.mktval,
      buildingSqft: props.building_sqft || props.bldgsqft,
      bedrooms: props.bedrooms || props.beds,
      bathrooms: props.bathrooms || props.baths,
      lastSaleDate: props.sale_date || props.saledatetransfer,
      lastSaleAmount: props.sale_amount || props.saleamount,
      landUse: props.usedesc,
      source: 'regrid',
    };
  } catch {
    return null;
  }
}

// ── Public API ──────────────────────────────────────────

const REGRID_TOKEN_KEY = 'hail-yes:regrid-token';

export function getRegridToken(): string {
  return localStorage.getItem(REGRID_TOKEN_KEY) || '';
}

export function setRegridToken(token: string): void {
  localStorage.setItem(REGRID_TOKEN_KEY, token);
}

export async function lookupProperty(lat: number, lng: number): Promise<PropertyInfo | null> {
  // 1. Try county ArcGIS first (free, unlimited)
  const county = findCountyEndpoint(lat, lng);
  if (county) {
    const result = await queryCountyGis(county, lat, lng);
    if (result && result.owner) return result;
  }

  // 2. Fall back to Regrid if token is configured
  const regridToken = getRegridToken();
  if (regridToken) {
    return queryRegrid(lat, lng, regridToken);
  }

  return null;
}

export function getCoveredCounties(): string[] {
  return COUNTY_ENDPOINTS.map((ep) => `${ep.name}`);
}
