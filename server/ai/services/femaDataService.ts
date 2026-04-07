/**
 * FEMA Data Service
 * Fetches flood zone data and recent disaster declarations.
 * All endpoints are free with no API key required.
 *
 * APIs used:
 * - FEMA NFHL (National Flood Hazard Layer) via ArcGIS REST
 * - FEMA Disaster Declarations API (OpenFEMA)
 */

export interface FloodZoneInfo {
  zone: string; // e.g., "A", "AE", "X", "VE"
  zoneLabel: string; // human-readable
  isHighRisk: boolean; // zones A, AE, AH, AO, V, VE
  isModerateRisk: boolean; // zone B, X (shaded)
  panelNumber: string | null;
}

export interface DisasterDeclaration {
  disasterNumber: number;
  declarationDate: string;
  declarationTitle: string;
  incidentType: string; // "Severe Storm(s)", "Hurricane", "Tornado", etc.
  state: string;
  designatedArea: string; // county name
}

export interface FemaData {
  floodZone: FloodZoneInfo | null;
  recentDisasters: DisasterDeclaration[];
  hasFloodData: boolean;
  hasDisasterData: boolean;
  disasterSummary: string;
}

/**
 * Get FEMA flood zone + disaster declarations for a location.
 */
export async function getFemaData(
  lat: number,
  lng: number,
  stateAbbrev?: string,
  countyName?: string
): Promise<FemaData> {
  const [floodZone, disasters] = await Promise.all([
    getFloodZone(lat, lng).catch(() => null),
    getRecentDisasters(lat, lng, stateAbbrev, countyName).catch(() => []),
  ]);

  const summaryParts: string[] = [];
  if (floodZone) {
    summaryParts.push(
      `Flood zone: ${floodZone.zone} (${floodZone.zoneLabel})`
    );
    if (floodZone.isHighRisk) {
      summaryParts.push("HIGH FLOOD RISK area");
    }
  }
  if (disasters.length > 0) {
    summaryParts.push(
      `${disasters.length} FEMA disaster declaration(s) in last 5 years`
    );
    const stormDisasters = disasters.filter(
      (d) =>
        d.incidentType.toLowerCase().includes("storm") ||
        d.incidentType.toLowerCase().includes("tornado") ||
        d.incidentType.toLowerCase().includes("hurricane")
    );
    if (stormDisasters.length > 0) {
      summaryParts.push(
        `Most recent: ${stormDisasters[0].declarationTitle} (${stormDisasters[0].declarationDate})`
      );
    }
  }

  return {
    floodZone,
    recentDisasters: disasters.slice(0, 10),
    hasFloodData: floodZone !== null,
    hasDisasterData: disasters.length > 0,
    disasterSummary:
      summaryParts.length > 0
        ? summaryParts.join(". ")
        : "No FEMA data found for this location",
  };
}

/**
 * Query FEMA National Flood Hazard Layer (NFHL) via Esri ArcGIS REST.
 * This is the same data that backs FEMA's flood map viewer.
 */
async function getFloodZone(
  lat: number,
  lng: number
): Promise<FloodZoneInfo | null> {
  // FEMA FIRMette NFHL service — Layer 20 = Flood Hazard Zones
  const url = new URL(
    "https://hazards.fema.gov/arcgis/rest/services/FIRMette/NFHLREST_FIRMette/MapServer/20/query"
  );
  url.searchParams.set("geometry", `${lng},${lat}`);
  url.searchParams.set("geometryType", "esriGeometryPoint");
  url.searchParams.set("inSR", "4326");
  url.searchParams.set("spatialRel", "esriSpatialRelIntersects");
  url.searchParams.set("outFields", "FLD_ZONE,ZONE_SUBTY,SFHA_TF");
  url.searchParams.set("returnGeometry", "false");
  url.searchParams.set("f", "json");

  const res = await fetch(url.toString(), {
    signal: AbortSignal.timeout(10000),
  });

  if (!res.ok) return null;
  const data = await res.json();

  const features = data?.features;
  if (!features || features.length === 0) return null;

  const attrs = features[0].attributes;
  const zone = attrs.FLD_ZONE || "X";
  const isSFHA = attrs.SFHA_TF === "T"; // Special Flood Hazard Area

  const highRiskZones = ["A", "AE", "AH", "AO", "AR", "A99", "V", "VE"];
  const isHighRisk = highRiskZones.includes(zone) || isSFHA;
  const isModerateRisk = zone === "B" || zone === "X SHADED" || attrs.ZONE_SUBTY === "0.2 PCT ANNUAL CHANCE FLOOD HAZARD";

  return {
    zone,
    zoneLabel: FLOOD_ZONE_LABELS[zone] || `Zone ${zone}`,
    isHighRisk,
    isModerateRisk,
    panelNumber: attrs.DFIRM_ID || null,
  };
}

