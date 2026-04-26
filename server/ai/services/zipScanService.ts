/**
 * Zip Code Scanner Service
 * Finds residential addresses within a zip code using multiple strategies.
 */

export interface ZipScanAddress {
  lat: number;
  lng: number;
  address: string;
  houseNumber: string;
  street: string;
}

export async function findAddressesInZip(
  zipCode: string,
  limit: number = 100
): Promise<ZipScanAddress[]> {
  // Step 1: Get zip code center
  const center = await getZipCenter(zipCode);
  if (!center) return [];

  // Step 2: Try multiple strategies in order of quality
  // Strategy A: Buildings with full addresses
  let addresses = await queryOverpass(
    center.lat, center.lng,
    `way["building"]["addr:housenumber"]["addr:street"](around:5000,${center.lat},${center.lng});`,
    limit, zipCode
  );
  if (addresses.length >= 20) return addresses.slice(0, limit);

  // Strategy B: Residential buildings with housenumber (broader building types)
  const moreAddresses = await queryOverpass(
    center.lat, center.lng,
    `way["building"~"house|residential|detached|semidetached_house|terrace|apartments|yes"]["addr:housenumber"](around:5000,${center.lat},${center.lng});`,
    limit, zipCode
  );
  addresses = dedup([...addresses, ...moreAddresses]);
  if (addresses.length >= 20) return addresses.slice(0, limit);

  // Strategy C: All residential-type buildings (exclude commercial/industrial)
  const allBuildings = await queryOverpass(
    center.lat, center.lng,
    `way["building"~"house|residential|detached|semidetached_house|terrace|apartments|yes"]["building"!~"commercial|industrial|retail|warehouse|office|church|school|hospital|garage|shed"](around:5000,${center.lat},${center.lng});`,
    limit, zipCode
  );
  addresses = dedup([...addresses, ...allBuildings]);
  if (addresses.length >= 5) return addresses.slice(0, limit);

  // Strategy D: Nominatim search for addresses in the zip
  const nomAddresses = await searchNominatim(zipCode, center.lat, center.lng, limit);
  addresses = dedup([...addresses, ...nomAddresses]);

  // Only return what we actually found — NO grid fallback.
  // Grid points land on farmland, forests, and ponds.
  return addresses.slice(0, limit);
}

