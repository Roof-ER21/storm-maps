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
    const res = await fetch(`${NHP_FEATURE_SERVER}?${params}`, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`NHP FeatureServer returned ${res.status}`);

    const data = await res.json();
    if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));

    if (!data.features || !Array.isArray(data.features)) {
      return [];
    }

    // GeoJSON format — parse directly
    return data.features
      .filter((f: any) => f.geometry && f.geometry.coordinates)
      .map((f: any): MeshSwath | null => {
        const props = f.properties || {};
        // Actual NHP fields: Start_Date (epoch), HailLength, MaxWidth__, Province/Event
        const startEpoch = props.Start_Date ? Number(props.Start_Date) : null;
        const hailLengthKm = props.HailLength || 0;
        const maxWidthKm = (props.MaxWidth__ || 0);

        // Local date string
        let dateStr = '';
        if (startEpoch) {
          const d = new Date(startEpoch);
          dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        }

        // Estimate max MESH from swath width (wider = more severe)
        // NHP Lines view doesn't have MESH values directly, estimate from width
        const estimatedMeshInches = maxWidthKm > 20 ? 3.0 : maxWidthKm > 10 ? 2.0 : maxWidthKm > 5 ? 1.5 : 1.0;

        return {
          id: String(props.FID || props.OBJECTID || Math.random()),
          date: dateStr,
          maxMeshInches: estimatedMeshInches,
          avgMeshInches: estimatedMeshInches * 0.7,
          areaSqMiles: hailLengthKm * maxWidthKm * 0.386, // km² to mi²
          statesAffected: (props.Province || props.States || '').split(',').map((s: string) => s.trim()).filter(Boolean),
          geometry: f.geometry as MeshSwath['geometry'],
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
