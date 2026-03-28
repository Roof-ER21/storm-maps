/**
 * Storm Events API Service
 *
 * Standalone-first behavior:
 * - direct NCEI SWDI hail queries
 * - direct IEM Local Storm Reports
 *
 * Optional:
 * - a separately configured JSON search backend for richer historical NOAA data
 *
 * The standalone app should not hard-depend on another deployed app just to
 * render property history.
 */

import type { StormEvent, BoundingBox } from '../types/storm';

const OPTIONAL_STORM_SEARCH_API_BASE =
  (import.meta.env.VITE_STORM_SEARCH_API_BASE as string | undefined)?.trim() || '';
const SWDI_MAX_MONTHS = 120;
const SWDI_CHUNK_MS = 30 * 24 * 60 * 60 * 1000;
const SWDI_BATCH_SIZE = 6;

function appendEvents(target: StormEvent[], next: StormEvent[]): void {
  for (const event of next) {
    target.push(event);
  }
}

function getBoundingBoxForRadius(
  lat: number,
  lng: number,
  radiusMiles: number,
): { west: number; south: number; east: number; north: number } {
  const radiusDeg = radiusMiles / 69;

  return {
    west: lng - radiusDeg / Math.cos((lat * Math.PI) / 180),
    south: lat - radiusDeg,
    east: lng + radiusDeg / Math.cos((lat * Math.PI) / 180),
    north: lat + radiusDeg,
  };
}

