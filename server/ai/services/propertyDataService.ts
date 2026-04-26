/**
 * Property Data Service
 * Fetches property details from free public data sources.
 *
 * Sources (all free, no API key):
 * 1. OpenStreetMap (Nominatim reverse geocode) — building type, address
 * 2. OpenStreetMap (Overpass) — building tags: levels, material, roof shape, year
 * 3. County GIS servers (state-specific) — owner, value, year built
 *
 * Falls back gracefully if no data is available for the area.
 */

export interface PropertyData {
  ownerName: string | null;
  mailingAddress: string | null;
  assessedValue: number | null;
  marketValue: number | null;
  landValue: number | null;
  yearBuilt: number | null;
  lotSizeSqFt: number | null;
  lotSizeAcres: number | null;
  buildingSqFt: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  propertyClass: string | null;
  lastSaleDate: string | null;
  lastSalePrice: number | null;
  taxAmount: number | null;
  buildingLevels: number | null;
  buildingMaterial: string | null;
  roofShape: string | null;
  dataSource: string;
  hasData: boolean;
}

/**
 * Get property data for a lat/lng coordinate.
 * Tries OpenStreetMap building tags + county GIS where available.
 */
export async function getPropertyData(
  lat: number,
  lng: number,
  _address?: string
): Promise<PropertyData> {
  // Try OSM building data + county GIS in parallel
  const [osmResult, countyResult] = await Promise.all([
    queryOSMBuildingData(lat, lng).catch(() => null),
    queryCountyGIS(lat, lng).catch(() => null),
  ]);

  // Merge: county data wins for official fields, OSM fills gaps
  if (countyResult?.hasData && osmResult?.hasData) {
    return mergeResults(countyResult, osmResult);
  }
  if (countyResult?.hasData) return countyResult;
  if (osmResult?.hasData) return osmResult;

  return emptyResult();
}

function mergeResults(primary: PropertyData, secondary: PropertyData): PropertyData {
  return {
    ownerName: primary.ownerName || secondary.ownerName,
    mailingAddress: primary.mailingAddress || secondary.mailingAddress,
    assessedValue: primary.assessedValue || secondary.assessedValue,
    marketValue: primary.marketValue || secondary.marketValue,
    landValue: primary.landValue || secondary.landValue,
    yearBuilt: primary.yearBuilt || secondary.yearBuilt,
    lotSizeSqFt: primary.lotSizeSqFt || secondary.lotSizeSqFt,
    lotSizeAcres: primary.lotSizeAcres || secondary.lotSizeAcres,
    buildingSqFt: primary.buildingSqFt || secondary.buildingSqFt,
    bedrooms: primary.bedrooms || secondary.bedrooms,
    bathrooms: primary.bathrooms || secondary.bathrooms,
    propertyClass: primary.propertyClass || secondary.propertyClass,
    lastSaleDate: primary.lastSaleDate || secondary.lastSaleDate,
    lastSalePrice: primary.lastSalePrice || secondary.lastSalePrice,
    taxAmount: primary.taxAmount || secondary.taxAmount,
    buildingLevels: primary.buildingLevels || secondary.buildingLevels,
    buildingMaterial: primary.buildingMaterial || secondary.buildingMaterial,
    roofShape: primary.roofShape || secondary.roofShape,
    dataSource: `${primary.dataSource} + ${secondary.dataSource}`,
    hasData: true,
  };
}

/**
 * Query OpenStreetMap Overpass API for building tags at a point.
 * OSM buildings often have: levels, material, roof:shape, start_date, name.
 */
async function queryOSMBuildingData(
  lat: number,
  lng: number
): Promise<PropertyData | null> {
  // Query buildings within ~30m of the point
  const radius = 30;
  const query = `[out:json][timeout:10];(way["building"](around:${radius},${lat},${lng});relation["building"](around:${radius},${lat},${lng}););out tags;`;

  const res = await fetch("https://overpass-api.de/api/interpreter", {
    method: "POST",
    body: `data=${encodeURIComponent(query)}`,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    signal: AbortSignal.timeout(12000),
  });

  if (!res.ok) return null;
  const data = await res.json();

  const elements = data?.elements;
  if (!elements || elements.length === 0) return null;

  // Pick the closest/most-tagged building
  const building = elements.reduce((best: any, el: any) => {
    const tagCount = Object.keys(el.tags || {}).length;
    const bestCount = Object.keys(best?.tags || {}).length;
    return tagCount > bestCount ? el : best;
  }, elements[0]);

  const tags = building.tags || {};

  const levels = parseInt(tags["building:levels"]) || null;
  const material = tags["building:material"] || tags["material"] || null;
  const roofShape = tags["roof:shape"] || null;
  const startDate = tags["start_date"] || tags["year_of_construction"] || null;
  const buildingType = tags["building"] || null;

  // Estimate sqft from levels (very rough: avg US home floor ~1200sqft)
  const estimatedSqFt = levels ? levels * 1200 : null;

  return {
    ownerName: null,
    mailingAddress: tags["addr:street"]
      ? `${tags["addr:housenumber"] || ""} ${tags["addr:street"]}, ${tags["addr:city"] || ""} ${tags["addr:state"] || ""} ${tags["addr:postcode"] || ""}`.trim()
      : null,
    assessedValue: null,
    marketValue: null,
    landValue: null,
    yearBuilt: parseYear(startDate),
    lotSizeSqFt: null,
    lotSizeAcres: null,
    buildingSqFt: estimatedSqFt,
    bedrooms: null,
    bathrooms: null,
    propertyClass: classifyBuildingType(buildingType),
    lastSaleDate: null,
    lastSalePrice: null,
    taxAmount: null,
    buildingLevels: levels,
    buildingMaterial: material,
    roofShape: roofShape,
    dataSource: "OpenStreetMap",
    hasData: !!(levels || material || roofShape || startDate || buildingType !== "yes"),
  };
}

/**
 * Query county-specific GIS servers for property assessment data.
 * Many counties publish ArcGIS Feature Services with full CAMA data.
 * We maintain a registry of known working endpoints by state FIPS.
 *
 * This will grow over time as you add more counties.
 */
