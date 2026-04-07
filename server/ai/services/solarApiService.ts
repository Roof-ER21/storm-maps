/**
 * Google Solar API Service
 * Returns real measured roof geometry data (pitch, azimuth, area, segments)
 * This is LiDAR-measured data, not AI guessing.
 */

export interface RoofSegment {
  pitchDegrees: number;
  azimuthDegrees: number;
  areaMeters2: number;
  center: { latitude: number; longitude: number };
}

export interface SolarBuildingInsights {
  roofSegments: RoofSegment[];
  totalRoofAreaMeters2: number;
  maxPitchDegrees: number;
  avgPitchDegrees: number;
  roofType: "flat" | "low_slope" | "moderate_slope" | "steep_slope";
  segmentCount: number;
  hasData: boolean;
}

export async function getBuildingInsights(
  lat: number,
  lng: number,
  apiKey: string
): Promise<SolarBuildingInsights> {
  const url = new URL(
    "https://solar.googleapis.com/v1/buildingInsights:findClosest"
  );
  url.searchParams.set("location.latitude", String(lat));
  url.searchParams.set("location.longitude", String(lng));
  url.searchParams.set("requiredQuality", "MEDIUM");
  url.searchParams.set("key", apiKey);

  try {
    const res = await fetch(url.toString(), {
      headers: { Referer: "https://localhost:5180" },
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      return emptyInsights();
    }

    const data = await res.json();
    const segments: RoofSegment[] = [];
    let totalArea = 0;
    let maxPitch = 0;
    let pitchSum = 0;

    const roofSegmentStats =
      data.solarPotential?.roofSegmentStats || [];

    for (const seg of roofSegmentStats) {
      const pitch = seg.pitchDegrees || 0;
      const azimuth = seg.azimuthDegrees || 0;
      const area = seg.stats?.areaMeters2 || seg.areaMeters2 || 0;

      segments.push({
        pitchDegrees: pitch,
        azimuthDegrees: azimuth,
        areaMeters2: area,
        center: seg.center || { latitude: lat, longitude: lng },
      });

      totalArea += area;
      if (pitch > maxPitch) maxPitch = pitch;
      pitchSum += pitch;
    }

    const avgPitch =
      segments.length > 0 ? pitchSum / segments.length : 0;

    // Classify slope type from measured pitch
    let roofType: SolarBuildingInsights["roofType"];
    if (avgPitch < 5) roofType = "flat";
    else if (avgPitch < 15) roofType = "low_slope";
    else if (avgPitch < 35) roofType = "moderate_slope";
    else roofType = "steep_slope";

    // Also try to get total area from wholeRoofStats
    const wholeRoofArea =
      data.solarPotential?.wholeRoofStats?.areaMeters2 || totalArea;

    return {
      roofSegments: segments,
      totalRoofAreaMeters2: wholeRoofArea || totalArea,
      maxPitchDegrees: maxPitch,
      avgPitchDegrees: Math.round(avgPitch * 10) / 10,
      roofType,
      segmentCount: segments.length,
      hasData: segments.length > 0,
    };
  } catch {
    return emptyInsights();
  }
}

function emptyInsights(): SolarBuildingInsights {
  return {
    roofSegments: [],
    totalRoofAreaMeters2: 0,
    maxPitchDegrees: 0,
    avgPitchDegrees: 0,
    roofType: "moderate_slope",
    segmentCount: 0,
    hasData: false,
  };
}

/** Convert degrees to standard roofing pitch (rise per 12" run) */
export function degreesToPitch(degrees: number): string {
  const rise = 12 * Math.tan((degrees * Math.PI) / 180);
  const rounded = Math.round(rise * 10) / 10;
  // Show as whole number if close enough (e.g., 6.0 → "6/12")
  const display = Math.abs(rounded - Math.round(rounded)) < 0.15
    ? Math.round(rounded)
    : rounded;
  return `${display}/12`;
}

/** Convert roof area from m2 to roofing squares (1 square = 100 sq ft) */
export function areaToSquares(areaMeters2: number): number {
  const sqFt = areaMeters2 * 10.764;
  return Math.round((sqFt / 100) * 10) / 10;
}

/** Detailed replacement cost estimate with line items */
export interface ReplacementCostEstimate {
  low: number;
  high: number;
  // Line items for transparency
  breakdown: {
    materialPerSqFt: { low: number; high: number };
    laborPerSqFt: { low: number; high: number };
    tearOffPerSqFt: number;
    dumpFeePerSquare: number;
    wasteFactor: number; // multiplier, e.g., 1.12 = 12% waste
    pitchMultiplier: number; // 1.0 = walkable, up to 1.35 = very steep
    regionMultiplier: number;
    roofSquares: number;
    totalSqFt: number;
  };
  // Sub-totals
  materialCost: { low: number; high: number };
  laborCost: { low: number; high: number };
  tearOffCost: number;
  dumpFees: number;
  // Per-square for easy quoting
  perSquare: { low: number; high: number };
}

/**
 * Estimate replacement cost with regional rates, pitch factor, tear-off, and waste.
 *
 * @param areaMeters2 - From Google Solar API LiDAR measurement
 * @param roofType - AI-classified material
 * @param avgPitchDegrees - From Solar API (affects labor difficulty)
 * @param segmentCount - From Solar API (complexity = more waste)
 * @param stateAbbrev - For regional pricing (e.g., "MD", "VA", "PA")
 */
export function estimateReplacementCost(
  areaMeters2: number,
  roofType: string,
  avgPitchDegrees?: number,
  segmentCount?: number,
  stateAbbrev?: string
): ReplacementCostEstimate | null {
  if (!areaMeters2 || areaMeters2 < 50) return null;

  const totalSqFt = areaMeters2 * 10.764;
  const roofSquares = Math.round((totalSqFt / 100) * 10) / 10;

  // ============================================================
  // 1. Material cost per sqft (just material, not installed)
  // ============================================================
  // 2026 prices — material only, before labor
  const materialRates: Record<string, { low: number; high: number }> = {
    three_tab_shingle:      { low: 1.00, high: 1.50 },
    architectural_shingle:  { low: 1.30, high: 2.20 },
    designer_shingle:       { low: 2.50, high: 5.00 },
    metal_standing_seam:    { low: 3.50, high: 7.00 },
    metal_ribbed:           { low: 2.00, high: 3.50 },
    tile_clay:              { low: 4.00, high: 10.00 },
    tile_concrete:          { low: 3.00, high: 6.00 },
    slate:                  { low: 8.00, high: 18.00 },
    wood_shake:             { low: 2.50, high: 5.00 },
    flat_membrane:          { low: 1.50, high: 3.50 },
  };

  // ============================================================
  // 2. Labor cost per sqft
  // ============================================================
  const laborRates: Record<string, { low: number; high: number }> = {
    three_tab_shingle:      { low: 1.75, high: 2.75 },
    architectural_shingle:  { low: 2.00, high: 3.25 },
    designer_shingle:       { low: 3.00, high: 5.00 },
    metal_standing_seam:    { low: 3.50, high: 6.00 },
    metal_ribbed:           { low: 2.50, high: 4.00 },
    tile_clay:              { low: 4.00, high: 8.00 },
    tile_concrete:          { low: 3.50, high: 6.00 },
    slate:                  { low: 6.00, high: 12.00 },
    wood_shake:             { low: 3.00, high: 5.00 },
    flat_membrane:          { low: 2.00, high: 3.50 },
  };

  const material = materialRates[roofType] || { low: 1.30, high: 2.20 };
  const labor = laborRates[roofType] || { low: 2.00, high: 3.25 };

  // ============================================================
  // 3. Tear-off cost (removing old roof)
  // ============================================================
  const tearOffPerSqFt = roofType.includes("tile") || roofType === "slate" ? 2.00 : 1.25;

  // ============================================================
  // 4. Dumpster / dump fees per square (100 sqft)
  // ============================================================
  const dumpFeePerSquare = 25; // ~$25/square for disposal

  // ============================================================
  // 5. Waste factor (material overage for cuts, ridges, hips, valleys)
  // ============================================================
  const segments = segmentCount || 4;
  let wasteFactor: number;
  if (segments <= 2) wasteFactor = 1.08;       // simple gable — 8% waste
  else if (segments <= 4) wasteFactor = 1.12;   // standard hip/gable — 12%
  else if (segments <= 8) wasteFactor = 1.15;   // complex — 15%
  else wasteFactor = 1.20;                       // very complex — 20%

  // ============================================================
  // 6. Pitch multiplier (steeper = harder to work on = more labor cost)
  // ============================================================
  const pitch = avgPitchDegrees || 20;
  let pitchMultiplier: number;
  if (pitch < 15) pitchMultiplier = 1.0;         // walkable (low slope)
  else if (pitch < 25) pitchMultiplier = 1.0;     // standard — no surcharge
  else if (pitch < 35) pitchMultiplier = 1.10;    // steep — 10% labor premium
  else if (pitch < 45) pitchMultiplier = 1.20;    // very steep — 20% premium
  else pitchMultiplier = 1.35;                     // extreme — 35% premium (harnesses required)

  // ============================================================
  // 7. Regional cost multiplier (DMV/PA market rates vs national avg)
  // ============================================================
  const regionMultipliers: Record<string, number> = {
    // DMV area — higher cost of living + labor
    "DC": 1.25, "MD": 1.15, "VA": 1.10,
    // PA — varies, slightly above average
    "PA": 1.08,
    // Northeast
    "NJ": 1.20, "NY": 1.25, "CT": 1.20, "MA": 1.18,
    "DE": 1.10, "WV": 0.95,
    // Southeast — slightly below average
    "NC": 0.95, "SC": 0.92, "GA": 0.95, "FL": 1.05,
    // Midwest
    "OH": 0.95, "IN": 0.92, "IL": 1.05,
    // South
    "TX": 0.95, "TN": 0.92, "AL": 0.90,
  };
  const state = (stateAbbrev || "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 2);
  const regionMultiplier = regionMultipliers[state] || 1.0;

  // ============================================================
  // Calculate totals
  // ============================================================
  const effectiveSqFt = totalSqFt * wasteFactor;

  const materialCost = {
    low: Math.round(effectiveSqFt * material.low * regionMultiplier),
    high: Math.round(effectiveSqFt * material.high * regionMultiplier),
  };
  const laborCost = {
    low: Math.round(effectiveSqFt * labor.low * pitchMultiplier * regionMultiplier),
    high: Math.round(effectiveSqFt * labor.high * pitchMultiplier * regionMultiplier),
  };
  const tearOffCost = Math.round(totalSqFt * tearOffPerSqFt);
  const dumpFees = Math.round(roofSquares * dumpFeePerSquare);

  const totalLow = materialCost.low + laborCost.low + tearOffCost + dumpFees;
  const totalHigh = materialCost.high + laborCost.high + tearOffCost + dumpFees;

  // Round to nearest $100
  const low = Math.round(totalLow / 100) * 100;
  const high = Math.round(totalHigh / 100) * 100;

  return {
    low,
    high,
    breakdown: {
      materialPerSqFt: material,
      laborPerSqFt: labor,
      tearOffPerSqFt,
      dumpFeePerSquare,
      wasteFactor,
      pitchMultiplier,
      regionMultiplier,
      roofSquares,
      totalSqFt: Math.round(totalSqFt),
    },
    materialCost,
    laborCost,
    tearOffCost,
    dumpFees,
    perSquare: {
      low: roofSquares > 0 ? Math.round(low / roofSquares) : 0,
      high: roofSquares > 0 ? Math.round(high / roofSquares) : 0,
    },
  };
}
