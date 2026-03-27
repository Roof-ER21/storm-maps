/**
 * National Hail Project (NHP) API Service
 *
 * Fetches MESH hail swath data from the ArcGIS FeatureServer
 * hosted by the Insurance Institute for Business & Home Safety (IBHS).
 *
 * This is the same data source used by HailSwathLayer in gemini-field-assistant.
 */

import type { MeshSwath, BoundingBox } from '../types/storm';

// ---------------------------------------------------------------------------
// ArcGIS FeatureServer Configuration
// ---------------------------------------------------------------------------

const NHP_FEATURE_SERVER =
  'https://services.arcgis.com/rGKxabTU9mcXMw7k/arcgis/rest/services/HailSwathMESH_Lines_view/FeatureServer/0/query';

function getTimeoutSignal(
  timeoutMs: number,
  signal?: AbortSignal,
): AbortSignal {
  return signal
    ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
    : AbortSignal.timeout(timeoutMs);
}

// ---------------------------------------------------------------------------
// ArcGIS Response Types
// ---------------------------------------------------------------------------

interface ArcGisRing {
  rings?: number[][][];
}

interface ArcGisGeometry {
  rings?: number[][][];
  paths?: number[][][];
}

interface ArcGisAttributes {
  OBJECTID: number;
  Date_Occur?: string;
  DATE_OCCUR?: string;
  MaxMESH?: number;
  MAXMESH?: number;
  AvgMESH?: number;
  AVGMESH?: number;
  Area_sqmi?: number;
  AREA_SQMI?: number;
  States?: string;
  STATES?: string;
  [key: string]: unknown;
}

interface ArcGisFeature {
  attributes: ArcGisAttributes;
  geometry: ArcGisGeometry;
}

interface ArcGisResponse {
  features?: ArcGisFeature[];
  error?: { message: string };
}

interface NhpGeoJsonProperties {
  Start_Date?: number | string;
  HailLength?: number;
  MaxWidth__?: number;
  MaxWidth_S?: number;
  MaxWidth_1?: number;
  MaxWidth_2?: number;
  MaxWidth_3?: number;
  Province?: string;
  States?: string;
  FID?: number;
  OBJECTID?: number;
}

interface NhpGeoJsonFeature {
  properties?: NhpGeoJsonProperties;
  geometry?: MeshSwath['geometry'];
}

