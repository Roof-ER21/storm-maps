/**
 * Storm Events API Service
 *
 * Fetches storm/hail data from two sources:
 * 1. NCEI SWDI (Severe Weather Data Inventory) — hail reports by lat/lng radius
 * 2. IEM (Iowa Environmental Mesonet) Local Storm Reports — GeoJSON feed
 *
 * Both are free, no API key required.
 */

import type { StormEvent, BoundingBox } from '../types/storm';

// ---------------------------------------------------------------------------
// NCEI SWDI Hail Reports
// Docs: https://www.ncei.noaa.gov/access/metadata/landing-page/bin/iso?id=gov.noaa.ncdc:C01577
// ---------------------------------------------------------------------------

interface SwdiHailRecord {
  ZTIME: string;       // "YYYYMMDDHHMMSS" UTC
  LON: string;         // longitude
  LAT: string;         // latitude
  MAXSIZE: string;     // hail size in inches
  WSR_ID: string;      // radar station ID
  CELL_ID: string;     // cell identifier
}

interface SwdiResponse {
  result?: SwdiHailRecord[];
}

/**
 * Format a Date into YYYYMMDD for SWDI queries.
 */
function formatSwdiDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

/**
 * Search NCEI SWDI for hail reports near a lat/lng within a time window.
 *
 * @param lat  - center latitude
 * @param lng  - center longitude
 * @param months - how many months back to search (default 6)
 * @param radius - search radius in miles (default 50)
 */
export async function searchByCoordinates(
  lat: number,
  lng: number,
  months = 6,
  radius = 50,
): Promise<StormEvent[]> {
  const end = new Date();
  const start = new Date();
  start.setMonth(start.getMonth() - months);

  const startStr = formatSwdiDate(start);
  const endStr = formatSwdiDate(end);

  // SWDI expects center as lon,lat (note: longitude first)
  const url =
    `https://www.ncei.noaa.gov/swdiws/json/nx3hail/${startStr}:${endStr}` +
    `?center=${lng},${lat}&radius=${radius}`;

  try {
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`SWDI API returned ${res.status}`);
    }
    const data: SwdiResponse = await res.json();

    if (!data.result || !Array.isArray(data.result)) {
      return [];
    }

    return data.result.map((r, idx) => parseSwdiRecord(r, idx));
  } catch (err) {
    console.error('[stormApi] SWDI fetch failed:', err);
    return [];
  }
}

function parseSwdiRecord(r: SwdiHailRecord, idx: number): StormEvent {
  const lat = parseFloat(r.LAT) || 0;
  const lon = parseFloat(r.LON) || 0;
  const size = parseFloat(r.MAXSIZE) || 0;
  const ztime = r.ZTIME || '';

  // Parse YYYYMMDDHHMMSS into ISO string
  let isoDate = '';
  if (ztime.length >= 8) {
    const y = ztime.slice(0, 4);
    const m = ztime.slice(4, 6);
    const d = ztime.slice(6, 8);
    const hh = ztime.slice(8, 10) || '00';
    const mm = ztime.slice(10, 12) || '00';
    isoDate = `${y}-${m}-${d}T${hh}:${mm}:00Z`;
  }

  return {
    id: `swdi-${r.WSR_ID}-${r.CELL_ID}-${idx}`,
    eventType: 'Hail',
    state: '',
    county: '',
    beginDate: isoDate,
    endDate: isoDate,
    beginLat: lat,
    beginLon: lon,
    endLat: lat,
    endLon: lon,
    magnitude: size,
    magnitudeType: 'inches',
    damageProperty: 0,
    source: `NEXRAD ${r.WSR_ID}`,
    narrative: `Radar-detected hail: ${size}" max size (Cell ${r.CELL_ID})`,
  };
}

// ---------------------------------------------------------------------------
// IEM Local Storm Reports (LSR) — GeoJSON feed
// Docs: https://mesonet.agron.iastate.edu/request/gis/lsr.phtml
// ---------------------------------------------------------------------------