async function getZipCenter(
  zip: string
): Promise<{ lat: number; lng: number } | null> {
  // Try Nominatim first
  try {
    const url = new URL("https://nominatim.openstreetmap.org/search");
    url.searchParams.set("postalcode", zip);
    url.searchParams.set("country", "US");
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("limit", "1");

    const res = await fetch(url.toString(), {
      headers: { "User-Agent": "PropertyExteriorAnalyzer/1.0" },
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) {
      const text = await res.text();
      if (text.startsWith("[")) {
        const data = JSON.parse(text);
        if (data.length > 0) {
          return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
        }
      }
    }
  } catch { /* fall through */ }

  // Fallback: US Census Geocoder (always works for US zip codes)
  try {
    const url = `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=${zip}&benchmark=Public_AR_Current&format=json`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (res.ok) {
      const data = await res.json();
      const matches = data?.result?.addressMatches;
      if (matches?.length > 0) {
        return {
          lat: matches[0].coordinates.y,
          lng: matches[0].coordinates.x,
        };
      }
    }
  } catch { /* fall through */ }

  // Last resort: Zippopotam.us (free, no rate limits, just zip->lat/lng)
  try {
    const res = await fetch(`https://api.zippopotam.us/us/${zip}`, {
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      const data = await res.json();
      if (data.places?.length > 0) {
        return {
          lat: parseFloat(data.places[0].latitude),
          lng: parseFloat(data.places[0].longitude),
        };
      }
    }
  } catch { /* all failed */ }

  return null;
}

async function queryOverpass(
  lat: number,
  lng: number,
  wayQuery: string,
  limit: number,
  zip: string
): Promise<ZipScanAddress[]> {
  const query = `[out:json][timeout:20];(${wayQuery});out center ${Math.min(limit, 200)};`;

  try {
    const res = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `data=${encodeURIComponent(query)}`,
      signal: AbortSignal.timeout(25000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    const addresses: ZipScanAddress[] = [];

    for (const el of data.elements || []) {
      const cLat = el.center?.lat;
      const cLng = el.center?.lon;
      if (!cLat || !cLng) continue;

      const tags = el.tags || {};
      const houseNumber = tags["addr:housenumber"] || "";
      const street = tags["addr:street"] || "";

      // Skip if zip is tagged and doesn't match
      if (tags["addr:postcode"] && tags["addr:postcode"] !== zip) continue;

      const city = tags["addr:city"] || "";
      const state = tags["addr:state"] || "";

      let address = "";
      if (houseNumber && street) {
        address = [`${houseNumber} ${street}`, city, state, zip].filter(Boolean).join(", ");
      } else {
        // No address — use coordinates as a scannable point
        address = `Property at ${cLat.toFixed(5)}, ${cLng.toFixed(5)}, ${zip}`;
      }

      addresses.push({ lat: cLat, lng: cLng, address, houseNumber, street });
    }
    return addresses;
  } catch {
    return [];
  }
}

async function searchNominatim(
  zip: string,
  centerLat: number,
  centerLng: number,
  limit: number
): Promise<ZipScanAddress[]> {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("postalcode", zip);
  url.searchParams.set("country", "US");
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("limit", String(Math.min(limit, 50)));
  url.searchParams.set(
    "viewbox",
    `${centerLng - 0.03},${centerLat + 0.03},${centerLng + 0.03},${centerLat - 0.03}`
  );
  url.searchParams.set("bounded", "1");

  try {
    const res = await fetch(url.toString(), {
      headers: { "User-Agent": "PropertyExteriorAnalyzer/1.0" },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return [];
    const data = await res.json();

    return data
      .filter((item: any) => item.address?.house_number && item.address?.road)
      .map((item: any) => ({
        lat: parseFloat(item.lat),
        lng: parseFloat(item.lon),
        address: item.display_name,
        houseNumber: item.address.house_number,
        street: item.address.road,
      }));
  } catch {
    return [];
  }
}

function _generateResidentialGrid(
  centerLat: number,
  centerLng: number,
  radiusMeters: number,
  count: number,
  zip: string
): ZipScanAddress[] {
  const results: ZipScanAddress[] = [];
  const mPerDegLat = 111320;
  const mPerDegLng = 111320 * Math.cos((centerLat * Math.PI) / 180);
  const _spacing = 30; // meters between points (typical lot width)

  const stepsPerSide = Math.ceil(Math.sqrt(count)) + 1;
  const stepLat = (radiusMeters * 2) / stepsPerSide / mPerDegLat;
  const stepLng = (radiusMeters * 2) / stepsPerSide / mPerDegLng;

  for (let i = 0; i < stepsPerSide && results.length < count; i++) {
    for (let j = 0; j < stepsPerSide && results.length < count; j++) {
      const lat = centerLat + (i - stepsPerSide / 2) * stepLat;
      const lng = centerLng + (j - stepsPerSide / 2) * stepLng;
      const dist = Math.sqrt(
        ((lat - centerLat) * mPerDegLat) ** 2 +
        ((lng - centerLng) * mPerDegLng) ** 2
      );
      if (dist > radiusMeters || dist < 30) continue;

      results.push({
        lat,
        lng,
        address: `Property at ${lat.toFixed(5)}, ${lng.toFixed(5)}, ${zip}`,
        houseNumber: "",
        street: "",
      });
    }
  }
  return results;
}

/**
 * Attempt to reverse-geocode grid points to get real addresses.
 * Respects Nominatim 1 req/sec rate limit.
 * Only enriches up to 10 points to avoid excessive API calls.
 */
async function _enrichGridAddresses(
  points: ZipScanAddress[]
): Promise<ZipScanAddress[]> {
  const MAX_REVERSE = 10;
  const toEnrich = points.slice(0, MAX_REVERSE);
  const rest = points.slice(MAX_REVERSE);

  for (let i = 0; i < toEnrich.length; i++) {
    const p = toEnrich[i];
    if (p.houseNumber && p.street) continue; // already has address

    try {
      const url = `https://nominatim.openstreetmap.org/reverse?lat=${p.lat}&lon=${p.lng}&format=jsonv2&addressdetails=1&zoom=18`;
      const res = await fetch(url, {
        headers: { "User-Agent": "PropertyExteriorAnalyzer/1.0" },
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        const text = await res.text();
        if (text.startsWith("{")) {
          const data = JSON.parse(text);
          const addr = data.address;
          if (addr?.house_number && addr?.road) {
            p.houseNumber = addr.house_number;
            p.street = addr.road;
            p.address = [
              `${addr.house_number} ${addr.road}`,
              addr.city || addr.town || addr.village || "",
              addr.state || "",
              addr.postcode || "",
            ].filter(Boolean).join(", ");
          } else if (addr?.road) {
            // No house number but at least show the street name
            p.address = `Near ${addr.road}, ${addr.city || addr.town || ""} ${addr.postcode || ""}`.trim();
          }
        }
      }
    } catch { /* continue without enrichment */ }

    // Respect rate limit: 1 request per second
    if (i < toEnrich.length - 1) {
      await new Promise((r) => setTimeout(r, 1100));
    }
  }

  return [...toEnrich, ...rest];
}

function dedup(addresses: ZipScanAddress[]): ZipScanAddress[] {
  const seen = new Set<string>();
  return addresses.filter((a) => {
    const key = `${a.lat.toFixed(4)}_${a.lng.toFixed(4)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