interface NhpGeoJsonResponse {
  features?: NhpGeoJsonFeature[];
  error?: { message?: string };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Fetch MESH hail swath polygons from the NHP FeatureServer.
 *
 * @param date - Storm date in YYYY-MM-DD format
 */
export async function fetchMeshSwaths(date: string): Promise<MeshSwath[]> {
  const where = `Date_Occur='${date}' OR DATE_OCCUR='${date}'`;
  return queryFeatureServer(where);
}

/**
 * Fetch MESH swaths within a geographic bounding box.
 *
 * @param bounds - Geographic bounding box
 * @param months - How many months back to query (default 6)
 */
export async function fetchMeshSwathsByBounds(
  bounds: BoundingBox,
  months = 6,
  sinceDate?: string | null,
  signal?: AbortSignal,
): Promise<MeshSwath[]> {
  const envelope = `${bounds.west},${bounds.south},${bounds.east},${bounds.north}`;
  const where = buildDateWindowWhere(months, sinceDate);

  return queryFeatureServer(where, envelope, signal);
}

/**
 * Fetch MESH swaths near a lat/lng within a time window.
 *
 * @param lat - Center latitude
 * @param lng - Center longitude
 * @param months - How many months back (default 6)
 * @param radiusMiles - Search radius in miles (default 50)
 */
export async function fetchMeshSwathsByLocation(
  lat: number,
  lng: number,
  months = 6,
  radiusMiles = 50,
  sinceDate?: string | null,
  signal?: AbortSignal,
): Promise<MeshSwath[]> {
  // Convert radius from miles to approximate degrees
  const radiusDeg = radiusMiles / 69;

  const bounds: BoundingBox = {
    north: lat + radiusDeg,
    south: lat - radiusDeg,
    east: lng + radiusDeg / Math.cos((lat * Math.PI) / 180),
    west: lng - radiusDeg / Math.cos((lat * Math.PI) / 180),
  };

  return fetchMeshSwathsByBounds(bounds, months, sinceDate, signal);
}

/**
 * Fetch available storm dates from NHP within a date range.
 *
 * @param startDate - Start date YYYY-MM-DD
 * @param endDate   - End date YYYY-MM-DD
 */
export async function fetchAvailableStormDates(
  startDate: string,
  endDate: string,
): Promise<string[]> {
  const where = `Date_Occur >= '${startDate}' AND Date_Occur <= '${endDate}'`;

  const params = new URLSearchParams({
    where,
    outFields: 'Date_Occur',
    returnDistinctValues: 'true',
    returnGeometry: 'false',
    f: 'json',
  });

  try {
    const res = await fetch(`${NHP_FEATURE_SERVER}?${params}`);
    if (!res.ok) throw new Error(`NHP returned ${res.status}`);

    const data: ArcGisResponse = await res.json();
    if (data.error) throw new Error(data.error.message);

    if (!data.features) return [];

    const dates = data.features
      .map((f) => f.attributes.Date_Occur || f.attributes.DATE_OCCUR || '')
      .filter(Boolean);

    // Deduplicate and sort
    return [...new Set(dates)].sort().reverse();
  } catch (err) {
    console.error('[nhpApi] fetchAvailableStormDates failed:', err);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function queryFeatureServer(
  where: string,
  geometryEnvelope?: string,
  signal?: AbortSignal,
): Promise<MeshSwath[]> {
  // Build params — match exact format from working field assistant
  const paramObj: Record<string, string> = {
    where: where || '1=1',
    outFields: '*',
    returnGeometry: 'true',
    outSR: '4326',
    f: 'geojson',
    resultRecordCount: '500',
  };

  if (geometryEnvelope) {
    const [xmin, ymin, xmax, ymax] = geometryEnvelope.split(',').map(Number);
    paramObj.geometry = JSON.stringify({
      xmin, ymin, xmax, ymax,
      spatialReference: { wkid: 4326 }
    });
    paramObj.geometryType = 'esriGeometryEnvelope';
    paramObj.spatialRel = 'esriSpatialRelIntersects';
    paramObj.inSR = '4326';
  }

  const params = new URLSearchParams(paramObj);

  try {
    const res = await fetch(`${NHP_FEATURE_SERVER}?${params}`, {
      signal: getTimeoutSignal(15000, signal),
    });
    if (!res.ok) throw new Error(`NHP FeatureServer returned ${res.status}`);

    const data: NhpGeoJsonResponse = await res.json();
    if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));

    if (!data.features || !Array.isArray(data.features)) {
      return [];
    }

    // GeoJSON format — parse directly
    return data.features
      .filter((feature): feature is NhpGeoJsonFeature & { geometry: MeshSwath['geometry'] } =>
        Boolean(feature.geometry),
      )
      .map((feature): MeshSwath => {
        const props = feature.properties || {};
        // Actual NHP fields: Start_Date (epoch), HailLength, MaxWidth__, Province/Event
        const startEpoch = props.Start_Date ? Number(props.Start_Date) : null;
        const hailLengthKm = props.HailLength || 0;
        const maxWidthKm = props.MaxWidth__ || 0;
        const maxWidthLine =
          props.MaxWidth_S !== undefined &&
          props.MaxWidth_1 !== undefined &&
          props.MaxWidth_2 !== undefined &&
          props.MaxWidth_3 !== undefined
            ? [
                { lat: props.MaxWidth_S, lng: props.MaxWidth_1 },
                { lat: props.MaxWidth_2, lng: props.MaxWidth_3 },
              ] as [{ lat: number; lng: number }, { lat: number; lng: number }]
            : null;

        // Local date string
        let dateStr = '';
        if (startEpoch) {
          const d = new Date(startEpoch);
          dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        }

        const estimatedMeshInches = estimateMeshInchesFromWidth(maxWidthKm);

        return {
          id: String(props.FID || props.OBJECTID || Math.random()),
          date: dateStr,
          sourceGeometryType:
            feature.geometry.type === 'Polygon' || feature.geometry.type === 'MultiPolygon'
              ? 'polygon'
              : 'line',
          maxMeshInches: estimatedMeshInches,
          avgMeshInches: Math.max(0.5, estimatedMeshInches * 0.72),
          areaSqMiles: hailLengthKm * maxWidthKm * 0.386, // km² to mi²
          hailLengthKm,
          maxWidthKm,
          maxWidthLine,
          statesAffected: (props.Province || props.States || '').split(',').map((s: string) => s.trim()).filter(Boolean),
          geometry: feature.geometry,
        };
      })
      .filter(Boolean);
  } catch (err) {
    if (signal?.aborted || (err instanceof Error && err.name === 'AbortError')) {
      return [];
    }
    console.error('[nhpApi] queryFeatureServer failed:', err);
    return [];
  }
}

function estimateMeshInchesFromWidth(maxWidthKm: number): number {
  if (maxWidthKm >= 30) return 3.5;
  if (maxWidthKm >= 22) return 2.75;
  if (maxWidthKm >= 15) return 2.0;
  if (maxWidthKm >= 10) return 1.75;
  if (maxWidthKm >= 6) return 1.5;
  if (maxWidthKm >= 3) return 1.0;
  return 0.75;
}

function buildDateWindowWhere(
  months: number,
  sinceDate?: string | null,
): string {
  const startDate = sinceDate
    ? new Date(`${sinceDate}T00:00:00Z`)
    : new Date(new Date().setMonth(new Date().getMonth() - months));

  if (Number.isNaN(startDate.getTime())) {
    return '1=1';
  }

  const isoDate = startDate.toISOString().slice(0, 10);
  return `Start_Date >= DATE '${isoDate} 00:00:00'`;
}

// parseArcGisFeature removed — using GeoJSON format directly in queryFeatureServer

// Re-export for convenience — used by type-checking in other files
export type { ArcGisRing };