interface LsrProperties {
  valid: string;        // ISO timestamp
  type: string;         // "H" = hail, "T" = tornado, etc.
  magnitude: number;    // size in inches for hail
  city: string;
  county: string;
  state: string;
  source: string;
  remark: string;
  typetext: string;     // "Hail", "Tornado", etc.
}

interface LsrFeature {
  type: 'Feature';
  properties: LsrProperties;
  geometry: {
    type: 'Point';
    coordinates: [number, number];
  };
}

interface LsrGeoJson {
  type: 'FeatureCollection';
  features: LsrFeature[];
}

/**
 * Fetch IEM Local Storm Reports as GeoJSON.
 * Default window: last 24 hours.
 */
export async function fetchLocalStormReports(): Promise<StormEvent[]> {
  const url = 'https://mesonet.agron.iastate.edu/geojson/lsr.geojson';

  try {
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`IEM LSR API returned ${res.status}`);
    }
    const data: LsrGeoJson = await res.json();

    if (!data.features || !Array.isArray(data.features)) {
      return [];
    }

    return data.features
      .filter((f) => f.properties.type === 'H') // hail only
      .map((f, idx) => parseLsrFeature(f, idx));
  } catch (err) {
    console.error('[stormApi] IEM LSR fetch failed:', err);
    return [];
  }
}

function mapLsrTypeToEvent(typeText: string): StormEvent['eventType'] {
  const lower = typeText.toLowerCase();
  if (lower.includes('hail')) return 'Hail';
  if (lower.includes('tornado')) return 'Tornado';
  if (lower.includes('wind')) return 'Thunderstorm Wind';
  if (lower.includes('flood')) return 'Flash Flood';
  return 'Hail';
}

function parseLsrFeature(f: LsrFeature, idx: number): StormEvent {
  const p = f.properties;
  const [lon, lat] = f.geometry.coordinates;

  return {
    id: `lsr-${idx}-${p.valid}`,
    eventType: mapLsrTypeToEvent(p.typetext),
    state: p.state || '',
    county: p.county || '',
    beginDate: p.valid,
    endDate: p.valid,
    beginLat: lat,
    beginLon: lon,
    endLat: lat,
    endLon: lon,
    magnitude: p.magnitude || 0,
    magnitudeType: 'inches',
    damageProperty: 0,
    source: p.source || 'LSR',
    narrative: p.remark || `${p.typetext} reported near ${p.city}, ${p.state}`,
  };
}

// ---------------------------------------------------------------------------
// Legacy API signatures (kept for backward compatibility with existing hook)
// ---------------------------------------------------------------------------

/**
 * Fetch storm events from NOAA within a bounding box and date range.
 * Delegates to searchByCoordinates using the bounding box center.
 */
export async function fetchStormEvents(
  startDate: string,
  _endDate: string,
  bounds: BoundingBox,
): Promise<StormEvent[]> {
  const centerLat = (bounds.north + bounds.south) / 2;
  const centerLng = (bounds.east + bounds.west) / 2;

  // Calculate approximate radius from bounding box (in miles)
  const latSpan = Math.abs(bounds.north - bounds.south);
  const lngSpan = Math.abs(bounds.east - bounds.west);
  const approxDegrees = Math.max(latSpan, lngSpan) / 2;
  const radiusMiles = Math.max(25, Math.round(approxDegrees * 69));

  // Calculate months from startDate to now
  const startMs = new Date(startDate).getTime();
  const nowMs = Date.now();
  const months = Math.max(1, Math.ceil((nowMs - startMs) / (30 * 24 * 60 * 60 * 1000)));

  return searchByCoordinates(centerLat, centerLng, months, radiusMiles);
}

/**
 * Fetch storm events for a specific state and date.
 * Uses IEM LSR then filters by state.
 */
export async function fetchStateStormEvents(
  state: string,
): Promise<StormEvent[]> {
  const all = await fetchLocalStormReports();
  return all.filter(
    (e) => e.state.toLowerCase() === state.toLowerCase(),
  );
}