function haversineDistanceMiles(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const earthRadiusMiles = 3958.8;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;

  return earthRadiusMiles * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function getFieldAssistantTimeoutMs(months: number): number {
  if (months >= 120) return 45000;
  if (months >= 60) return 30000;
  if (months >= 24) return 20000;
  return 10000;
}

function shouldUseSwdiFallback(months: number): boolean {
  return months <= SWDI_MAX_MONTHS;
}

function getOptionalSearchApiBase(): string | null {
  if (!OPTIONAL_STORM_SEARCH_API_BASE) {
    return null;
  }

  return OPTIONAL_STORM_SEARCH_API_BASE.replace(/\/+$/, '');
}

function getTimeoutSignal(
  timeoutMs: number,
  signal?: AbortSignal,
): AbortSignal {
  return signal
    ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
    : AbortSignal.timeout(timeoutMs);
}

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

interface Sa21HailEvent {
  id?: string | number;
  date?: string;
  latitude?: number;
  longitude?: number;
  hailSize?: number;
  severity?: string;
  source?: string;
}

interface Sa21NoaaEvent {
  id?: string | number;
  eventType?: string;
  date?: string;
  latitude?: number;
  longitude?: number;
  magnitude?: number;
  state?: string;
  source?: string;
  narrative?: string;
  location?: string;
}

interface Sa21SearchResponse {
  events?: Sa21HailEvent[];
  noaaEvents?: Sa21NoaaEvent[];
}

function mapSa21NoaaEventType(
  rawType?: string,
): StormEvent['eventType'] | null {
  const normalized = rawType?.toLowerCase().trim();
  if (normalized === 'hail') return 'Hail';
  if (normalized === 'wind' || normalized === 'thunderstorm wind') {
    return 'Thunderstorm Wind';
  }
  return null;
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
  signal?: AbortSignal,
): Promise<StormEvent[]> {
  const searchApiBase = getOptionalSearchApiBase();

  if (searchApiBase) {
    try {
      const timeoutMs = getFieldAssistantTimeoutMs(months);
      const params = new URLSearchParams({
        lat: lat.toString(),
        lng: lng.toString(),
        months: months.toString(),
        radius: radius.toString(),
      });
      const res = await fetch(`${searchApiBase}/hail/search?${params}`, {
        signal: getTimeoutSignal(timeoutMs, signal),
        mode: 'cors',
        headers: { 'x-user-email': 'storm-maps@roofer21.com' },
      });
      if (res.ok) {
        const data: Sa21SearchResponse = await res.json();
        const events: StormEvent[] = [];

        if (data.events && Array.isArray(data.events)) {
          appendEvents(
            events,
            data.events.map((e, idx: number) => ({
              id: `ihm-${e.id || idx}`,
              eventType: 'Hail' as const,
              state: '',
              county: '',
              beginDate: e.date || '',
              endDate: e.date || '',
              beginLat: e.latitude || 0,
              beginLon: e.longitude || 0,
              endLat: e.latitude || 0,
              endLon: e.longitude || 0,
              magnitude: e.hailSize || 0,
              magnitudeType: 'inches',
              damageProperty: 0,
              source: e.source || 'Storm Database',
              narrative: `Hail ${e.hailSize}"  - ${e.severity || 'unknown'} severity`,
            })),
          );
        }

        if (data.noaaEvents && Array.isArray(data.noaaEvents)) {
          appendEvents(
            events,
            data.noaaEvents
              .map((e, idx: number) => {
                const eventType = mapSa21NoaaEventType(e.eventType);
                if (!eventType) {
                  return null;
                }

                return {
                  id: `noaa-${e.id || idx}`,
                  eventType,
                  state: e.state || '',
                  county: '',
                  beginDate: e.date || '',
                  endDate: e.date || '',
                  beginLat: e.latitude || 0,
                  beginLon: e.longitude || 0,
                  endLat: e.latitude || 0,
                  endLon: e.longitude || 0,
                  magnitude: e.magnitude || 0,
                  magnitudeType: eventType === 'Thunderstorm Wind' ? 'mph' : 'inches',
                  damageProperty: 0,
                  source: e.source || 'NOAA',
                  narrative: e.narrative || `${e.eventType} - ${e.location || ''}`,
                };
              })
              .filter((event): event is StormEvent => Boolean(event)),
          );
        }

        if (events.length > 0) {
          return events;
        }
      }
    } catch (err) {
      if (signal?.aborted || (err instanceof Error && err.name === 'AbortError')) {
        return [];
      }

      if (!shouldUseSwdiFallback(months)) {
        console.warn(
          `[stormApi] Optional search API failed for ${months}-month search; skipping SWDI fallback for long-range query:`,
          err,
        );
        return [];
      }

      console.warn('[stormApi] Optional search API failed, falling back to SWDI:', err);
    }
  } else if (!shouldUseSwdiFallback(months)) {
    console.warn(
      `[stormApi] No standalone search backend configured for ${months}-month event search, and SWDI is capped at ${SWDI_MAX_MONTHS} months.`,
    );
    return [];
  }

  // Fallback: SWDI direct queries
  const end = new Date();
  const start = new Date();
  start.setMonth(start.getMonth() - months);

  const allEvents: StormEvent[] = [];
  const chunks: Array<{ start: number; end: number }> = [];
  const bbox = getBoundingBoxForRadius(lat, lng, radius);
  let chunkStart = start.getTime();
  const endMs = end.getTime();

  while (chunkStart < endMs) {
    const chunkEnd = Math.min(chunkStart + SWDI_CHUNK_MS, endMs);
    chunks.push({ start: chunkStart, end: chunkEnd });
    chunkStart = chunkEnd;
  }

  for (let index = 0; index < chunks.length; index += SWDI_BATCH_SIZE) {
    const batch = chunks.slice(index, index + SWDI_BATCH_SIZE);

    const results = await Promise.allSettled(
      batch.map(async (chunk) => {
        const s = formatSwdiDate(new Date(chunk.start));
        const e = formatSwdiDate(new Date(chunk.end));
        const url =
          `https://www.ncei.noaa.gov/swdiws/json/nx3hail/${s}:${e}` +
          `?bbox=${bbox.west},${bbox.south},${bbox.east},${bbox.north}`;

        const res = await fetch(url, {
          signal: getTimeoutSignal(15000, signal),
        });

        if (!res.ok) {
          throw new Error(`SWDI returned ${res.status} for ${s}:${e}`);
        }

        const data: SwdiResponse = await res.json();
        return {
          dateRange: `${s}:${e}`,
          records: data.result && Array.isArray(data.result) ? data.result : [],
        };
      }),
    );

    if (signal?.aborted) {
      return allEvents;
    }

    for (const result of results) {
      if (result.status === 'fulfilled') {
        appendEvents(
          allEvents,
          result.value.records.map((record, recordIndex) =>
            parseSwdiRecord(record, allEvents.length + recordIndex),
          ),
        );
      } else {
        console.warn('[stormApi] SWDI chunk failed:', result.reason);
      }
    }
  }

  return allEvents.filter((event) => {
    const distance = haversineDistanceMiles(
      lat,
      lng,
      event.beginLat,
      event.beginLon,
    );

    return distance <= radius;
  });
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
export async function fetchLocalStormReports(
  signal?: AbortSignal,
): Promise<StormEvent[]> {
  const url = 'https://mesonet.agron.iastate.edu/geojson/lsr.geojson';

  try {
    const res = await fetch(url, { signal: getTimeoutSignal(10000, signal) });
    if (!res.ok) {
      throw new Error(`IEM LSR API returned ${res.status}`);
    }
    const data: LsrGeoJson = await res.json();

    if (!data.features || !Array.isArray(data.features)) {
      return [];
    }

    return data.features
      .filter((f) =>
        f.properties.type === 'H' ||
        mapLsrTypeToEvent(f.properties.typetext) === 'Thunderstorm Wind',
      )
      .map((f, idx) => parseLsrFeature(f, idx));
  } catch (err) {
    if (signal?.aborted || (err instanceof Error && err.name === 'AbortError')) {
      return [];
    }
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
    magnitudeType:
      mapLsrTypeToEvent(p.typetext) === 'Thunderstorm Wind' ? 'mph' : 'inches',
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
