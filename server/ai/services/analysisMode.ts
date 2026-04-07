/**
 * Analysis Mode System
 * Three modes change the AI prompt focus, scoring weights, and output fields.
 */

import type { ClassificationResult } from "./aiClassificationService.js";
import type { SolarBuildingInsights } from "./solarApiService.js";
import type { StormHistory } from "./stormDataService.js";
import type { CensusData } from "./censusDataService.js";
import type { FemaData } from "./femaDataService.js";
import type { PropertyData } from "./propertyDataService.js";

export type AnalysisMode = "retail" | "insurance" | "solar";

// ============================================================
// MODE-SPECIFIC PROMPT ADDITIONS
// Appended to the base classification prompt
// ============================================================

export const MODE_PROMPTS: Record<AnalysisMode, string> = {
  retail: `
RETAIL MODE — You are helping a roofing sales rep identify upgrade opportunities.
Focus extra attention on:
- 3-tab shingles are PRIME upgrade targets to architectural
- Aluminum siding is a cross-sell to vinyl or fiber cement
- Aging materials (15+ years) even in "fair" condition = sales opportunity
- Curb appeal assessment — would a new roof visibly improve the home?
- Note any mismatched materials (e.g., newer roof with old siding = siding sale)

Add to your JSON response:
"retailInsights": {
  "upgradeOpportunity": "<what specific upgrade would benefit this home>",
  "crossSellPotential": "<siding, gutters, windows, paint — what else needs work?>",
  "curbAppealScore": <1-10 how much would a new roof improve the look>,
  "talkingPoints": ["<3 specific things the rep can mention at the door>"]
}`,

  insurance: `
INSURANCE MODE — You are helping an insurance restoration rep identify claim opportunities.
Focus extra attention on:
- DAMAGE DETECTION is your #1 priority. Look for:
  * Hail damage: circular dents/dimples on shingles, gutters, AC condenser, siding
  * Wind damage: lifted/creased shingles, missing shingles, exposed underlayment
  * Impact damage: cracked/broken shingles, dented flashing, damaged ridge caps
  * Water damage: dark staining, sagging, moss/algae growth patterns
- COMMONLY MISSED supplement items:
  * Gutters and downspouts (dents, misalignment, pulled away from fascia)
  * Window screens (torn, bent frames)
  * Fence damage (leaning, broken boards, dented metal)
  * Paint damage on fascia, soffits, window trim
  * AC condenser unit damage (dented fins, bent housing)
  * Garage door dents
  * Chimney cap/flashing damage
- Roof TYPE matters for insurance: aluminum siding + 3-tab shingle = full exterior claim potential
- Note if materials are discontinued or no longer code-compliant (3-tab banned in some jurisdictions)

Add to your JSON response:
"insuranceInsights": {
  "claimPotential": "none|low|moderate|high|excellent",
  "visibleDamageTypes": ["<specific damage types visible>"],
  "supplementItems": ["<commonly missed items that may also be damaged>"],
  "materialObsolescence": "<is the current material discontinued or non-code-compliant?>",
  "fullExteriorClaim": <true if roof + siding + gutters all show damage>,
  "adjusterNotes": "<what to point out to the adjuster during inspection>"
}`,

  solar: `
SOLAR MODE — You are helping a solar sales rep identify ideal candidates.
Focus extra attention on:
- Roof ORIENTATION: south-facing slopes are ideal (azimuth 135-225 degrees)
- Roof PITCH: 15-40 degrees is optimal for solar panels
- Roof AREA: larger unobstructed areas = more panels
- SHADE: note any tall trees, neighboring buildings, or structures casting shadows
- MATERIAL COMPATIBILITY: metal standing seam is best (clamp mount), then asphalt shingle (penetrating mount), tile is difficult
- Roof AGE: if roof needs replacement soon, recommend solar + re-roof bundle
- CONDITION: panels shouldn't go on a roof that needs replacement within 5 years

Add to your JSON response:
"solarInsights": {
  "solarCandidate": "poor|fair|good|excellent",
  "bestRoofFace": "<which direction the best roof face points>",
  "shadeObstruction": "none|minimal|moderate|heavy",
  "materialCompatibility": "excellent|good|fair|poor",
  "reroofFirst": <true if roof should be replaced before installing panels>,
  "estimatedPanelCount": <rough estimate based on visible unobstructed area>,
  "talkingPoints": ["<3 things the solar rep can mention at the door>"]
}`,
};

// ============================================================
// MODE-SPECIFIC SCORING
// ============================================================

