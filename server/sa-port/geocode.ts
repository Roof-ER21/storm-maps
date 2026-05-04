/**
 * Address → lat/lng geocoding. Mapbox primary, Nominatim (OSM) fallback.
 * Both free for our volume.
 */

export interface GeocodeResult {
  lat: number;
  lng: number;
  normalized: string;
  provider: "mapbox" | "nominatim";
}

export interface CountyResult {
  state_code: string;          // "VA"
  county_fips: string;          // "51059"
  county_name: string;          // "Fairfax"
  block_fips: string | null;    // for fine-grained census ops if ever needed
}

/**
 * lat/lng → county name (Census 2020 Bureau definition). Uses the FCC's
 * free Block Area API as the primary lookup — same dataset Census's own
 * Tract Bot uses, no API key required, ~150ms latency. Used to match
 * properties to FEMA disaster declarations whose `designated_area` field
 * is a county name.
 *
 * Two-tier cache: process-memory (fastest) → Postgres `county_lookups`
 * (survives restarts). FCC API only fires on cold neighborhoods.
 */
const FCC_BLOCK_BASE = "https://geo.fcc.gov/api/census/block/find";

const inMemoryCountyCache = new Map<string, CountyResult | null>();

function quantize(lat: number, lng: number): { latQ: number; lngQ: number; key: string } {
  // 0.01° ≈ 0.69mi at our latitudes — coarse enough that one cache hit
  // covers a small neighborhood, fine enough that border addresses don't
  // get the wrong county.
  const latQ = Math.round(lat * 100) / 100;
  const lngQ = Math.round(lng * 100) / 100;
  return { latQ, lngQ, key: `${latQ.toFixed(2)}|${lngQ.toFixed(2)}` };
}

export async function lookupCounty(
  lat: number,
  lng: number,
  sql?: import("../db.js").Sql,
): Promise<CountyResult | null> {
  const { latQ, lngQ, key } = quantize(lat, lng);
  if (inMemoryCountyCache.has(key)) return inMemoryCountyCache.get(key) ?? null;

  // Postgres cache check (survives container restarts)
  if (sql) {
    try {
      const rows = await sql<Array<{
        state_code: string | null; county_fips: string | null;
        county_name: string | null; block_fips: string | null; resolved: boolean;
      }>>`
        SELECT state_code, county_fips, county_name, block_fips, resolved
        FROM county_lookups WHERE lat_q = ${latQ} AND lng_q = ${lngQ}
      `;
      if (rows.length > 0) {
        const r = rows[0]!;
        const result: CountyResult | null = r.resolved && r.county_name && r.state_code
          ? {
              state_code: r.state_code,
              county_fips: r.county_fips ?? "",
              county_name: r.county_name,
              block_fips: r.block_fips,
            }
          : null;
        inMemoryCountyCache.set(key, result);
        return result;
      }
    } catch { /* fall through to API call */ }
  }

  try {
    const url = `${FCC_BLOCK_BASE}?latitude=${lat}&longitude=${lng}&showall=true&format=json`;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 4000);
    const res = await fetch(url, { signal: ac.signal });
    clearTimeout(timer);
    if (!res.ok) {
      inMemoryCountyCache.set(key, null);
      if (sql) await persistMiss(sql, latQ, lngQ);
      return null;
    }
    const data = (await res.json()) as {
      Block?: { FIPS?: string };
      County?: { name?: string; FIPS?: string };
      State?: { code?: string };
    };
    if (!data.County?.name || !data.State?.code) {
      inMemoryCountyCache.set(key, null);
      if (sql) await persistMiss(sql, latQ, lngQ);
      return null;
    }
    // FCC returns "Fairfax County" — FEMA stores parsed "Fairfax".
    // Strip the " County" / " Parish" / " City" suffix so matches succeed.
    const rawName = data.County.name;
    const stripped = rawName
      .replace(/\s+County$/i, "")
      .replace(/\s+Parish$/i, "")
      .replace(/\s+City$/i, "")
      .trim();
    const result: CountyResult = {
      state_code: data.State.code,
      county_fips: data.County.FIPS ?? "",
      county_name: stripped,
      block_fips: data.Block?.FIPS ?? null,
    };
    inMemoryCountyCache.set(key, result);
    if (sql) await persistHit(sql, latQ, lngQ, result);
    return result;
  } catch {
    inMemoryCountyCache.set(key, null);
    return null;
  }
}

async function persistHit(
  sql: import("../db.js").Sql,
  latQ: number, lngQ: number, r: CountyResult,
): Promise<void> {
  try {
    await sql`
      INSERT INTO county_lookups (lat_q, lng_q, state_code, county_fips, county_name, block_fips, resolved, fetched_at)
      VALUES (${latQ}, ${lngQ}, ${r.state_code}, ${r.county_fips}, ${r.county_name}, ${r.block_fips}, TRUE, NOW())
      ON CONFLICT (lat_q, lng_q) DO UPDATE SET
        state_code = EXCLUDED.state_code,
        county_fips = EXCLUDED.county_fips,
        county_name = EXCLUDED.county_name,
        block_fips = EXCLUDED.block_fips,
        resolved = TRUE, fetched_at = NOW()
    `;
  } catch { /* cache write failure is non-fatal */ }
}

async function persistMiss(
  sql: import("../db.js").Sql,
  latQ: number, lngQ: number,
): Promise<void> {
  try {
    await sql`
      INSERT INTO county_lookups (lat_q, lng_q, resolved, fetched_at)
      VALUES (${latQ}, ${lngQ}, FALSE, NOW())
      ON CONFLICT (lat_q, lng_q) DO UPDATE SET resolved = FALSE, fetched_at = NOW()
    `;
  } catch { /* ignore */ }
}

const MAPBOX_BASE = "https://api.mapbox.com/geocoding/v5/mapbox.places";
const NOMINATIM_BASE = "https://nominatim.openstreetmap.org/search";

export async function geocodeAddress(address: string): Promise<GeocodeResult | null> {
  const mapboxToken = process.env.MAPBOX_TOKEN;
  if (mapboxToken) {
    const r = await mapboxGeocode(address, mapboxToken);
    if (r) return r;
  }
  return await nominatimGeocode(address);
}

async function mapboxGeocode(
  address: string,
  token: string,
): Promise<GeocodeResult | null> {
  try {
    const url = `${MAPBOX_BASE}/${encodeURIComponent(address)}.json?access_token=${token}&country=US&types=address,place&limit=1`;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 5000);
    const res = await fetch(url, { signal: ac.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = (await res.json()) as {
      features?: Array<{ center: [number, number]; place_name: string }>;
    };
    const f = data.features?.[0];
    if (!f) return null;
    const [lng, lat] = f.center;
    return { lat, lng, normalized: f.place_name, provider: "mapbox" };
  } catch {
    return null;
  }
}

async function nominatimGeocode(address: string): Promise<GeocodeResult | null> {
  try {
    const url = `${NOMINATIM_BASE}?q=${encodeURIComponent(address)}&format=json&limit=1&countrycodes=us`;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 5000);
    const res = await fetch(url, {
      signal: ac.signal,
      headers: { "User-Agent": "storm-archive/0.1" },
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = (await res.json()) as Array<{
      lat: string;
      lon: string;
      display_name: string;
    }>;
    const f = data[0];
    if (!f) return null;
    return {
      lat: parseFloat(f.lat),
      lng: parseFloat(f.lon),
      normalized: f.display_name,
      provider: "nominatim",
    };
  } catch {
    return null;
  }
}
