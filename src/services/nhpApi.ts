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
  months = 6,
): Promise<MeshSwath[]> {
  const end = new Date();
  const start = new Date();
  start.setMonth(start.getMonth() - months);

  const startStr = formatArcGisDate(start);
  const endStr = formatArcGisDate(end);

  const where = `Date_Occur >= '${startStr}' AND Date_Occur <= '${endStr}'`;

  // ArcGIS envelope format: xmin,ymin,xmax,ymax
  const envelope = `${bounds.west},${bounds.south},${bounds.east},${bounds.north}`;

  return queryFeatureServer(where, envelope);
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

function formatArcGisDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

async function queryFeatureServer(
  where: string,
  geometryEnvelope?: string,
): Promise<MeshSwath[]> {
  const params = new URLSearchParams({
    where,
    outFields: '*',
    returnGeometry: 'true',
    outSR: '4326',
    f: 'json',
    resultRecordCount: '500',
  });

  if (geometryEnvelope) {
    params.set('geometry', geometryEnvelope);
    params.set('geometryType', 'esriGeometryEnvelope');
    params.set('spatialRel', 'esriSpatialRelIntersects');
    params.set('inSR', '4326');
  }

  try {
    const res = await fetch(`${NHP_FEATURE_SERVER}?${params}`);
    if (!res.ok) throw new Error(`NHP FeatureServer returned ${res.status}`);

    const data: ArcGisResponse = await res.json();
    if (data.error) throw new Error(data.error.message);

    if (!data.features || !Array.isArray(data.features)) {
      return [];
    }

    return data.features.map(parseArcGisFeature).filter(Boolean) as MeshSwath[];
  } catch (err) {
    console.error('[nhpApi] queryFeatureServer failed:', err);
    return [];
  }
}

function parseArcGisFeature(f: ArcGisFeature): MeshSwath | null {
  const attrs = f.attributes;
  const geom = f.geometry;

  if (!geom) return null;

  // Convert ArcGIS geometry to GeoJSON
  let geometry: GeoJsonPolygon | GeoJsonMultiPolygon;

  if (geom.rings) {
    if (geom.rings.length === 1) {
      geometry = {
        type: 'Polygon',
        coordinates: geom.rings,
      };
    } else {
      geometry = {
        type: 'MultiPolygon',
        coordinates: geom.rings.map((ring) => [ring]),
      };
    }
  } else if (geom.paths) {
    // Lines — close them into polygons by duplicating first point
    const closedRings = geom.paths.map((path) => {
      const closed = [...path];
      if (closed.length > 0 && (closed[0][0] !== closed[closed.length - 1][0] ||
          closed[0][1] !== closed[closed.length - 1][1])) {
        closed.push([...closed[0]]);
      }
      return closed;
    });

    if (closedRings.length === 1) {
      geometry = { type: 'Polygon', coordinates: closedRings };
    } else {
      geometry = {
        type: 'MultiPolygon',
        coordinates: closedRings.map((ring) => [ring]),
      };
    }
  } else {
    return null;
  }

  const dateStr = (attrs.Date_Occur || attrs.DATE_OCCUR || '') as string;
  const maxMesh = (attrs.MaxMESH || attrs.MAXMESH || 0) as number;
  const avgMesh = (attrs.AvgMESH || attrs.AVGMESH || 0) as number;
  const area = (attrs.Area_sqmi || attrs.AREA_SQMI || 0) as number;
  const states = ((attrs.States || attrs.STATES || '') as string)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  return {
    id: `nhp-${attrs.OBJECTID}`,
    date: dateStr,
    geometry,
    maxMeshInches: maxMesh,
    avgMeshInches: avgMesh,
    areaSqMiles: area,
    statesAffected: states,
  };
}

// Re-export for convenience — used by type-checking in other files
export type { ArcGisRing };