export function computeProspectScore(
  classification: ClassificationResult,
  mode: AnalysisMode,
  solarInsights?: SolarBuildingInsights | null,
  stormHistory?: StormHistory | null,
  censusData?: CensusData | null,
  femaData?: FemaData | null,
  propertyData?: PropertyData | null
): { score: number; isHighPriority: boolean } {
  let score = 0;

  if (mode === "retail") {
    // Retail: upgrade opportunity focus
    if (classification.roofType === "three_tab_shingle") score += 25;
    if (classification.roofAgeEstimate >= 20) score += 30;
    else if (classification.roofAgeEstimate >= 15) score += 20;
    else if (classification.roofAgeEstimate >= 10) score += 10;
    if (
      classification.roofCondition === "poor" ||
      classification.roofCondition === "critical"
    )
      score += 25;
    else if (classification.roofCondition === "fair") score += 15;
    if (classification.isAluminumSiding) score += 20;
    score += Math.min(classification.damageIndicators.length * 5, 20);
    if (classification.roofConfidence < 0.5) score -= 15;
    // Income boost — higher income = more likely to pay for premium upgrade
    if (censusData?.medianHouseholdIncome) {
      if (censusData.medianHouseholdIncome >= 100000) score += 10;
      else if (censusData.medianHouseholdIncome >= 75000) score += 5;
    }
    // Property value — higher value homes = bigger jobs
    if (propertyData?.marketValue && propertyData.marketValue >= 400000) score += 5;
    // Year built from records — confirms roof age if old
    if (propertyData?.yearBuilt) {
      const buildingAge = new Date().getFullYear() - propertyData.yearBuilt;
      if (buildingAge >= 25 && classification.roofAgeEstimate < 15) {
        // Old house but AI says newer roof — might have been replaced, lower score
      } else if (buildingAge >= 20) {
        score += 5; // old house, original roof more likely
      }
    }
  } else if (mode === "insurance") {
    // Insurance: damage + claim potential focus
    // Damage is king
    const damageCount = classification.damageIndicators.length;
    score += Math.min(damageCount * 10, 40);
    // Severe damage bonus
    const severeCount = classification.damageIndicators.filter(
      (d) => d.severity === "severe"
    ).length;
    score += severeCount * 10;
    // Age beyond warranty
    if (classification.roofAgeEstimate >= 25) score += 15;
    else if (classification.roofAgeEstimate >= 20) score += 10;
    // Condition
    if (classification.roofCondition === "critical") score += 15;
    else if (classification.roofCondition === "poor") score += 10;
    // Material factors for insurance
    if (classification.roofType === "three_tab_shingle") score += 5; // easier to total
    if (classification.isAluminumSiding) score += 10; // full exterior claim
    // Storm history bonus
    if (stormHistory?.qualifyingEvent) score += 20;
    else if (stormHistory?.hasRecentHail) score += 10;
    // FEMA disaster declaration — major boost for insurance claims
    if (femaData?.hasDisasterData && femaData.recentDisasters.length > 0) {
      const stormDisasters = femaData.recentDisasters.filter(
        (d) =>
          d.incidentType.toLowerCase().includes("storm") ||
          d.incidentType.toLowerCase().includes("hurricane") ||
          d.incidentType.toLowerCase().includes("tornado")
      );
      if (stormDisasters.length > 0) score += 15;
      else score += 5;
    }
    // Flood zone — additional claim angle
    if (femaData?.floodZone?.isHighRisk) score += 5;
    if (classification.roofConfidence < 0.5) score -= 10;
  } else if (mode === "solar") {
    // Solar: ideal candidate focus
    if (solarInsights?.hasData) {
      // Pitch scoring (15-40 degrees ideal)
      const pitch = solarInsights.avgPitchDegrees;
      if (pitch >= 15 && pitch <= 40) score += 20;
      else if (pitch >= 10 && pitch <= 45) score += 10;
      else if (pitch < 5) score -= 10; // flat roof harder for solar

      // Area scoring
      const sqft = solarInsights.totalRoofAreaMeters2 * 10.764;
      if (sqft >= 2000) score += 20;
      else if (sqft >= 1500) score += 15;
      else if (sqft >= 1000) score += 10;

      // South-facing segments
      const southFacing = solarInsights.roofSegments.filter((s) => {
        const az = s.azimuthDegrees;
        return az >= 135 && az <= 225;
      });
      if (southFacing.length > 0) score += 20;

      // Segment count (simpler roofs are better for solar)
      if (solarInsights.segmentCount <= 4) score += 10;
      else if (solarInsights.segmentCount <= 8) score += 5;
    }
    // Material compatibility
    if (classification.roofType === "metal_standing_seam") score += 15;
    else if (
      classification.roofType === "architectural_shingle" ||
      classification.roofType === "three_tab_shingle"
    )
      score += 10;
    else if (
      classification.roofType === "tile_clay" ||
      classification.roofType === "tile_concrete"
    )
      score -= 5;
    // Roof condition (don't put solar on a dying roof)
    if (
      classification.roofCondition === "excellent" ||
      classification.roofCondition === "good"
    )
      score += 15;
    else if (classification.roofCondition === "fair") score += 5;
    else if (
      classification.roofCondition === "poor" ||
      classification.roofCondition === "critical"
    )
      score -= 10; // needs re-roof first
    // Income boost for solar — higher income = more likely to invest
    if (censusData?.medianHouseholdIncome) {
      if (censusData.medianHouseholdIncome >= 100000) score += 10;
      else if (censusData.medianHouseholdIncome >= 75000) score += 5;
    }
    // Owner-occupied — renters won't buy solar
    if (censusData?.ownerOccupiedPct && censusData.ownerOccupiedPct >= 70) score += 5;
    if (classification.roofConfidence < 0.5) score -= 10;
  }

  score = Math.max(0, Math.min(100, score));
  const threshold = mode === "insurance" ? 50 : 60;
  return { score, isHighPriority: score >= threshold };
}

