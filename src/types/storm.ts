/**
 * Hail Yes! - Shared Types
 *
 * Core type definitions for hail/storm intelligence data,
 * map overlays, and canvassing features.
 */

// ============================================================
// GeoJSON Primitives (subset to avoid @types/geojson dependency)
// ============================================================

export interface GeoJsonPolygon {
  type: 'Polygon';
  coordinates: number[][][];
}

export interface GeoJsonMultiPolygon {
  type: 'MultiPolygon';
  coordinates: number[][][][];
}

export interface GeoJsonLineString {
  type: 'LineString';
  coordinates: number[][];
}

export interface GeoJsonMultiLineString {
  type: 'MultiLineString';
  coordinates: number[][][];
}

// ============================================================
// Geographic Types
// ============================================================

export interface LatLng {
  lat: number;
  lng: number;
}

export interface BoundingBox {
  north: number;
  south: number;
  east: number;
  west: number;
}

export type SearchResultType =
  | 'address'
  | 'postal_code'
  | 'locality'
  | 'administrative_area'
  | 'unknown';

export type HistoryRangePreset = '1y' | '2y' | '5y' | '10y' | 'since';

export type AppView =
  | 'dashboard'
  | 'map'
  | 'canvass'
  | 'pinned'
  | 'reports'
  | 'evidence';

// ============================================================
// Storm Event Types
// ============================================================

/** NOAA Storm Events API event record */
export interface StormEvent {
  id: string;
  eventType: 'Hail' | 'Thunderstorm Wind' | 'Tornado' | 'Flash Flood';
  state: string;
  county: string;
  beginDate: string;
  endDate: string;
  beginLat: number;
  beginLon: number;
  endLat: number;
  endLon: number;
  /** Hail size in inches (e.g., 1.0, 1.75, 2.5) */
  magnitude: number;
  /** Magnitude type: "inches" for hail */
  magnitudeType: string;
  /** Damage property estimate in USD */
  damageProperty: number;
  /** Source of the report (e.g., "Trained Spotter", "Public") */
  source: string;
  /** Narrative description of the event */
  narrative: string;
}

/** Hail size classification for map legend and filtering */
export interface HailSizeClass {
  /** Minimum diameter in inches */
  minInches: number;
  /** Maximum diameter in inches */
  maxInches: number;
  /** Display label (e.g., "Quarter (1.0\")") */
  label: string;
  /** Hex color for map overlay */
  color: string;
  /** Common name reference (e.g., "quarter", "golf ball") */
  reference: string;
  /** Estimated roof damage severity 0-5 */
  damageSeverity: number;
}

// ============================================================
// MESH / Hail Swath Types
// ============================================================

/** National Hail Project MESH swath data */
export interface MeshSwath {
  id: string;
  /** Storm date in YYYY-MM-DD format */
  date: string;
  /** GeoJSON geometry defining the swath boundary (polygon or line) */
  geometry: GeoJsonPolygon | GeoJsonMultiPolygon | GeoJsonLineString | GeoJsonMultiLineString;
  /** Source geometry kind from the upstream dataset */
  sourceGeometryType?: 'polygon' | 'line';
  /** Maximum Estimated Size of Hail in inches */
  maxMeshInches: number;
  /** Average MESH in inches across the swath */
  avgMeshInches: number;
  /** Area of swath in square miles */
  areaSqMiles: number;
  /** Approximate swath length in kilometers */
  hailLengthKm?: number;
  /** Approximate maximum swath width in kilometers */
  maxWidthKm?: number;
  /** Cross-section showing the widest part of the swath */
  maxWidthLine?: [LatLng, LatLng] | null;
  /** States affected */
  statesAffected: string[];
}

/** Individual MESH tile for raster overlay */
export interface MeshTile {
  x: number;
  y: number;
  z: number;
  /** Tile image URL */
  url: string;
}

// ============================================================
// NEXRAD Radar Types
// ============================================================

