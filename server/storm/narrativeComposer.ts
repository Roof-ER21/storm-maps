/**
 * narrativeComposer — turns raw radar + report numbers into adjuster-readable
 * prose. Mirrors the patterns in Gemini Field Assistant's narrativeService.ts
 * so the two products produce consistent claim language.
 *
 * No fabrication: when there's no meaningful hail or wind, the composer
 * returns a minimal factual statement, never invented severity.
 */

export interface NarrativeInputs {
  /** ET date label, e.g. "April 1, 2026". */
  formattedDate: string;
  /** "Loudoun County, VA" or similar. */
  location: string;
  /** Max hail size at property (inches). 0 → no hail to discuss. */
  maxHailInches: number;
  /** Max wind gust at property (mph). 0 → no wind to discuss. */
  maxWindMph: number;
  /** Total verified events within radius. */
  totalEvents: number;
  /** Search radius in miles. */
  radiusMiles: number;
  /** Closest hail report distance in miles, if any. */
  closestHailMiles?: number;
  /** Largest hail size in radius (inches), regardless of distance. */
  biggestHailInches?: number;
  /** Distance to that biggest hail (miles). */
  biggestHailMiles?: number;
  /** Severe hail event count (≥1.5"). */
  severeHailCount?: number;
}

/**
 * Verisk-aligned size descriptors. Match Gemini Field's narrativeService
 * 1:1 so reps generating reports in either product see the same prose.
 */
function getHailSizeDesc(inches: number): string | null {
  if (inches >= 4.5) return 'softball-sized';
  if (inches >= 4.0) return 'grapefruit-sized';
  if (inches >= 3.0) return 'baseball-sized';
  if (inches >= 2.75) return 'tennis ball-sized';
  if (inches >= 2.5) return 'lime-sized';
  if (inches >= 2.0) return 'hen egg-sized';
  if (inches >= 1.75) return 'golf ball-sized';
  if (inches >= 1.5) return 'ping pong ball-sized';
  if (inches >= 1.25) return 'half dollar-sized';
  if (inches >= 1.0) return 'quarter-sized';
  if (inches >= 0.88) return 'nickel-sized';
  if (inches >= 0.75) return 'penny-sized';
  if (inches >= 0.5) return 'marble-sized';
  if (inches >= 0.25) return 'pea-sized';
  return null;
}

/**
 * Damage potential language graded to hail size. Adjuster-aligned wording
 * (avoids prescriptive "must replace" / "code requires" language that
 * adversarial counsel can flag).
 */
function getHailDamagePotential(inches: number): string {
  if (inches >= 2.0)
    return 'significant damage to roofing materials, siding, gutters, and outdoor equipment';
  if (inches >= 1.5)
    return 'notable damage to asphalt shingles, window screens, and exposed surfaces';
  if (inches >= 1.0)
    return 'potential damage to roof surfaces, especially aged or compromised roofing materials';
  if (inches >= 0.75)
    return 'cosmetic damage to soft metals (gutters, downspouts, vents) and possible impact marks on shingles';
  if (inches >= 0.5)
    return 'observed at the property — typically below the threshold for primary structural damage';
  return 'documented at the property as a trace radar signature';
}

function getWindDamagePotential(mph: number): string {
  if (mph >= 90)
    return 'severe structural damage including roof decking failure, lifted or torn shingles, and tree fall';
  if (mph >= 75)
    return 'significant damage including shingle tear-off, flashing displacement, and downed limbs';
  if (mph >= 60)
    return 'damaging gusts capable of lifting shingles, displacing flashing, and breaking branches';
  if (mph >= 50) return 'gusts strong enough to disturb loose roof components and yard debris';
  return 'measured gusts present at the property';
}

/**
 * Compose the narrative paragraph from inputs. Empty string when neither
 * hail nor wind crossed reportable thresholds — never invents.
 */