const FLOOD_ZONE_LABELS: Record<string, string> = {
  A: "High Risk (100-year flood)",
  AE: "High Risk (100-year, base elevations)",
  AH: "High Risk (shallow flooding)",
  AO: "High Risk (sheet flow)",
  AR: "High Risk (levee restoration)",
  A99: "High Risk (federal flood protection)",
  V: "High Risk Coastal (wave action)",
  VE: "High Risk Coastal (base elevations)",
  B: "Moderate Risk (500-year flood)",
  C: "Low Risk (minimal flood hazard)",
  X: "Low Risk (minimal flood hazard)",
  D: "Undetermined Risk",
};

/**
 * Query OpenFEMA Disaster Declarations API.
 * Gets recent disaster declarations for the state/county.
 */
async function getRecentDisasters(
  lat: number,
  lng: number,
  stateAbbrev?: string,
  countyName?: string
): Promise<DisasterDeclaration[]> {
  // Need state at minimum — if not provided, try FCC API to get state FIPS
  let state = stateAbbrev;
  let county = countyName;

  if (!state) {
    const fccData = await getFccBlockData(lat, lng);
    state = fccData?.stateCode || undefined;
    county = county || fccData?.countyName || undefined;
  }

  if (!state) return [];

  // OpenFEMA API — free, no key
  const fiveYearsAgo = new Date();
  fiveYearsAgo.setFullYear(fiveYearsAgo.getFullYear() - 5);
  const dateFilter = fiveYearsAgo.toISOString().split("T")[0];

  let filter = `state eq '${state}' and declarationDate gt '${dateFilter}'`;
  // Only filter by county if the incident types are weather-related
  // County names in FEMA data include " (County)" suffix sometimes

  const url = `https://www.fema.gov/api/open/v2/DisasterDeclarationsSummaries?$filter=${encodeURIComponent(filter)}&$orderby=declarationDate desc&$top=20&$select=disasterNumber,declarationDate,declarationTitle,incidentType,state,designatedArea`;

  const res = await fetch(url, {
    signal: AbortSignal.timeout(10000),
    headers: { Accept: "application/json" },
  });

  if (!res.ok) return [];
  const data = await res.json();

  const declarations: DisasterDeclaration[] = [];

  for (const item of data?.DisasterDeclarationsSummaries || []) {
    // If we have county name, filter to matching county
    if (county) {
      const designatedArea = (item.designatedArea || "").toLowerCase();
      const countyLower = county.toLowerCase().replace(" county", "");
      if (
        !designatedArea.includes(countyLower) &&
        !designatedArea.includes("statewide")
      ) {
        continue;
      }
    }

    declarations.push({
      disasterNumber: item.disasterNumber,
      declarationDate: (item.declarationDate || "").split("T")[0],
      declarationTitle: item.declarationTitle || "",
      incidentType: item.incidentType || "",
      state: item.state || "",
      designatedArea: item.designatedArea || "",
    });
  }

  return declarations;
}

/**
 * FCC Area API — get state/county from lat/lng (free, no key).
 */
async function getFccBlockData(
  lat: number,
  lng: number
): Promise<{ stateCode: string; countyName: string } | null> {
  const url = `https://geo.fcc.gov/api/census/area?lat=${lat}&lon=${lng}&format=json`;

  const res = await fetch(url, {
    signal: AbortSignal.timeout(8000),
  });

  if (!res.ok) return null;
  const data = await res.json();

  const result = data?.results?.[0];
  if (!result) return null;

  return {
    stateCode: result.state_code || "",
    countyName: result.county_name || "",
  };
}