async function queryCountyGIS(
  lat: number,
  lng: number
): Promise<PropertyData | null> {
  // First, determine which state/county we're in using FCC API
  const fccRes = await fetch(
    `https://geo.fcc.gov/api/census/area?lat=${lat}&lon=${lng}&format=json`,
    { signal: AbortSignal.timeout(8000) }
  );

  if (!fccRes.ok) return null;
  const fccData = await fccRes.json();
  const area = fccData?.results?.[0];
  if (!area) return null;

  // FCC API returns county_fips as the full 5-digit FIPS (state+county)
  const fullFips = area.county_fips;

  // Look up known county GIS server
  const endpoint = COUNTY_GIS_REGISTRY[fullFips];
  if (!endpoint) return null;

  try {
    const url = new URL(endpoint.url);
    url.searchParams.set("geometry", `${lng},${lat}`);
    url.searchParams.set("geometryType", "esriGeometryPoint");
    url.searchParams.set("inSR", "4326");
    url.searchParams.set("spatialRel", "esriSpatialRelIntersects");
    url.searchParams.set("outFields", endpoint.fields.join(","));
    url.searchParams.set("returnGeometry", "false");
    url.searchParams.set("resultRecordCount", "1");
    url.searchParams.set("f", "json");

    const res = await fetch(url.toString(), {
      signal: AbortSignal.timeout(12000),
    });

    if (!res.ok) return null;
    const data = await res.json();

    const features = data?.features;
    if (!features || features.length === 0) return null;

    const attrs = features[0].attributes;
    return endpoint.parse(attrs);
  } catch {
    return null;
  }
}

// ============================================================
// County GIS Registry
// Add county GIS endpoints here as you discover them.
// FIPS code = state (2 digits) + county (3 digits)
// ============================================================

interface CountyGISEndpoint {
  url: string;
  fields: string[];
  parse: (attrs: any) => PropertyData;
}

/**
 * Shared parser for all Maryland counties via the MD iMAP statewide service.
 * URL: https://mdgeodata.md.gov/imap/rest/services/PlanningCadastre/MD_ParcelBoundaries/MapServer/0/query
 * 117 fields including owner, assessment, year built, sqft, sale data, construction details.
 */
function parseMDStatewide(dataSourceLabel: string): (attrs: any) => PropertyData {
  return (a: any) => ({
    ownerName: cleanString(a.OWNADD1),  // MD uses OWNADD1 for owner info
    mailingAddress: [cleanString(a.ADDRESS), cleanString(a.CITY), cleanString(a.ZIPCODE)].filter(Boolean).join(", ") || null,
    assessedValue: parseNum(a.NFMTTLVL),
    marketValue: null,
    landValue: parseNum(a.NFMLNDVL),
    yearBuilt: parseYear(a.YEARBLT),
    lotSizeSqFt: a.ACRES ? Math.round((parseFloat(a.ACRES) || 0) * 43560) : null,
    lotSizeAcres: parseFloat(a.ACRES) || null,
    buildingSqFt: parseNum(a.SQFTSTRC),
    bedrooms: null,
    bathrooms: null,
    propertyClass: cleanString(a.DESCLU) || classifyUseCode(a.DESCCIUSE),
    lastSaleDate: a.TRADATE ? `${a.TRADATE.slice(0, 4)}-${a.TRADATE.slice(4, 6)}-${a.TRADATE.slice(6, 8)}` : null,
    lastSalePrice: parseNum(a.CONSIDR1),
    taxAmount: null,
    buildingLevels: parseNum(a.BLDG_STORY),
    buildingMaterial: cleanString(a.DESCCNST),
    roofShape: null,
    dataSource: `${dataSourceLabel} (MD iMAP)`,
    hasData: !!(a.OWNADD1 || a.NFMTTLVL || a.YEARBLT),
  });
}

