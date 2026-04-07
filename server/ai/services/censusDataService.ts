/**
 * US Census ACS Data Service
 * Fetches median household income and demographics by lat/lng.
 * Uses the free Census Geocoder + ACS 5-Year API. No API key required.
 *
 * Flow: lat/lng -> Census geocoder (get FIPS tract) -> ACS API (get income data)
 */

export interface CensusData {
  fipsState: string;
  fipsCounty: string;
  fipsTract: string;
  medianHouseholdIncome: number | null;
  medianHomeValue: number | null;
  ownerOccupiedPct: number | null;
  totalHousingUnits: number | null;
  medianYearBuilt: number | null;
  hasData: boolean;
}

/**
 * Get Census demographics for a lat/lng coordinate.
 * Step 1: Reverse geocode to get FIPS codes (state, county, tract).
 * Step 2: Query ACS 5-Year estimates for that tract.
 */
export async function getCensusData(
  lat: number,
  lng: number
): Promise<CensusData> {
  try {
    // Step 1: Get FIPS codes from Census geocoder
    const fips = await getFipsCodes(lat, lng);
    if (!fips) return emptyResult();

    // Step 2: Query ACS 5-Year data for this tract
    const acsData = await queryACS(fips.state, fips.county, fips.tract);

    return {
      fipsState: fips.state,
      fipsCounty: fips.county,
      fipsTract: fips.tract,
      ...acsData,
      hasData: acsData.medianHouseholdIncome !== null,
    };
  } catch (e) {
    console.warn("Census data fetch failed:", e);
    return emptyResult();
  }
}

interface FipsCodes {
  state: string;
  county: string;
  tract: string;
}

async function getFipsCodes(
  lat: number,
  lng: number
): Promise<FipsCodes | null> {
  // Census TIGERweb geocoder — returns FIPS codes for a point
  const url = `https://geocoding.geo.census.gov/geocoder/geographies/coordinates?x=${lng}&y=${lat}&benchmark=Public_AR_Current&vintage=Current_Current&format=json`;

  const res = await fetch(url, {
    signal: AbortSignal.timeout(10000),
  });

  if (!res.ok) return null;
  const data = await res.json();

  const geographies = data?.result?.geographies;
  if (!geographies) return null;

  // Try Census Tracts first, then Census Block Groups
  const tracts = geographies["Census Tracts"] || geographies["2020 Census Blocks"] || [];
  if (tracts.length === 0) return null;

  const tract = tracts[0];
  return {
    state: tract.STATE || tract.STATEFP,
    county: tract.COUNTY || tract.COUNTYFP,
    tract: tract.TRACT || tract.TRACTCE || "",
  };
}

interface ACSResult {
  medianHouseholdIncome: number | null;
  medianHomeValue: number | null;
  ownerOccupiedPct: number | null;
  totalHousingUnits: number | null;
  medianYearBuilt: number | null;
}

async function queryACS(
  state: string,
  county: string,
  tract: string
): Promise<ACSResult> {
  // ACS 5-Year Subject Estimates — free, no API key needed
  // Variables:
  //   B19013_001E = Median household income
  //   B25077_001E = Median home value (owner-occupied)
  //   B25003_002E = Owner-occupied units
  //   B25003_001E = Total occupied units
  //   B25001_001E = Total housing units
  //   B25035_001E = Median year structure built
  const variables = [
    "B19013_001E", // median household income
    "B25077_001E", // median home value
    "B25003_002E", // owner-occupied count
    "B25003_001E", // total occupied
    "B25001_001E", // total housing units
    "B25035_001E", // median year built
  ].join(",");

  const url = `https://api.census.gov/data/2024/acs/acs5?get=${variables}&for=tract:${tract}&in=state:${state}%20county:${county}`;

  const res = await fetch(url, {
    signal: AbortSignal.timeout(10000),
  });

  if (!res.ok) return emptyACS();
  const data = await res.json();

  // Response: [[header row], [data row]]
  if (!Array.isArray(data) || data.length < 2) return emptyACS();

  const headers = data[0] as string[];
  const values = data[1] as string[];

  const getValue = (varName: string): number | null => {
    const idx = headers.indexOf(varName);
    if (idx === -1) return null;
    const val = parseInt(values[idx]);
    return isNaN(val) || val < 0 ? null : val; // Census uses -666666666 for N/A
  };

  const ownerOccupied = getValue("B25003_002E");
  const totalOccupied = getValue("B25003_001E");
  const ownerPct =
    ownerOccupied !== null && totalOccupied && totalOccupied > 0
      ? Math.round((ownerOccupied / totalOccupied) * 100)
      : null;

  return {
    medianHouseholdIncome: getValue("B19013_001E"),
    medianHomeValue: getValue("B25077_001E"),
    ownerOccupiedPct: ownerPct,
    totalHousingUnits: getValue("B25001_001E"),
    medianYearBuilt: getValue("B25035_001E"),
  };
}

function emptyACS(): ACSResult {
  return {
    medianHouseholdIncome: null,
    medianHomeValue: null,
    ownerOccupiedPct: null,
    totalHousingUnits: null,
    medianYearBuilt: null,
  };
}

function emptyResult(): CensusData {
  return {
    fipsState: "",
    fipsCounty: "",
    fipsTract: "",
    medianHouseholdIncome: null,
    medianHomeValue: null,
    ownerOccupiedPct: null,
    totalHousingUnits: null,
    medianYearBuilt: null,
    hasData: false,
  };
}