// ============================================================
// SOLAR ESTIMATION (from Google Solar API data)
// ============================================================

export interface SolarEstimate {
  panelCount: number;
  systemSizeKw: number;
  annualKwh: number;
  annualSavings: number;
  systemCost: number;
  paybackYears: number;
  co2OffsetTons: number;
}

// State-level electricity rates ($/kWh, 2026 residential average)
// Source: EIA data — updated annually
const ELECTRICITY_RATES: Record<string, number> = {
  // DMV
  DC: 0.17, MD: 0.16, VA: 0.14,
  // PA
  PA: 0.18,
  // Northeast (expensive — good for solar ROI)
  CT: 0.28, MA: 0.26, NH: 0.24, RI: 0.25, NY: 0.22, NJ: 0.18, ME: 0.22, VT: 0.21,
  DE: 0.15, WV: 0.13,
  // Southeast
  NC: 0.12, SC: 0.14, GA: 0.13, FL: 0.14, AL: 0.14, TN: 0.12, KY: 0.12,
  // Midwest
  OH: 0.14, IN: 0.15, IL: 0.15, MI: 0.18, WI: 0.16, MN: 0.14,
  // South/West
  TX: 0.13, AZ: 0.13, NM: 0.14, CO: 0.14, NV: 0.13, CA: 0.30, OR: 0.12, WA: 0.11,
  HI: 0.38,
};

// State-level solar production (kWh per kW installed per year)
// Varies by sun hours — southern states produce more
const SOLAR_PRODUCTION: Record<string, number> = {
  DC: 1350, MD: 1350, VA: 1400, PA: 1250,
  CT: 1250, MA: 1250, NY: 1200, NJ: 1300, DE: 1350,
  NC: 1500, SC: 1500, GA: 1550, FL: 1600, TX: 1600,
  AZ: 1800, NM: 1750, CA: 1650, NV: 1750, CO: 1600,
  OH: 1200, IL: 1300, MI: 1150, WI: 1200,
  HI: 1650, WA: 1050, OR: 1100,
};

export function computeSolarEstimate(
  solarInsights: SolarBuildingInsights,
  stateAbbrev?: string
): SolarEstimate | null {
  if (!solarInsights.hasData) return null;

  const state = (stateAbbrev || "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 2);

  // Average residential panel: 400W, ~18 sqft
  const panelSqFt = 18;
  const panelWatts = 400;
  const usableAreaPct = 0.6;
  const totalSqFt = solarInsights.totalRoofAreaMeters2 * 10.764;
  const usableSqFt = totalSqFt * usableAreaPct;

  // Only count south/east/west facing segments (not north)
  const goodSegments = solarInsights.roofSegments.filter((s) => {
    const az = s.azimuthDegrees;
    return az >= 90 && az <= 270;
  });
  const goodAreaPct =
    solarInsights.roofSegments.length > 0
      ? goodSegments.reduce((sum, s) => sum + s.areaMeters2, 0) /
        solarInsights.totalRoofAreaMeters2
      : 0.5;

  const effectiveArea = usableSqFt * goodAreaPct;
  const panelCount = Math.floor(effectiveArea / panelSqFt);

  if (panelCount < 4) return null;

  const systemSizeKw = (panelCount * panelWatts) / 1000;

  // Regional solar production
  const kwhPerKw = SOLAR_PRODUCTION[state] || 1400;
  const annualKwh = Math.round(systemSizeKw * kwhPerKw);

  // Regional electricity rate
  const rate = ELECTRICITY_RATES[state] || 0.16;
  const annualSavings = Math.round(annualKwh * rate);

  // System cost: ~$2.75/W installed, 30% federal ITC
  const systemCost = Math.round(systemSizeKw * 1000 * 2.75 * 0.7);
  const paybackYears =
    annualSavings > 0 ? Math.round((systemCost / annualSavings) * 10) / 10 : 0;

  // CO2: ~0.855 lbs CO2 per kWh avoided
  const co2OffsetTons = Math.round((annualKwh * 0.855) / 2000 * 10) / 10;

  return {
    panelCount,
    systemSizeKw: Math.round(systemSizeKw * 10) / 10,
    annualKwh,
    annualSavings,
    systemCost,
    paybackYears,
    co2OffsetTons,
  };
}