const COUNTY_GIS_REGISTRY: Record<string, CountyGISEndpoint> = {
  // Montgomery County, MD (FIPS: 24031) — uses MD statewide endpoint
  "24031": {
    url: "https://mdgeodata.md.gov/imap/rest/services/PlanningCadastre/MD_ParcelBoundaries/MapServer/0/query",
    fields: ["ACCTID", "JURSCODE", "ADDRESS", "CITY", "ZIPCODE", "OWNADD1", "DESCCIUSE", "DESCLU", "ACRES", "YEARBLT", "SQFTSTRC", "NFMLNDVL", "NFMIMPVL", "NFMTTLVL", "TRADATE", "CONSIDR1", "BLDG_STORY", "BLDG_UNITS", "DESCSTYL", "DESCBLDG", "DESCCNST"],
    parse: parseMDStatewide("Montgomery County MD"),
  },
  // Fairfax County, VA (FIPS: 51059)
  "51059": {
    url: "https://gis.fairfaxcounty.gov/server/rest/services/FXCO_OPEN/FXCO_OpenData_Parcels/FeatureServer/0/query",
    fields: ["OWNER_NAME1", "YEAR_BUILT", "LIVING_AREA", "LOT_SIZE", "ASSESSED_VALUE", "LAND_VALUE", "PROPERTY_USE"],
    parse: (a: any) => ({
      ownerName: cleanString(a.OWNER_NAME1),
      mailingAddress: null,
      assessedValue: parseNum(a.ASSESSED_VALUE),
      marketValue: null,
      landValue: parseNum(a.LAND_VALUE),
      yearBuilt: parseYear(a.YEAR_BUILT),
      lotSizeSqFt: parseNum(a.LOT_SIZE),
      lotSizeAcres: a.LOT_SIZE ? Math.round((parseFloat(a.LOT_SIZE) || 0) / 43560 * 100) / 100 : null,
      buildingSqFt: parseNum(a.LIVING_AREA),
      bedrooms: null,
      bathrooms: null,
      propertyClass: classifyUseCode(a.PROPERTY_USE),
      lastSaleDate: null,
      lastSalePrice: null,
      taxAmount: null,
      buildingLevels: null,
      buildingMaterial: null,
      roofShape: null,
      dataSource: "Fairfax County VA GIS",
      hasData: !!(a.OWNER_NAME1 || a.ASSESSED_VALUE || a.YEAR_BUILT),
    }),
  },
  // ============================================
  // VIRGINIA — DMV Area
  // ============================================

  // Arlington County, VA (FIPS: 51013) — parcel boundaries only, no assessment
  // URL: https://arlgis.arlingtonva.us/arcgis/rest/services/Public_Maps/Parcel_Map/MapServer/1/query
  // Fields: RPCMSTR only — NO PUBLIC GIS with assessment data

  // Prince William County, VA (FIPS: 51153)
  // NOTE: Spatial queries fail (native SR 2283), use attribute query via GPIN/City
  "51153": {
    url: "https://gisweb.pwcva.gov/arcgis/rest/services/CountyMapper/LandRecords/MapServer/4/query",
    fields: ["CAMA_OWNER_CUR", "CAMA_SQFTABV", "CAMA_TaxAcreage1", "CAMA_USECODE", "StreetNumber", "StreetName", "StreetType", "ZipCode", "City", "SubdivisionName", "Acreage", "GPIN"],
    parse: (a: any) => ({
      ownerName: cleanString(a.CAMA_OWNER_CUR),
      mailingAddress: null,
      assessedValue: null,
      marketValue: null,
      landValue: null,
      yearBuilt: null,
      lotSizeSqFt: a.CAMA_TaxAcreage1 ? Math.round((parseFloat(a.CAMA_TaxAcreage1) || 0) * 43560) : null,
      lotSizeAcres: parseFloat(a.CAMA_TaxAcreage1) || parseFloat(a.Acreage) || null,
      buildingSqFt: parseNum(a.CAMA_SQFTABV),
      bedrooms: null,
      bathrooms: null,
      propertyClass: classifyUseCode(a.CAMA_USECODE),
      lastSaleDate: null,
      lastSalePrice: null,
      taxAmount: null,
      buildingLevels: null,
      buildingMaterial: null,
      roofShape: null,
      dataSource: "Prince William County VA GIS",
      hasData: !!(a.CAMA_OWNER_CUR || a.CAMA_SQFTABV),
    }),
  },

  // Loudoun County, VA (FIPS: 51107)
  // NOTE: Spatial queries fail (custom SR 102633). Attribute queries work.
  "51107": {
    url: "https://services.arcgis.com/f4rR7WnIfGBdVYFd/arcgis/rest/services/Tax_Parcels/FeatureServer/0/query",
    fields: ["Owner1", "Mailing_Address", "CityStateZip", "Tax_Year", "Land_Value", "Improvements", "Total_Value", "Assessing_Neighborhood", "Tax_Status", "Assessing_Primary_Use", "MillRate", "PAN"],
    parse: (a: any) => ({
      ownerName: cleanString(a.Owner1),
      mailingAddress: cleanString(a.Mailing_Address),
      assessedValue: parseNum(a.Total_Value),
      marketValue: null,
      landValue: parseNum(a.Land_Value),
      yearBuilt: null,
      lotSizeSqFt: null,
      lotSizeAcres: null,
      buildingSqFt: null,
      bedrooms: null,
      bathrooms: null,
      propertyClass: classifyUseCode(a.Assessing_Primary_Use),
      lastSaleDate: null,
      lastSalePrice: null,
      taxAmount: null,
      buildingLevels: null,
      buildingMaterial: null,
      roofShape: null,
      dataSource: "Loudoun County VA GIS",
      hasData: !!(a.Owner1 || a.Total_Value),
    }),
  },

  // Stafford County, VA (FIPS: 51179) — NO PUBLIC GIS with parcel/assessment data

  // Spotsylvania County, VA (FIPS: 51177)
  "51177": {
    url: "https://gis.spotsylvania.va.us/arcgis/rest/services/GeoHub/GeoHub/FeatureServer/45/query",
    fields: ["OwnerSearch", "MAILADDRESS", "CITY", "STATE", "ZIPCODE", "YEARBUILT", "SQFEET", "BLDGASSESSMENT", "LANDASSESSMENT", "LANDAREA", "PROPADDRESS", "TRANSFERDATE", "SALEPRICE", "ZONING"],
    parse: (a: any) => ({
      ownerName: cleanString(a.OwnerSearch),
      mailingAddress: [cleanString(a.MAILADDRESS), cleanString(a.CITY), cleanString(a.STATE), cleanString(a.ZIPCODE)].filter(Boolean).join(", ") || null,
      assessedValue: (parseNum(a.BLDGASSESSMENT) || 0) + (parseNum(a.LANDASSESSMENT) || 0) || null,
      marketValue: null,
      landValue: parseNum(a.LANDASSESSMENT),
      yearBuilt: parseYear(a.YEARBUILT),
      lotSizeSqFt: null,
      lotSizeAcres: parseFloat(a.LANDAREA) || null,
      buildingSqFt: parseNum(a.SQFEET),
      bedrooms: null,
      bathrooms: null,
      propertyClass: null,
      lastSaleDate: cleanString(a.TRANSFERDATE),
      lastSalePrice: parseNum(a.SALEPRICE),
      taxAmount: null,
      buildingLevels: null,
      buildingMaterial: null,
      roofShape: null,
      dataSource: "Spotsylvania County VA GIS",
      hasData: !!(a.OwnerSearch || a.BLDGASSESSMENT || a.YEARBUILT),
    }),
  },

  // Fauquier County, VA (FIPS: 51061)
  "51061": {
    url: "https://agol.gis.fauquiercounty.gov:6443/arcgis/rest/services/Authoritative/Fauquier_County_Parcels/FeatureServer/32/query",
    fields: ["OWNERNME1", "PSTLADDRESS", "PSTLCITY", "PSTLSTATE", "PSTLZIP5", "SITEADDRESS", "Building_Value_Assessed", "Land_Value_Assessed", "Final_Value_Assessed", "Year_Built", "Living_Area", "Lot_Size", "Stories", "Style_DESC", "Grade", "Primary_Use_DESC", "LASTSALEDATE", "LASTSALEPRICE"],
    parse: (a: any) => ({
      ownerName: cleanString(a.OWNERNME1),
      mailingAddress: [cleanString(a.PSTLADDRESS), cleanString(a.PSTLCITY), cleanString(a.PSTLSTATE), cleanString(a.PSTLZIP5)].filter(Boolean).join(", ") || null,
      assessedValue: parseNum(a.Final_Value_Assessed),
      marketValue: null,
      landValue: parseNum(a.Land_Value_Assessed),
      yearBuilt: parseYear(a.Year_Built),
      lotSizeSqFt: parseNum(a.Lot_Size),
      lotSizeAcres: a.Lot_Size ? Math.round((parseFloat(a.Lot_Size) || 0) / 43560 * 100) / 100 : null,
      buildingSqFt: parseNum(a.Living_Area),
      bedrooms: null,
      bathrooms: null,
      propertyClass: classifyUseCode(a.Primary_Use_DESC),
      lastSaleDate: cleanString(a.LASTSALEDATE),
      lastSalePrice: parseNum(a.LASTSALEPRICE),
      taxAmount: null,
      buildingLevels: parseNum(a.Stories),
      buildingMaterial: null,
      roofShape: null,
      dataSource: "Fauquier County VA GIS",
      hasData: !!(a.OWNERNME1 || a.Final_Value_Assessed || a.Year_Built),
    }),
  },

  // City of Alexandria, VA (FIPS: 51510)
  "51510": {
    url: "https://geoportal.alexandriava.gov/server/rest/services/Real_Estate_Parcels/FeatureServer/0/query",
    fields: ["OWN_NAME", "OWN_ADD", "OWN_CITY", "OWN_STAT", "OWN_ZIP", "LAND_CYR", "IMP_CYR", "TOT_CYR", "LAND_SF", "LANDDESC", "ADDRESS_RE", "NEIGHBORHO", "ZONING"],
    parse: (a: any) => ({
      ownerName: cleanString(a.OWN_NAME),
      mailingAddress: [cleanString(a.OWN_ADD), cleanString(a.OWN_CITY), cleanString(a.OWN_STAT), cleanString(a.OWN_ZIP)].filter(Boolean).join(", ") || null,
      assessedValue: parseNum(a.TOT_CYR),
      marketValue: null,
      landValue: parseNum(a.LAND_CYR),
      yearBuilt: null,
      lotSizeSqFt: parseNum(a.LAND_SF),
      lotSizeAcres: a.LAND_SF ? Math.round((parseFloat(a.LAND_SF) || 0) / 43560 * 100) / 100 : null,
      buildingSqFt: null,
      bedrooms: null,
      bathrooms: null,
      propertyClass: classifyUseCode(a.LANDDESC),
      lastSaleDate: null,
      lastSalePrice: null,
      taxAmount: null,
      buildingLevels: null,
      buildingMaterial: null,
      roofShape: null,
      dataSource: "City of Alexandria VA GIS",
      hasData: !!(a.OWN_NAME || a.TOT_CYR),
    }),
  },

  // City of Manassas, VA (FIPS: 51683)
  // NOTE: Spatial queries fail (native SR). Attribute queries work.
  "51683": {
    url: "https://manassasgis.manassasva.gov/arcgis21/rest/services/Parcels_Full/FeatureServer/0/query",
    fields: ["OWNER_NAME", "OWNER_ADDRESS", "OWNER_CSZ", "BLDG_VALUE", "LAND_VALUE", "TOTAL_VALUE", "USE_CODE", "FULL_ADDRESS", "LAST_SALE_DATE", "LAST_SALE_PRICE", "LAND_SQ_FT", "GPIN_NUM"],
    parse: (a: any) => ({
      ownerName: cleanString(a.OWNER_NAME),
      mailingAddress: [cleanString(a.OWNER_ADDRESS), cleanString(a.OWNER_CSZ)].filter(Boolean).join(", ") || null,
      assessedValue: parseNum(a.TOTAL_VALUE),
      marketValue: null,
      landValue: parseNum(a.LAND_VALUE),
      yearBuilt: null,
      lotSizeSqFt: parseNum(a.LAND_SQ_FT),
      lotSizeAcres: a.LAND_SQ_FT ? Math.round((parseFloat(a.LAND_SQ_FT) || 0) / 43560 * 100) / 100 : null,
      buildingSqFt: null,
      bedrooms: null,
      bathrooms: null,
      propertyClass: classifyUseCode(a.USE_CODE),
      lastSaleDate: a.LAST_SALE_DATE ? new Date(a.LAST_SALE_DATE).toISOString().slice(0, 10) : null,
      lastSalePrice: parseNum(a.LAST_SALE_PRICE),
      taxAmount: null,
      buildingLevels: null,
      buildingMaterial: null,
      roofShape: null,
      dataSource: "City of Manassas VA GIS",
      hasData: !!(a.OWNER_NAME || a.TOTAL_VALUE),
    }),
  },

  // City of Fredericksburg, VA (FIPS: 51630) — parcel boundaries only, no assessment fields
  // URL: https://maps.fredericksburgva.gov/arcgis/rest/services/WebLoGIStics/Fredericksburg_WL_P/MapServer/7/query
  // Fields: GPIN only — NO assessment data in public GIS

  // Falls Church city, VA (FIPS: 51610) — parcel boundaries only, no assessment fields
  // URL: https://services1.arcgis.com/2hmXRAz4ofcdQP6p/arcgis/rest/services/20220412ParcelLayer_view/FeatureServer/0/query
  // Fields: PIN, Acres, STATUS — NO assessment data in public GIS

  // ============================================
  // VIRGINIA — Richmond Area
  // ============================================

  // Henrico County, VA (FIPS: 51087)
  // NOTE: Spatial queries may fail. Attribute queries work.
  "51087": {
    url: "https://services1.arcgis.com/qTQ6qYkHpxlu0G82/arcgis/rest/services/Tax_Parcels_and_CAMA_Data/FeatureServer/0/query",
    fields: ["CAMA_GPIN", "FULL_ADDRE", "CITY", "ZIP_CODE", "LAND_VALUE", "IMPROVEMEN", "USE_DESCRI", "RESIDENTIA", "NUMBER_STO", "NUMBER_BED", "NUMBER_FUL", "NUMBER_HAL", "SQFT_BUILD", "YEAR_BUILT", "LAST_SALE_", "LAST_SAL_1", "PARCEL_ACR", "LEGAL_DESC", "TAX_YEAR"],
    parse: (a: any) => ({
      ownerName: null,  // Not in public CAMA layer
      mailingAddress: null,
      assessedValue: (parseNum(a.LAND_VALUE) || 0) + (parseNum(a.IMPROVEMEN) || 0) || null,
      marketValue: null,
      landValue: parseNum(a.LAND_VALUE),
      yearBuilt: parseYear(a.YEAR_BUILT),
      lotSizeSqFt: a.PARCEL_ACR ? Math.round((parseFloat(a.PARCEL_ACR) || 0) * 43560) : null,
      lotSizeAcres: parseFloat(a.PARCEL_ACR) || null,
      buildingSqFt: parseNum(a.SQFT_BUILD),
      bedrooms: parseNum(a.NUMBER_BED),
      bathrooms: (parseNum(a.NUMBER_FUL) || 0) + (parseNum(a.NUMBER_HAL) || 0) * 0.5 || null,
      propertyClass: classifyUseCode(a.USE_DESCRI),
      lastSaleDate: a.LAST_SALE_ ? new Date(a.LAST_SALE_).toISOString().slice(0, 10) : null,
      lastSalePrice: parseNum(a.LAST_SAL_1),
      taxAmount: null,
      buildingLevels: parseNum(a.NUMBER_STO),
      buildingMaterial: null,
      roofShape: null,
      dataSource: "Henrico County VA GIS",
      hasData: !!(a.LAND_VALUE || a.YEAR_BUILT || a.SQFT_BUILD),
    }),
  },

  // Chesterfield County, VA (FIPS: 51041)
  "51041": {
    url: "https://services3.arcgis.com/TsynfzBSE6sXfoLq/arcgis/rest/services/Cadastral_ProdA/FeatureServer/3/query",
    fields: ["OwnerName", "OwnerAddress", "OwnerCity", "OwnerState", "OwnerZip", "FairMarketValue", "LandUseValue", "ImprovementValue", "TotalAssessment", "YearBuilt", "Stories", "FinishedArea", "UnfinishedArea", "Bedrooms", "FullBath", "HalfBath", "UseCode", "SaleDate", "SalePrice", "DeededAcres", "Address"],
    parse: (a: any) => ({
      ownerName: cleanString(a.OwnerName),
      mailingAddress: [cleanString(a.OwnerAddress), cleanString(a.OwnerCity), cleanString(a.OwnerState), cleanString(a.OwnerZip)].filter(Boolean).join(", ") || null,
      assessedValue: parseNum(a.TotalAssessment),
      marketValue: parseNum(a.FairMarketValue),
      landValue: parseNum(a.LandUseValue) || parseNum(a.ImprovementValue) ? (parseNum(a.TotalAssessment) || 0) - (parseNum(a.ImprovementValue) || 0) : null,
      yearBuilt: parseYear(a.YearBuilt),
      lotSizeSqFt: a.DeededAcres ? Math.round((parseFloat(a.DeededAcres) || 0) * 43560) : null,
      lotSizeAcres: parseFloat(a.DeededAcres) || null,
      buildingSqFt: parseNum(a.FinishedArea),
      bedrooms: parseNum(a.Bedrooms),
      bathrooms: (parseNum(a.FullBath) || 0) + (parseNum(a.HalfBath) || 0) * 0.5 || null,
      propertyClass: classifyUseCode(a.UseCode),
      lastSaleDate: cleanString(a.SaleDate),
      lastSalePrice: parseNum(a.SalePrice),
      taxAmount: null,
      buildingLevels: parseNum(a.Stories),
      buildingMaterial: null,
      roofShape: null,
      dataSource: "Chesterfield County VA GIS",
      hasData: !!(a.OwnerName || a.TotalAssessment || a.YearBuilt),
    }),
  },

  // Hanover County, VA (FIPS: 51085) — limited assessment fields
  "51085": {
    url: "https://parcelviewer.geodecisions.com/arcgis/rest/services/Hanover/Public/MapServer/0/query",
    fields: ["OWN_NAME1", "PROPERTYADDRESS", "GPIN", "MAGISTERIAL_DISTRICT", "ZONING_LIST"],
    parse: (a: any) => ({
      ownerName: cleanString(a.OWN_NAME1),
      mailingAddress: null,
      assessedValue: null,
      marketValue: null,
      landValue: null,
      yearBuilt: null,
      lotSizeSqFt: null,
      lotSizeAcres: null,
      buildingSqFt: null,
      bedrooms: null,
      bathrooms: null,
      propertyClass: null,
      lastSaleDate: null,
      lastSalePrice: null,
      taxAmount: null,
      buildingLevels: null,
      buildingMaterial: null,
      roofShape: null,
      dataSource: "Hanover County VA GIS",
      hasData: !!(a.OWN_NAME1),
    }),
  },

  // City of Richmond, VA (FIPS: 51760)
  // NOTE: Spatial queries may fail (native SR). Attribute queries work.
  "51760": {
    url: "https://services1.arcgis.com/k3vhq11XkBNeeOfM/arcgis/rest/services/Parcels/FeatureServer/0/query",
    fields: ["OwnerName", "MailAddress", "MailCity", "MailState", "MailZip", "LandValue", "DwellingValue", "TotalValue", "LandSqFt", "PropertyClass", "LandUse", "PIN"],
    parse: (a: any) => ({
      ownerName: cleanString(a.OwnerName),
      mailingAddress: [cleanString(a.MailAddress), cleanString(a.MailCity), cleanString(a.MailState), cleanString(a.MailZip)].filter(Boolean).join(", ") || null,
      assessedValue: parseNum(a.TotalValue),
      marketValue: null,
      landValue: parseNum(a.LandValue),
      yearBuilt: null,
      lotSizeSqFt: parseNum(a.LandSqFt),
      lotSizeAcres: a.LandSqFt ? Math.round((parseFloat(a.LandSqFt) || 0) / 43560 * 100) / 100 : null,
      buildingSqFt: null,
      bedrooms: null,
      bathrooms: null,
      propertyClass: cleanString(a.PropertyClass) || classifyUseCode(a.LandUse),
      lastSaleDate: null,
      lastSalePrice: null,
      taxAmount: null,
      buildingLevels: null,
      buildingMaterial: null,
      roofShape: null,
      dataSource: "City of Richmond VA GIS",
      hasData: !!(a.OwnerName || a.TotalValue),
    }),
  },

  // ============================================
  // MARYLAND — DMV (Statewide service covers ALL MD counties)
  // ============================================

  // Prince George's County, MD (FIPS: 24033)
  "24033": {
    url: "https://mdgeodata.md.gov/imap/rest/services/PlanningCadastre/MD_ParcelBoundaries/MapServer/0/query",
    fields: ["ACCTID", "JURSCODE", "ADDRESS", "CITY", "ZIPCODE", "OWNADD1", "DESCCIUSE", "DESCLU", "ACRES", "YEARBLT", "SQFTSTRC", "NFMLNDVL", "NFMIMPVL", "NFMTTLVL", "TRADATE", "CONSIDR1", "BLDG_STORY", "BLDG_UNITS", "DESCSTYL", "DESCBLDG", "DESCCNST"],
    parse: parseMDStatewide("Prince George's County MD"),
  },

  // Anne Arundel County, MD (FIPS: 24003)
  "24003": {
    url: "https://mdgeodata.md.gov/imap/rest/services/PlanningCadastre/MD_ParcelBoundaries/MapServer/0/query",
    fields: ["ACCTID", "JURSCODE", "ADDRESS", "CITY", "ZIPCODE", "OWNADD1", "DESCCIUSE", "DESCLU", "ACRES", "YEARBLT", "SQFTSTRC", "NFMLNDVL", "NFMIMPVL", "NFMTTLVL", "TRADATE", "CONSIDR1", "BLDG_STORY", "BLDG_UNITS", "DESCSTYL", "DESCBLDG", "DESCCNST"],
    parse: parseMDStatewide("Anne Arundel County MD"),
  },

  // Howard County, MD (FIPS: 24027)
  "24027": {
    url: "https://mdgeodata.md.gov/imap/rest/services/PlanningCadastre/MD_ParcelBoundaries/MapServer/0/query",
    fields: ["ACCTID", "JURSCODE", "ADDRESS", "CITY", "ZIPCODE", "OWNADD1", "DESCCIUSE", "DESCLU", "ACRES", "YEARBLT", "SQFTSTRC", "NFMLNDVL", "NFMIMPVL", "NFMTTLVL", "TRADATE", "CONSIDR1", "BLDG_STORY", "BLDG_UNITS", "DESCSTYL", "DESCBLDG", "DESCCNST"],
    parse: parseMDStatewide("Howard County MD"),
  },

  // Frederick County, MD (FIPS: 24021)
  "24021": {
    url: "https://mdgeodata.md.gov/imap/rest/services/PlanningCadastre/MD_ParcelBoundaries/MapServer/0/query",
    fields: ["ACCTID", "JURSCODE", "ADDRESS", "CITY", "ZIPCODE", "OWNADD1", "DESCCIUSE", "DESCLU", "ACRES", "YEARBLT", "SQFTSTRC", "NFMLNDVL", "NFMIMPVL", "NFMTTLVL", "TRADATE", "CONSIDR1", "BLDG_STORY", "BLDG_UNITS", "DESCSTYL", "DESCBLDG", "DESCCNST"],
    parse: parseMDStatewide("Frederick County MD"),
  },

  // Charles County, MD (FIPS: 24017)
  "24017": {
    url: "https://mdgeodata.md.gov/imap/rest/services/PlanningCadastre/MD_ParcelBoundaries/MapServer/0/query",
    fields: ["ACCTID", "JURSCODE", "ADDRESS", "CITY", "ZIPCODE", "OWNADD1", "DESCCIUSE", "DESCLU", "ACRES", "YEARBLT", "SQFTSTRC", "NFMLNDVL", "NFMIMPVL", "NFMTTLVL", "TRADATE", "CONSIDR1", "BLDG_STORY", "BLDG_UNITS", "DESCSTYL", "DESCBLDG", "DESCCNST"],
    parse: parseMDStatewide("Charles County MD"),
  },

  // Calvert County, MD (FIPS: 24009)
  "24009": {
    url: "https://mdgeodata.md.gov/imap/rest/services/PlanningCadastre/MD_ParcelBoundaries/MapServer/0/query",
    fields: ["ACCTID", "JURSCODE", "ADDRESS", "CITY", "ZIPCODE", "OWNADD1", "DESCCIUSE", "DESCLU", "ACRES", "YEARBLT", "SQFTSTRC", "NFMLNDVL", "NFMIMPVL", "NFMTTLVL", "TRADATE", "CONSIDR1", "BLDG_STORY", "BLDG_UNITS", "DESCSTYL", "DESCBLDG", "DESCCNST"],
    parse: parseMDStatewide("Calvert County MD"),
  },

  // ============================================
  // PENNSYLVANIA
  // ============================================

  // Philadelphia County, PA (FIPS: 42101)
  // NOTE: Spatial queries may fail. Attribute queries work (nightly updates).
  "42101": {
    url: "https://services.arcgis.com/fLeGjb7u4uXqeF9q/arcgis/rest/services/OPA_Properties_Public/FeatureServer/0/query",
    fields: ["owner_1", "location", "market_value", "sale_price", "sale_date", "total_area", "total_livable_area", "year_built", "number_of_bedrooms", "number_of_bathrooms", "category_code_description", "building_code_description", "depth", "frontage"],
    parse: (a: any) => ({
      ownerName: cleanString(a.owner_1),
      mailingAddress: null,
      assessedValue: parseNum(a.market_value),
      marketValue: parseNum(a.market_value),
      landValue: null,
      yearBuilt: parseYear(a.year_built),
      lotSizeSqFt: parseNum(a.total_area),
      lotSizeAcres: a.total_area ? Math.round((parseFloat(a.total_area) || 0) / 43560 * 100) / 100 : null,
      buildingSqFt: parseNum(a.total_livable_area),
      bedrooms: parseNum(a.number_of_bedrooms),
      bathrooms: parseNum(a.number_of_bathrooms),
      propertyClass: cleanString(a.category_code_description),
      lastSaleDate: a.sale_date ? new Date(a.sale_date).toISOString().slice(0, 10) : null,
      lastSalePrice: parseNum(a.sale_price),
      taxAmount: null,
      buildingLevels: null,
      buildingMaterial: null,
      roofShape: null,
      dataSource: "Philadelphia OPA",
      hasData: !!(a.owner_1 || a.market_value || a.year_built),
    }),
  },

  // Delaware County, PA (FIPS: 42045)
  "42045": {
    url: "https://gis.delcopa.gov/arcgis/rest/services/Parcels/Parcels_Public_Access/FeatureServer/0/query",
    fields: ["PIN", "ADRCAT", "OWNCAT", "TAXYR", "CALCULATED", "CLICKTHROU", "PARID"],
    parse: (a: any) => ({
      ownerName: cleanString(a.OWNCAT),
      mailingAddress: null,
      assessedValue: null,
      marketValue: null,
      landValue: null,
      yearBuilt: null,
      lotSizeSqFt: a.CALCULATED ? Math.round((parseFloat(a.CALCULATED) || 0) * 43560) : null,
      lotSizeAcres: parseFloat(a.CALCULATED) || null,
      buildingSqFt: null,
      bedrooms: null,
      bathrooms: null,
      propertyClass: null,
      lastSaleDate: null,
      lastSalePrice: null,
      taxAmount: null,
      buildingLevels: null,
      buildingMaterial: null,
      roofShape: null,
      dataSource: "Delaware County PA GIS",
      hasData: !!(a.OWNCAT),
    }),
  },

  // Chester County, PA (FIPS: 42029)
  "42029": {
    url: "https://services.arcgis.com/G4S1dGvn7PIgYd6Y/arcgis/rest/services/Parcels_owners/FeatureServer/0/query",
    fields: ["OWN1", "OWN2", "LOC_ADDRESS", "LOT_ASSESS", "PROP_ASSESS", "TOT_ASSESS", "LAST_SALE_PRICE", "TAXYR", "CLASS", "LAND_ACRES", "LUC", "PIN"],
    parse: (a: any) => ({
      ownerName: cleanString(a.OWN1),
      mailingAddress: null,
      assessedValue: parseNum(a.TOT_ASSESS),
      marketValue: null,
      landValue: parseNum(a.LOT_ASSESS),
      yearBuilt: null,
      lotSizeSqFt: a.LAND_ACRES ? Math.round((parseFloat(a.LAND_ACRES) || 0) * 43560) : null,
      lotSizeAcres: parseFloat(a.LAND_ACRES) || null,
      buildingSqFt: null,
      bedrooms: null,
      bathrooms: null,
      propertyClass: classifyUseCode(a.CLASS),
      lastSaleDate: null,
      lastSalePrice: parseNum(a.LAST_SALE_PRICE),
      taxAmount: null,
      buildingLevels: null,
      buildingMaterial: null,
      roofShape: null,
      dataSource: "Chester County PA GIS",
      hasData: !!(a.OWN1 || a.TOT_ASSESS),
    }),
  },

  // Montgomery County, PA (FIPS: 42091)
  "42091": {
    url: "https://mapservices.pasda.psu.edu/server/rest/services/pasda/MontgomeryCounty/MapServer/14/query",
    fields: ["OWN1", "ADDR1", "ADDR3", "TOTAL_ASSE", "ASSESSMENT", "YEAR_BUILT", "SFLA", "LAND_SF", "LAND_ACRES", "SALE_DATE", "CONSIDERAT", "STYLE", "CONDITION", "EXTWALL", "BASEMENT", "LIV_UNITS", "LOCATION1", "MUNI_CODE", "Muni_Name", "LOC_NO", "LOC_STR", "LOC_SUF", "FRONTFT"],
    parse: (a: any) => ({
      ownerName: cleanString(a.OWN1),
      mailingAddress: [cleanString(a.ADDR1), cleanString(a.ADDR3)].filter(Boolean).join(", ") || null,
      assessedValue: parseNum(a.TOTAL_ASSE),
      marketValue: null,
      landValue: null,
      yearBuilt: parseYear(a.YEAR_BUILT),
      lotSizeSqFt: parseNum(a.LAND_SF),
      lotSizeAcres: parseFloat(a.LAND_ACRES) || null,
      buildingSqFt: parseNum(a.SFLA),
      bedrooms: null,
      bathrooms: null,
      propertyClass: null,
      lastSaleDate: cleanString(a.SALE_DATE),
      lastSalePrice: parseNum(a.CONSIDERAT),
      taxAmount: null,
      buildingLevels: null,
      buildingMaterial: null,
      roofShape: null,
      dataSource: "Montgomery County PA (PASDA)",
      hasData: !!(a.OWN1 || a.TOTAL_ASSE || a.YEAR_BUILT),
    }),
  },

  // Bucks County, PA (FIPS: 42017)
  "42017": {
    url: "https://services3.arcgis.com/SP47Tddf7RK32lBU/arcgis/rest/services/Bucks_County_Parcels/FeatureServer/0/query",
    fields: ["PARCEL_NUM", "ADDRESS", "MUNICIPALITY", "OWNER1", "LAND_VALUE", "BUILDING_VALUE", "TOTAL_VALUE", "LAND_USE_CODE"],
    parse: (a: any) => ({
      ownerName: cleanString(a.OWNER1),
      mailingAddress: null,
      assessedValue: parseNum(a.TOTAL_VALUE),
      marketValue: null,
      landValue: parseNum(a.LAND_VALUE),
      yearBuilt: null,
      lotSizeSqFt: null,
      lotSizeAcres: null,
      buildingSqFt: null,
      bedrooms: null,
      bathrooms: null,
      propertyClass: classifyUseCode(a.LAND_USE_CODE),
      lastSaleDate: null,
      lastSalePrice: null,
      taxAmount: null,
      buildingLevels: null,
      buildingMaterial: null,
      roofShape: null,
      dataSource: "Bucks County PA GIS",
      hasData: !!(a.OWNER1 || a.TOTAL_VALUE),
    }),
  },

  // Lancaster County, PA (FIPS: 42071)
  // NOTE: PASDA layer has only ACCOUNT field. Limited public data.
  // URL: https://mapservices.pasda.psu.edu/server/rest/services/pasda/LancasterCounty/MapServer/21/query
  // NO PUBLIC GIS with assessment data (parcels only, no owner/value)

  // York County, PA (FIPS: 42133)
  "42133": {
    url: "https://services1.arcgis.com/2AGLxyiJoNiVHKwq/arcgis/rest/services/Parcels/FeatureServer/0/query",
    fields: ["Owner1", "Owner2", "PropertyAddress", "LandUseDesc", "AprLandVal", "AprBldgVal", "AprTotVal", "TaxTotVal", "FinishedSQFT", "YearBuilt", "GISSizeAC", "DateSold", "SalePrice", "NeighborhoodDesc", "BldgTypeDesc", "ParcelID"],
    parse: (a: any) => ({
      ownerName: cleanString(a.Owner1),
      mailingAddress: null,
      assessedValue: parseNum(a.AprTotVal),
      marketValue: parseNum(a.AprTotVal),
      landValue: parseNum(a.AprLandVal),
      yearBuilt: parseYear(a.YearBuilt),
      lotSizeSqFt: a.GISSizeAC ? Math.round((parseFloat(a.GISSizeAC) || 0) * 43560) : null,
      lotSizeAcres: parseFloat(a.GISSizeAC) || null,
      buildingSqFt: parseNum(a.FinishedSQFT),
      bedrooms: null,
      bathrooms: null,
      propertyClass: classifyUseCode(a.LandUseDesc),
      lastSaleDate: a.DateSold ? new Date(a.DateSold).toISOString().slice(0, 10) : null,
      lastSalePrice: parseNum(a.SalePrice),
      taxAmount: null,
      buildingLevels: null,
      buildingMaterial: null,
      roofShape: null,
      dataSource: "York County PA GIS",
      hasData: !!(a.Owner1 || a.AprTotVal || a.YearBuilt),
    }),
  },

  // Berks County, PA (FIPS: 42011)
  // NOTE: Spatial queries fail. Attribute queries work.
  "42011": {
    url: "https://gis.co.berks.pa.us/arcgis/rest/services/Assess/ParcelSearchTable/MapServer/0/query",
    fields: ["NAME1", "FULLSITEADDRESS", "FULLMAILADDRESS", "VALULNDMKT", "VALUBLDG", "VALUTOTAL", "ACREAGE", "LANDUSE", "DEEDAMOUNT", "DEED_DATE", "MUNICIPALNAME", "CLASS", "PIN", "PROPID"],
    parse: (a: any) => ({
      ownerName: cleanString(a.NAME1),
      mailingAddress: cleanString(a.FULLMAILADDRESS),
      assessedValue: parseNum(a.VALUTOTAL),
      marketValue: parseNum(a.VALULNDMKT),
      landValue: null,
      yearBuilt: null,
      lotSizeSqFt: a.ACREAGE ? Math.round((parseFloat(a.ACREAGE) || 0) * 43560) : null,
      lotSizeAcres: parseFloat(a.ACREAGE) || null,
      buildingSqFt: null,
      bedrooms: null,
      bathrooms: null,
      propertyClass: classifyUseCode(a.CLASS),
      lastSaleDate: a.DEED_DATE ? new Date(a.DEED_DATE).toISOString().slice(0, 10) : null,
      lastSalePrice: parseNum(a.DEEDAMOUNT),
      taxAmount: null,
      buildingLevels: null,
      buildingMaterial: null,
      roofShape: null,
      dataSource: "Berks County PA GIS",
      hasData: !!(a.NAME1 || a.VALUTOTAL),
    }),
  },

  // Cumberland County, PA (FIPS: 42041) — limited fields
  // URL: https://mapservices.pasda.psu.edu/server/rest/services/pasda/CumberlandCounty/MapServer/4/query
  // Fields: COUNTYMILL, COUNTYTAX, MUNIMILL, MUNICIPALT, SCHOOLMILL, SCHOOLTAX, TOTALTAX — no owner/value

  // Dauphin County, PA (FIPS: 42043)
  "42043": {
    url: "https://gis.dauphincounty.org/arcgis/rest/services/Parcels/MapServer/1/query",
    fields: ["PID", "MUNICIPALITY", "property_id", "land", "building", "house_number", "prefix_directional", "street_name", "street_suffix", "acres"],
    parse: (a: any) => ({
      ownerName: null,
      mailingAddress: null,
      assessedValue: (parseNum(a.land) || 0) + (parseNum(a.building) || 0) || null,
      marketValue: null,
      landValue: parseNum(a.land),
      yearBuilt: null,
      lotSizeSqFt: a.acres ? Math.round((parseFloat(a.acres) || 0) * 43560) : null,
      lotSizeAcres: parseFloat(a.acres) || null,
      buildingSqFt: null,
      bedrooms: null,
      bathrooms: null,
      propertyClass: null,
      lastSaleDate: null,
      lastSalePrice: null,
      taxAmount: null,
      buildingLevels: null,
      buildingMaterial: null,
      roofShape: null,
      dataSource: "Dauphin County PA GIS",
      hasData: !!(a.land || a.building),
    }),
  },

  // Lehigh County, PA (FIPS: 42077)
  "42077": {
    url: "https://services1.arcgis.com/XWDNR4PQlDQwrRCL/ArcGIS/rest/services/ATestParcel/FeatureServer/0/query",
    fields: ["NAMOWN", "AD1OWN", "AD2OWN", "ZIPOWN", "TOTASMT", "TAXASMT", "TOTAPR", "ADDRES", "USELAND", "ACREAGE", "SMON", "SYEAR", "SPRICE", "CLASS", "PIN", "DIST"],
    parse: (a: any) => ({
      ownerName: cleanString(a.NAMOWN),
      mailingAddress: [cleanString(a.AD1OWN), cleanString(a.AD2OWN)].filter(Boolean).join(", ") || null,
      assessedValue: parseNum(a.TOTASMT),
      marketValue: parseNum(a.TOTAPR),
      landValue: null,
      yearBuilt: null,
      lotSizeSqFt: null,
      lotSizeAcres: null,
      buildingSqFt: null,
      bedrooms: null,
      bathrooms: null,
      propertyClass: classifyUseCode(a.CLASS),
      lastSaleDate: a.SYEAR && a.SMON ? `${a.SYEAR}-${String(a.SMON).padStart(2, "0")}-01` : null,
      lastSalePrice: parseNum(a.SPRICE),
      taxAmount: null,
      buildingLevels: null,
      buildingMaterial: null,
      roofShape: null,
      dataSource: "Lehigh County PA GIS",
      hasData: !!(a.NAMOWN || a.TOTASMT),
    }),
  },

  // Northampton County, PA (FIPS: 42095)
  "42095": {
    url: "https://services2.arcgis.com/NlbUAihbvA50xxJw/arcgis/rest/services/Northampton_Parcels/FeatureServer/0/query",
    fields: ["OWNER_LN1", "MAIL_ADDR1", "MAIL_ADDR3", "TOT_VALUE", "BLDG_VALUE", "LAND_VALUE", "TOT_ASSMNT", "BLDG_ASSMT", "LAND_ASSMT", "SALE_PRICE", "SALE_DATE", "GLA_SQFT", "YEAR_BUILT", "STORIES", "BDRM_COUNT", "FULL_BATH", "HALF_BATH", "TOT_ROOMS", "LOCATION", "LUC", "ASSMNT_AC"],
    parse: (a: any) => ({
      ownerName: cleanString(a.OWNER_LN1),
      mailingAddress: [cleanString(a.MAIL_ADDR1), cleanString(a.MAIL_ADDR3)].filter(Boolean).join(", ") || null,
      assessedValue: parseNum(a.TOT_VALUE),
      marketValue: null,
      landValue: parseNum(a.LAND_VALUE),
      yearBuilt: parseYear(a.YEAR_BUILT),
      lotSizeSqFt: a.ASSMNT_AC ? Math.round((parseFloat(a.ASSMNT_AC) || 0) * 43560) : null,
      lotSizeAcres: parseFloat(a.ASSMNT_AC) || null,
      buildingSqFt: parseNum(a.GLA_SQFT),
      bedrooms: parseNum(a.BDRM_COUNT),
      bathrooms: (parseNum(a.FULL_BATH) || 0) + (parseNum(a.HALF_BATH) || 0) * 0.5 || null,
      propertyClass: classifyUseCode(a.LUC),
      lastSaleDate: a.SALE_DATE ? new Date(a.SALE_DATE).toISOString().slice(0, 10) : null,
      lastSalePrice: parseNum(a.SALE_PRICE),
      taxAmount: null,
      buildingLevels: parseNum(a.STORIES),
      buildingMaterial: null,
      roofShape: null,
      dataSource: "Northampton County PA GIS",
      hasData: !!(a.OWNER_LN1 || a.TOT_VALUE || a.YEAR_BUILT),
    }),
  },
};

