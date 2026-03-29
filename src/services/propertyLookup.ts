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
  // ── DC ────────────────────────────────────────────────
  {
    name: 'District of Columbia',
    state: 'DC',
    latMin: 38.79, latMax: 38.99, lngMin: -77.12, lngMax: -76.91,
    url: 'https://maps2.dcgis.dc.gov/dcgis/rest/services/Property_and_Land/MapServer/40/query',
    ownerField: 'OWNERNAME', addressField: 'PREMISEADD', valueField: 'ASSESSMENT',
  },

  // ── Maryland ──────────────────────────────────────────
  {
    name: 'Baltimore County, MD',
    state: 'MD',
    latMin: 39.17, latMax: 39.72, lngMin: -76.87, lngMax: -76.32,
    url: 'https://bcgis.baltimorecountymd.gov/arcgis/rest/services/Property/Parcels/MapServer/0/query',
    ownerField: 'OWNNAME1', addressField: 'STRTADDR', yearBuiltField: 'YRBUILT',
  },
  {
    name: 'Harford County, MD',
    state: 'MD',
    latMin: 39.35, latMax: 39.72, lngMin: -76.55, lngMax: -76.04,
    url: 'https://hcggis.harfordcountymd.gov/arcgis/rest/services/Cadastral/MapServer/0/query',
    ownerField: 'OWN_1', yearBuiltField: 'YR_BUILT', valueField: 'CUR_T_ASSM',
  },
  {
    name: 'Anne Arundel County, MD',
    state: 'MD',
    latMin: 38.82, latMax: 39.28, lngMin: -76.84, lngMax: -76.44,
    url: 'https://gis.aacounty.org/arcgis/rest/services/Planning_OpenData/MapServer/34/query',
    ownerField: 'ASST_FIRST_OWNER',
  },

  // ── Virginia (DMV) ────────────────────────────────────
  {
    name: 'Prince William County, VA',
    state: 'VA',
    latMin: 38.52, latMax: 38.92, lngMin: -77.73, lngMax: -77.23,
    url: 'https://gisweb.pwcva.gov/arcgis/rest/services/LandRecords/MapServer/4/query',
    ownerField: 'CAMA_OWNER_CUR',
  },
  {
    name: 'City of Alexandria, VA',
    state: 'VA',
    latMin: 38.78, latMax: 38.85, lngMin: -77.15, lngMax: -77.04,
    url: 'https://maps.alexandriava.gov/arcgis/rest/services/alxLandWm/MapServer/1/query',
    ownerField: 'OWN_NAME', valueField: 'TOT_CYR',
  },
  {
    name: 'Spotsylvania County, VA',
    state: 'VA',
    latMin: 38.05, latMax: 38.40, lngMin: -77.82, lngMax: -77.34,
    url: 'https://gis.spotsylvania.va.us/arcgis/rest/services/GeoHub/MapServer/45/query',
    ownerField: 'OwnerSearch', yearBuiltField: 'YEARBUILT', valueField: 'BLDGASSESSMENT',
  },

  // ── Virginia (Richmond Area) ──────────────────────────
  {
    name: 'Hanover County, VA',
    state: 'VA',
    latMin: 37.60, latMax: 38.00, lngMin: -77.70, lngMax: -77.20,
    url: 'https://parcelviewer.geodecisions.com/arcgis/rest/services/Hanover/Public/MapServer/0/query',
    ownerField: 'OWN_NAME1',
  },
  {
    name: 'City of Richmond, VA',
    state: 'VA',
    latMin: 37.44, latMax: 37.60, lngMin: -77.60, lngMax: -77.38,
    url: 'https://services1.arcgis.com/k3vhq11XkBNeeOfM/arcgis/rest/services/City_of_Richmond_Parcels/FeatureServer/0/query',
    ownerField: 'OwnerName', addressField: 'MailAddress', valueField: 'TotalValue',
  },

  // ── Virginia (Fredericksburg / Northern Neck) ────────
  {
    name: 'City of Fredericksburg, VA',
    state: 'VA',
    latMin: 38.28, latMax: 38.33, lngMin: -77.50, lngMax: -77.42,
    url: 'https://maps.fredericksburgva.gov/arcgis/rest/services/Tax_Parcels/MapServer/0/query',
    ownerField: 'Owner', addressField: 'PropertyAddress', valueField: 'TotalPropertyValue',
  },

  // ── Virginia (Hampton Roads) ─────────────────────────
  {
    name: 'City of Norfolk, VA',
    state: 'VA',
    latMin: 36.82, latMax: 36.97, lngMin: -76.35, lngMax: -76.18,
    url: 'https://gisshare.norfolk.gov/pubserver/rest/services/Secure/CONProperties/MapServer/0/query',
    ownerField: 'NORFOLKGIS.Real_Estate_Data2.Owner1',
    addressField: 'NORFOLKGIS.Real_Estate_Data2.prop_street',
    yearBuiltField: 'NORFOLKGIS.Real_Estate_Data2.dwelling_year_built',
    valueField: 'NORFOLKGIS.Real_Estate_Data2.Total1',
  },
  {
    name: 'City of Chesapeake, VA',
    state: 'VA',
    latMin: 36.55, latMax: 36.85, lngMin: -76.45, lngMax: -76.12,
    url: 'https://gis.cityofchesapeake.net/mapping/rest/services/Common_Layers/Parcels/MapServer/0/query',
    ownerField: 'OWNER', addressField: 'ADDRESS', valueField: 'ASMT_TOTAL',
  },
  {
    name: 'City of Newport News, VA',
    state: 'VA',
    latMin: 36.95, latMax: 37.20, lngMin: -76.60, lngMax: -76.38,
    url: 'https://maps.nnva.gov/gis/rest/services/Operational/Parcel/MapServer/0/query',
    ownerField: 'OWNERNME1', addressField: 'SITEADDRESS', valueField: 'CNTIMPVAL',
  },

  // ── Virginia (Roanoke / SW Virginia) ─────────────────
  {
    name: 'Roanoke County, VA',
    state: 'VA',
    latMin: 37.17, latMax: 37.45, lngMin: -80.20, lngMax: -79.75,
    url: 'https://arcgis.roanokecountyva.gov/arcgisweb/rest/services/PropertyReport/PropertyReport/MapServer/3/query',
    ownerField: 'Owner1_LastAndFirst', addressField: 'Full_Address_String',
    yearBuiltField: 'YearBuilt', valueField: 'SumAllCardsTotalValue',
  },

  // ── Maryland (Baltimore City) ────────────────────────
  {
    name: 'Baltimore City, MD',
    state: 'MD',
    latMin: 39.20, latMax: 39.37, lngMin: -76.72, lngMax: -76.53,
    url: 'https://geodata.baltimorecity.gov/egis/rest/services/CityView/Realproperty_OB/FeatureServer/0/query',
    ownerField: 'OWNER_1', addressField: 'FULLADDR',
    yearBuiltField: 'YEAR_BUILD', valueField: 'FULLCASH',
  },

  // ── Pennsylvania ──────────────────────────────────────
  {
    name: 'Philadelphia, PA',
    state: 'PA',
    latMin: 39.86, latMax: 40.14, lngMin: -75.28, lngMax: -74.95,
    url: 'https://services.arcgis.com/fLeGjb7u4uXqeF9q/arcgis/rest/services/PWD_PARCELS/FeatureServer/0/query',
    ownerField: 'owner1',
  },
  {
    name: 'Chester County, PA',
    state: 'PA',
    latMin: 39.71, latMax: 40.17, lngMin: -76.01, lngMax: -75.35,
    url: 'https://maps.pasda.psu.edu/arcgis/rest/services/ChesterCounty/MapServer/11/query',
    ownerField: 'OWN1', valueField: 'TOT_ASSESS',
  },
  {
    name: 'Bucks County, PA',
    state: 'PA',
    latMin: 40.09, latMax: 40.63, lngMin: -75.40, lngMax: -74.72,
    url: 'https://mapservices.pasda.psu.edu/arcgis/rest/services/BucksCounty/MapServer/17/query',
    ownerField: 'OWNER1', valueField: 'TOTAL_VALU',
  },
  {
    name: 'Lancaster County, PA',
    state: 'PA',
    latMin: 39.72, latMax: 40.29, lngMin: -76.72, lngMax: -75.87,
    url: 'https://arcgis.lancastercountypa.gov/arcgis/rest/services/parcel_poly/MapServer/0/query',
    ownerField: 'OWNER_NAME', valueField: 'TOTLASSESS',
  },
  {
    name: 'York County, PA',
    state: 'PA',
    latMin: 39.72, latMax: 40.07, lngMin: -77.04, lngMax: -76.47,
    url: 'https://maps.yorkcounty.gov/arcgis/rest/services/Landrecords_Service/MapServer/7/query',
    ownerField: 'ownerName', yearBuiltField: 'yearBuilt', valueField: 'currTotalVal',
  },
  {
    name: 'Berks County, PA',
    state: 'PA',
    latMin: 40.15, latMax: 40.65, lngMin: -76.30, lngMax: -75.53,
    url: 'https://gis.co.berks.pa.us/arcgis/rest/services/ParcelSearchTable/MapServer/0/query',
    ownerField: 'NAME1', valueField: 'VALUTOTAL',
  },
  {
    name: 'Lehigh County, PA',
    state: 'PA',
    latMin: 40.49, latMax: 40.73, lngMin: -75.82, lngMax: -75.37,
    url: 'https://gis.lehighcounty.org/arcgis/rest/services/OwnerAsmtData/MapServer/0/query',
    ownerField: 'NAMOWN', valueField: 'TOTASMT',
  },

  // ── Texas ─────────────────────────────────────────────
  {
    name: 'Dallas County, TX',
    state: 'TX',
    latMin: 32.55, latMax: 33.02, lngMin: -97.0, lngMax: -96.46,
    url: 'https://maps.dcad.org/prdarcgis/rest/services/Public/Parcel_Public/MapServer/0/query',
    ownerField: 'OwnerName', addressField: 'SitusAddress', yearBuiltField: 'YearBuilt', valueField: 'TotalMarketValue',
  },
  {
    name: 'Tarrant County, TX',
    state: 'TX',
    latMin: 32.55, latMax: 33.0, lngMin: -97.55, lngMax: -97.0,
    url: 'https://gis.tarrantcounty.com/arcgis/rest/services/Parcels/Parcels/MapServer/0/query',
    ownerField: 'OWNER_NAME', addressField: 'SITUS_ADDR',
  },
  {
    name: 'Harris County, TX',
    state: 'TX',
    latMin: 29.5, latMax: 30.2, lngMin: -95.9, lngMax: -95.0,
    url: 'https://arcgis.hcad.org/server/rest/services/public/parcel_public/MapServer/0/query',
    ownerField: 'OWN_NAME', addressField: 'SITE_ADDR',
  },

  // ── Colorado ──────────────────────────────────────────
  {
    name: 'Denver County, CO',
    state: 'CO',
    latMin: 39.61, latMax: 39.79, lngMin: -105.11, lngMax: -104.6,
    url: 'https://www.denvergov.org/gis/rest/services/Parcels/MapServer/0/query',
    ownerField: 'OWNER1',
  },

  // ── Oklahoma ──────────────────────────────────────────
  {
    name: 'Oklahoma County, OK',
    state: 'OK',
    latMin: 35.32, latMax: 35.72, lngMin: -97.68, lngMax: -97.14,
    url: 'https://gis.oklahomacounty.org/arcgis/rest/services/AssessorParcels/MapServer/0/query',
    ownerField: 'OWNER',
  },

  // ── Kansas ────────────────────────────────────────────
  {
    name: 'Sedgwick County, KS',
    state: 'KS',
    latMin: 37.45, latMax: 37.85, lngMin: -97.6, lngMax: -97.05,
    url: 'https://gisdata.sedgwickcounty.org/arcgis/rest/services/Parcels/MapServer/0/query',
    ownerField: 'OWNER_NAME',
  },

  // ── Georgia ───────────────────────────────────────────
  {
    name: 'Fulton County, GA',
    state: 'GA',
    latMin: 33.25, latMax: 34.0, lngMin: -84.65, lngMax: -84.25,
    url: 'https://gisdata.fultoncountyga.gov/arcgis/rest/services/Cadastral/Parcels/MapServer/0/query',
    ownerField: 'OWNER',
  },

  // ── Tennessee ─────────────────────────────────────────
  {
    name: 'Davidson County, TN',
    state: 'TN',
    latMin: 35.97, latMax: 36.4, lngMin: -87.05, lngMax: -86.51,
    url: 'https://maps.nashville.gov/arcgis/rest/services/Parcels/MapServer/0/query',
    ownerField: 'OWNERNAME',
  },

  // ── North Carolina ────────────────────────────────────
  {
    name: 'Mecklenburg County, NC',
    state: 'NC',
    latMin: 35.0, latMax: 35.5, lngMin: -81.1, lngMax: -80.55,
    url: 'https://maps.mecklenburgcountync.gov/arcgis/rest/services/Parcels/MapServer/0/query',
    ownerField: 'OWNER_NAME',
  },

  // ── Missouri ──────────────────────────────────────────
  {
    name: 'Jackson County, MO',
    state: 'MO',
    latMin: 38.82, latMax: 39.32, lngMin: -94.61, lngMax: -94.1,
    url: 'https://gis2.jacksongov.org/arcgis/rest/services/Cadastral/Parcels/MapServer/0/query',
    ownerField: 'OWNER_NAME',
  },

  // ── Nebraska ──────────────────────────────────────────
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
