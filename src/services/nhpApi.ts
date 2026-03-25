/**
 * National Hail Project (NHP) API Service
 *
 * Fetches MESH hail swath data from the ArcGIS FeatureServer
 * hosted by the Insurance Institute for Business & Home Safety (IBHS).
 *
 * This is the same data source used by HailSwathLayer in gemini-field-assistant.
 */

import type { MeshSwath, BoundingBox, GeoJsonPolygon, GeoJsonMultiPolygon } from '../types/storm';

// ---------------------------------------------------------------------------
// ArcGIS FeatureServer Configuration
// ---------------------------------------------------------------------------

const NHP_FEATURE_SERVER =
  'https://services.arcgis.com/rGKxabTU9mcXMw7k/arcgis/rest/services/HailSwathMESH_Lines_view/FeatureServer/0/query';

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
  _months = 6,
): Promise<MeshSwath[]> {
  // Use spatial filter with 1=1 where clause — the FeatureServer
  // uses Start_Date_Time as epoch ms, not a string date field
  const envelope = `${bounds.west},${bounds.south},${bounds.east},${bounds.north}`;

  return queryFeatureServer('1=1', envelope);
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
): Promise<MeshSwath[]> {
  // Convert radius from miles to approximate degrees
  const radiusDeg = radiusMiles / 69;

  const bounds: BoundingBox = {
    north: lat + radiusDeg,
    south: lat - radiusDeg,
    east: lng + radiusDeg / Math.cos((lat * Math.PI) / 180),
    west: lng - radiusDeg / Math.cos((lat * Math.PI) / 180),
  };

  return fetchMeshSwathsByBounds(bounds, months);
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
): Promise<MeshSwath[]> {
  const params = new URLSearchParams({
    where: where || '1=1',
    outFields: 'OBJECTID,Max_MESH_Value_in_the_Hailswath,Hailswath_Length,Max_width_of_swath,Start_Date_Time,End_Date_Time',
    returnGeometry: 'true',
    outSR: '4326',
    f: 'geojson',
    resultRecordCount: '500',
  });

  if (geometryEnvelope) {
    params.set('geometry', JSON.stringify({
      xmin: parseFloat(geometryEnvelope.split(',')[0]),
      ymin: parseFloat(geometryEnvelope.split(',')[1]),
      xmax: parseFloat(geometryEnvelope.split(',')[2]),
      ymax: parseFloat(geometryEnvelope.split(',')[3]),
      spatialReference: { wkid: 4326 }
    }));
    params.set('geometryType', 'esriGeometryEnvelope');
    params.set('spatialRel', 'esriSpatialRelIntersects');
    params.set('inSR', '4326');
  }

  try {
    const res = await fetch(`${NHP_FEATURE_SERVER}?${params}`, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`NHP FeatureServer returned ${res.status}`);

    const data = await res.json();
    if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));

    if (!data.features || !Array.isArray(data.features)) {
      return [];
    }

    // GeoJSON format — parse directly
    return data.features
      .filter((f: any) => {
        if (!f.geometry || !f.geometry.coordinates) return false;
        const meshMm = f.properties?.Max_MESH_Value_in_the_Hailswath;
        return meshMm != null && meshMm > 0;
      })
      .map((f: any): MeshSwath | null => {
        const props = f.properties;
        const meshMm = props.Max_MESH_Value_in_the_Hailswath || 0;
        const startEpoch = props.Start_Date_Time ? Number(props.Start_Date_Time) : null;

        // Local date string
        let dateStr = '';
        if (startEpoch) {
          const d = new Date(startEpoch);
          dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        }

        // Convert geometry to GeoJSON polygon format
        let geometry: GeoJsonPolygon | GeoJsonMultiPolygon | null = null;
        if (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon') {
          geometry = f.geometry;
        } else if (f.geometry.type === 'LineString' || f.geometry.type === 'MultiLineString') {
          // Lines — keep as-is, component will render as polyline
          geometry = f.geometry;
        }

        if (!geometry) return null;

        return {
          id: String(props.OBJECTID),
          date: dateStr,
          maxMeshInches: meshMm / 25.4,
          avgMeshInches: meshMm / 25.4,
          areaSqMiles: 0,
          statesAffected: [],
          geometry: geometry as GeoJsonPolygon,
        };
      })
      .filter(Boolean) as MeshSwath[];
  } catch (err) {
    console.error('[nhpApi] queryFeatureServer failed:', err);
    return [];
  }
}

// parseArcGisFeature removed — using GeoJSON format directly in queryFeatureServer

// Re-export for convenience — used by type-checking in other files
export type { ArcGisRing };