/** NEXRAD radar station metadata */
export interface NexradStation {
  id: string;
  name: string;
  state: string;
  lat: number;
  lng: number;
  /** Elevation in feet */
  elevation: number;
}

/** NEXRAD radar frame for animation */
export interface NexradFrame {
  /** Timestamp in ISO format */
  timestamp: string;
  /** Tile layer URL template */
  tileUrl: string;
  /** Radar product type */
  product: 'base-reflectivity' | 'composite-reflectivity' | 'velocity';
}

// ============================================================
// MRMS (Multi-Radar/Multi-Sensor) Types
// ============================================================

/** MRMS hail product data */
export interface MrmsHailData {
  /** Product type */
  product: 'MESH' | 'SHI' | 'POSH' | 'MHP';
  /** Timestamp */
  timestamp: string;
  /** Tile URL template for overlay */
  tileUrl: string;
  /** Opacity 0-1 */
  opacity: number;
}

// ============================================================
// GPS / Canvassing Types
// ============================================================

/** User GPS position for blue-dot tracking */
export interface GpsPosition {
  lat: number;
  lng: number;
  accuracy: number;
  heading: number | null;
  speed: number | null;
  timestamp: number;
}

/** Canvassing zone alert */
export interface CanvassingAlert {
  /** Whether the user is currently inside a hail-affected zone */
  inHailZone: boolean;
  /** Estimated hail size at current location */
  estimatedHailSize: number | null;
  /** Storm date that affected this area */
  stormDate: string | null;
  /** Distance to nearest hail swath edge in miles */
  distanceToSwathMiles: number | null;
  /** Suggested talking points for door knocking */
  talkingPoints: string[];
}

// ============================================================
// Map Layer Configuration
// ============================================================

export type MapLayerType = 'mesh-swath' | 'nexrad' | 'mrms' | 'storm-reports';

export interface MapLayerConfig {
  type: MapLayerType;
  visible: boolean;
  opacity: number;
  label: string;
}

// ============================================================
// Date Selection
// ============================================================

export interface StormDate {
  date: string;
  label: string;
  eventCount: number;
  maxHailInches: number;
  maxWindMph: number;
  statesAffected: string[];
}

export type CanvassPriority = 'Knock now' | 'Monitor' | 'Low';
export type CanvassStopStatus = 'queued' | 'visited' | 'completed';
export type CanvassOutcome =
  | 'none'
  | 'no_answer'
  | 'interested'
  | 'follow_up'
  | 'inspection_booked';

export interface CanvassRouteStop {
  id: string;
  propertyLabel: string;
  stormDate: string;
  stormLabel: string;
  lat: number;
  lng: number;
  locationLabel: string;
  sourceEventId: string | null;
  sourceLabel: string;
  topHailInches: number;
  reportCount: number;
  evidenceCount: number;
  priority: CanvassPriority;
  status: CanvassStopStatus;
  outcome: CanvassOutcome;
  notes: string;
  createdAt: string;
  updatedAt: string;
  visitedAt?: string | null;
  completedAt?: string | null;
}

// ============================================================
// Search
// ============================================================

export interface SearchResult {
  address: string;
  lat: number;
  lng: number;
  placeId: string;
  viewport?: BoundingBox | null;
  resultType: SearchResultType;
}

export interface PropertySearchSummary {
  locationLabel: string;
  resultType: SearchResultType;
  radiusMiles: number;
  historyPreset: HistoryRangePreset;
  sinceDate: string | null;
}

export interface EventFilterState {
  hail: boolean;
  wind: boolean;
}

export interface PinnedProperty {
  id: string;
  locationLabel: string;
  lat: number;
  lng: number;
  resultType: SearchResultType;
  radiusMiles: number;
  historyPreset: HistoryRangePreset;
  sinceDate: string | null;
  stormDateCount: number;
  latestStormDate: string | null;
  latestMaxHailInches: number;
  createdAt: string;
  updatedAt: string;
}

