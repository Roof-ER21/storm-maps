export interface NearbyBuilding {
  lat: number;
  lng: number;
  address: string | null;
  houseNumber: string | null;
  street: string | null;
  osmId: string;
}

/**
 * Find nearby buildings. Tries Overpass API first (real building data),
 * then falls back to a residential grid pattern for areas where OSM
 * doesn't have individual building data.
 */
export async function findNearbyBuildings(
  lat: number,
  lng: number,
  radiusMeters: number = 200,
  limit: number = 25
): Promise<NearbyBuilding[]> {
  // Try Overpass first
  const overpassBuildings = await findViaOverpass(lat, lng, radiusMeters, limit);
  if (overpassBuildings.length >= 5) return overpassBuildings;

  // Fallback: query Overpass for ANY buildings (even without addresses)
  const anyBuildings = await findAnyBuildingsViaOverpass(lat, lng, radiusMeters, limit);
  if (anyBuildings.length >= 5) return anyBuildings;

  // Final fallback: generate a residential grid
  // Typical US residential lot is ~15m wide, ~30m deep
  // Houses are spaced ~20-25m apart along a street
  return generateResidentialGrid(lat, lng, radiusMeters, limit);
}

/** Query Overpass for buildings WITH addresses */
async function findViaOverpass(
  lat: number,
  lng: number,
  radiusMeters: number,
  limit: number
): Promise<NearbyBuilding[]> {
  const query = `
    [out:json][timeout:10];
    (
      way["building"]["addr:housenumber"](around:${radiusMeters},${lat},${lng});
      relation["building"]["addr:housenumber"](around:${radiusMeters},${lat},${lng});
    );
    out center ${limit};
  `;

  try {
    const res = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `data=${encodeURIComponent(query)}`,
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) return [];
    const data = await res.json();
    return parseOverpassResults(data);
  } catch {
    return [];
  }
}

/** Query Overpass for ANY buildings (even without addresses) */
async function findAnyBuildingsViaOverpass(
  lat: number,
  lng: number,
  radiusMeters: number,
  limit: number
): Promise<NearbyBuilding[]> {
  const query = `
    [out:json][timeout:10];
    (
      way["building"](around:${radiusMeters},${lat},${lng});
    );
    out center ${limit};
  `;

  try {
    const res = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `data=${encodeURIComponent(query)}`,
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) return [];
    const data = await res.json();
    return parseOverpassResults(data);
  } catch {
    return [];
  }
}

function parseOverpassResults(data: any): NearbyBuilding[] {
  const buildings: NearbyBuilding[] = [];
  for (const el of data.elements || []) {
    const centerLat = el.center?.lat || el.lat;
    const centerLng = el.center?.lon || el.lon;
    if (!centerLat || !centerLng) continue;

    const tags = el.tags || {};
    const houseNumber = tags["addr:housenumber"] || null;
    const street = tags["addr:street"] || null;
    const city = tags["addr:city"] || "";
    const state = tags["addr:state"] || "";
    const zip = tags["addr:postcode"] || "";

    let address: string | null = null;
    if (houseNumber && street) {
      address = [
        `${houseNumber} ${street}`,
        city,
        state,
        zip,
      ]
        .filter(Boolean)
        .join(", ");
    }

    buildings.push({
      lat: centerLat,
      lng: centerLng,
      address,
      houseNumber,
      street,
      osmId: `${el.type}_${el.id}`,
    });
  }
  return buildings;
}

/**
 * Generate a residential grid pattern.
 * Simulates typical US suburban layout: houses every ~25m along streets,
 * streets ~60m apart.
 */
function generateResidentialGrid(
  centerLat: number,
  centerLng: number,
  radiusMeters: number,
  limit: number
): NearbyBuilding[] {
  const buildings: NearbyBuilding[] = [];

  // Meters to degrees conversion
  const mPerDegLat = 111320;
  const mPerDegLng = 111320 * Math.cos((centerLat * Math.PI) / 180);

  const houseSpacing = 25; // meters between houses along a street
  const streetSpacing = 60; // meters between streets

  // Generate rows (streets)
  const numStreets = Math.floor((radiusMeters * 2) / streetSpacing);
  const housesPerStreet = Math.floor((radiusMeters * 2) / houseSpacing);

  for (let row = 0; row < numStreets && buildings.length < limit; row++) {
    const streetOffset = (row - numStreets / 2) * streetSpacing;
    const rowLat = centerLat + streetOffset / mPerDegLat;

    for (
      let col = 0;
      col < housesPerStreet && buildings.length < limit;
      col++
    ) {
      const houseOffset = (col - housesPerStreet / 2) * houseSpacing;
      const colLng = centerLng + houseOffset / mPerDegLng;

      // Skip the center point itself
      const dist = Math.sqrt(streetOffset ** 2 + houseOffset ** 2);
      if (dist < 15) continue; // too close to center
      if (dist > radiusMeters) continue; // outside radius

      buildings.push({
        lat: rowLat,
        lng: colLng,
        address: null,
        houseNumber: null,
        street: null,
        osmId: `grid_${rowLat.toFixed(5)}_${colLng.toFixed(5)}`,
      });
    }
  }

  return buildings.slice(0, limit);
}