export function composeStormNarrative(input: NarrativeInputs): string {
  const {
    formattedDate,
    location,
    maxHailInches,
    maxWindMph,
    totalEvents,
    radiusMiles,
    biggestHailInches,
    biggestHailMiles,
    severeHailCount,
  } = input;

  const hailDesc = getHailSizeDesc(maxHailInches);
  const hasMeaningfulHail = maxHailInches >= 0.25 && hailDesc !== null;
  const hasMeaningfulWind = maxWindMph >= 50;

  let n = '';

  if (hasMeaningfulHail && hasMeaningfulWind) {
    n += `On ${formattedDate}, a severe weather system impacted the ${location} area, producing `;
    n += `${hailDesc} hail measuring up to ${maxHailInches.toFixed(2)}″ in diameter alongside `;
    n += `damaging straight-line winds measured up to ${Math.round(maxWindMph)} mph. `;
    n += `Documented impact includes ${getHailDamagePotential(maxHailInches)}, `;
    n += `as well as ${getWindDamagePotential(maxWindMph)}. `;
  } else if (hasMeaningfulWind) {
    // Lead with wind when hail was sub-threshold — don't tell adjuster
    // "0.00″ hail" if a 60 mph gust is the actual story.
    n += `On ${formattedDate}, a severe weather system impacted the ${location} area, producing `;
    n += `damaging straight-line winds measured up to ${Math.round(maxWindMph)} mph. `;
    n += `${capitalize(getWindDamagePotential(maxWindMph))} was documented in the search area. `;
  } else if (hasMeaningfulHail) {
    n += `On ${formattedDate}, a severe weather system impacted the ${location} area, producing `;
    n += `${hailDesc} hail measuring up to ${maxHailInches.toFixed(2)}″ in diameter. `;
    n += `${capitalize(getHailDamagePotential(maxHailInches))}. `;
  } else {
    n += `On ${formattedDate}, weather activity was documented in the ${location} area within `;
    n += `the ${radiusMiles}-mile search radius. No hail or damaging wind crossed the reportable `;
    n += `threshold at the property coordinate.`;
    return n;
  }

  // Event count + biggest-hail callout (Gemini Field "BIGGEST HAIL" pattern)
  if (totalEvents > 0) {
    n += `A total of ${totalEvents} verified storm event${totalEvents === 1 ? '' : 's'} `;
    n += `${totalEvents === 1 ? 'was' : 'were'} documented within a ${radiusMiles}-mile radius `;
    n += `of the subject property. `;
  }
  if ((severeHailCount ?? 0) > 0) {
    n += `Of these, ${severeHailCount} hail event${severeHailCount === 1 ? '' : 's'} `;
    n += `${severeHailCount === 1 ? 'was' : 'were'} classified as severe (1.5″ or larger). `;
  }
  if (
    biggestHailInches !== undefined &&
    biggestHailInches > maxHailInches &&
    biggestHailMiles !== undefined
  ) {
    const biggestDesc = getHailSizeDesc(biggestHailInches);
    n += `The largest hail recorded in the area was ${biggestDesc ?? `${biggestHailInches.toFixed(2)}″`} `;
    n += `(${biggestHailInches.toFixed(2)}″) at ${biggestHailMiles.toFixed(1)} mi from the property. `;
  }

  return n.trim();
}

function capitalize(s: string): string {
  if (!s) return s;
  return s[0].toUpperCase() + s.slice(1);
}

/**
 * Short callout helpers for the Storm Coverage card — render alongside
 * the per-band table when we have meaningful values.
 */
export function biggestHailCallout(
  inches: number | undefined,
  miles: number | undefined,
): string | null {
  if (inches === undefined || inches <= 0) return null;
  if (miles === undefined) return `BIGGEST HAIL: ${inches.toFixed(2)}″`;
  return `BIGGEST HAIL: ${inches.toFixed(2)}″ at ${miles.toFixed(1)} mi`;
}

export function closestHailCallout(
  inches: number | undefined,
  miles: number | undefined,
): string | null {
  if (inches === undefined || inches <= 0 || miles === undefined) return null;
  return `CLOSEST HAIL: ${inches.toFixed(2)}″ at ${miles === 0 ? 'property' : `${miles.toFixed(1)} mi`}`;
}