export type EvidenceKind = 'upload' | 'provider-query';
export type EvidenceProvider = 'upload' | 'youtube' | 'flickr';
export type EvidenceMediaType = 'image' | 'video' | 'link';
export type EvidenceStatus = 'pending' | 'approved';

export interface EvidenceItem {
  id: string;
  kind: EvidenceKind;
  provider: EvidenceProvider;
  mediaType: EvidenceMediaType;
  propertyLabel: string;
  stormDate: string | null;
  title: string;
  notes?: string;
  externalUrl?: string;
  thumbnailUrl?: string | null;
  publishedAt?: string | null;
  fileName?: string;
  mimeType?: string;
  sizeBytes?: number;
  blob?: Blob;
  createdAt: string;
  updatedAt: string;
  status: EvidenceStatus;
  includeInReport: boolean;
}

export interface ReportEvidenceItem {
  id: string;
  provider: EvidenceProvider;
  mediaType: EvidenceMediaType;
  title: string;
  stormDate: string | null;
  notes?: string;
  externalUrl?: string;
  thumbnailUrl?: string | null;
  publishedAt?: string | null;
  imageDataUrl?: string | null;
  fileName?: string;
  mimeType?: string;
}

// ============================================================
// App State
// ============================================================

export interface AppState {
  /** Currently selected storm date */
  selectedDate: StormDate | null;
  /** Map center position */
  mapCenter: LatLng;
  /** Map zoom level */
  mapZoom: number;
  /** Active map layers */
  layers: MapLayerConfig[];
  /** Current GPS position (null if not tracking) */
  gpsPosition: GpsPosition | null;
  /** Whether GPS tracking is active */
  gpsTracking: boolean;
  /** Current canvassing alert status */
  canvassingAlert: CanvassingAlert | null;
  /** Loaded storm events for current date */
  stormEvents: StormEvent[];
  /** Loading state */
  isLoading: boolean;
  /** Error message */
  error: string | null;
}

// ============================================================
// Hail Size Reference Data
// ============================================================

export const HAIL_SIZE_CLASSES: HailSizeClass[] = [
  { minInches: 0.25, maxInches: 0.75, label: 'Pea to Penny', reference: 'pea', color: '#00FF00', damageSeverity: 0 },
  { minInches: 0.75, maxInches: 1.0, label: 'Penny to Quarter', reference: 'penny', color: '#FFFF00', damageSeverity: 1 },
  { minInches: 1.0, maxInches: 1.5, label: 'Quarter to Ping Pong', reference: 'quarter', color: '#FFA500', damageSeverity: 2 },
  { minInches: 1.5, maxInches: 1.75, label: 'Ping Pong to Golf Ball', reference: 'ping-pong', color: '#FF6600', damageSeverity: 3 },
  { minInches: 1.75, maxInches: 2.5, label: 'Golf Ball to Tennis Ball', reference: 'golf-ball', color: '#FF0000', damageSeverity: 4 },
  { minInches: 2.5, maxInches: 4.5, label: 'Tennis Ball to Softball', reference: 'tennis-ball', color: '#8B0000', damageSeverity: 5 },
  { minInches: 4.5, maxInches: 99, label: 'Softball+', reference: 'softball', color: '#800080', damageSeverity: 5 },
];

/**
 * Get the hail size class for a given diameter in inches.
 */
export function getHailSizeClass(inches: number): HailSizeClass | null {
  return HAIL_SIZE_CLASSES.find(
    (cls) => inches >= cls.minInches && inches < cls.maxInches
  ) ?? null;
}

export function getStormCanvassPriority(
  stormDate: StormDate,
  evidenceCount: number,
): CanvassPriority {
  if (
    stormDate.maxHailInches >= 1.5 ||
    stormDate.maxWindMph >= 60 ||
    evidenceCount >= 2
  ) {
    return 'Knock now';
  }

  if (stormDate.maxHailInches >= 1 || stormDate.eventCount >= 5) {
    return 'Monitor';
  }

  return 'Low';
}