// ============================================================
// Helpers
// ============================================================

function cleanString(val: unknown): string | null {
  if (val === null || val === undefined || val === "") return null;
  const s = String(val).trim();
  return s.length > 0 && s !== "0" && s !== "null" ? s : null;
}

function parseNum(val: unknown): number | null {
  if (val === null || val === undefined || val === "") return null;
  const n = Number(val);
  return isNaN(n) || n <= 0 ? null : Math.round(n);
}

function parseYear(val: unknown): number | null {
  if (val === null || val === undefined) return null;
  // Handle "YYYY" strings and numbers
  const s = String(val).trim();
  const match = s.match(/(\d{4})/);
  if (!match) return null;
  const n = parseInt(match[1]);
  if (n < 1700 || n > new Date().getFullYear()) return null;
  return n;
}

function classifyBuildingType(type: string | null): string | null {
  if (!type || type === "yes") return null;
  const t = type.toLowerCase();
  if (["house", "residential", "detached", "semidetached_house", "terrace", "bungalow"].includes(t))
    return "residential";
  if (["apartments", "dormitory"].includes(t)) return "multi-family";
  if (["commercial", "retail", "office"].includes(t)) return "commercial";
  if (["industrial", "warehouse"].includes(t)) return "industrial";
  if (["garage", "shed", "barn"].includes(t)) return "accessory";
  if (["church", "school", "hospital", "civic"].includes(t)) return "institutional";
  return type;
}

function classifyUseCode(code: unknown): string | null {
  if (!code) return null;
  const s = String(code).toLowerCase();
  if (s.includes("res") || s.startsWith("r") || s === "sfr" || s.includes("single family"))
    return "residential";
  if (s.includes("com") || s.startsWith("c")) return "commercial";
  if (s.includes("ind") || s.startsWith("i")) return "industrial";
  if (s.includes("vac") || s.includes("vacant")) return "vacant";
  if (s.includes("agr") || s.includes("farm")) return "agricultural";
  return cleanString(code);
}

function emptyResult(): PropertyData {
  return {
    ownerName: null,
    mailingAddress: null,
    assessedValue: null,
    marketValue: null,
    landValue: null,
    yearBuilt: null,
    lotSizeSqFt: null,
    lotSizeAcres: null,
    buildingSqFt: null,
    bedrooms: null,
    bathrooms: null,
    propertyClass: null,
    lastSaleDate: null,
    lastSalePrice: null,
    taxAmount: null,
    buildingLevels: null,
    buildingMaterial: null,
    roofShape: null,
    dataSource: "none",
    hasData: false,
  };
}
