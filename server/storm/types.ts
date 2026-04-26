/**
 * Server-side storm types — kept narrow on purpose so this module can be
 * imported from both the API routes and ad-hoc scripts without dragging in
 * the frontend type tree.
 */

export interface BoundingBox {
  north: number;
  south: number;
  east: number;
  west: number;
}

export interface WindReport {
  id: string;
  /** ISO 8601 timestamp (UTC). */
  time: string;
  lat: number;
  lng: number;
  /** Gust speed in mph. */
  gustMph: number;
  source: 'SPC' | 'IEM-LSR' | 'NWS-SVR';
  state?: string;
  county?: string;
  description?: string;
}

export interface WindBandFeature {
  type: 'Feature';
  properties: {
    /** 0-based band index (0=lowest threshold). */
    level: number;
    minMph: number;
    maxMph: number;
    label: string;
    color: string;
    severity: 'breezy' | 'damaging' | 'severe' | 'very_severe' | 'extreme';
    reportCount: number;
  };
  geometry: {
    type: 'MultiPolygon';
    coordinates: number[][][][];
  };
}

export interface WindBandCollection {
  type: 'FeatureCollection';
  features: WindBandFeature[];
  metadata: {
    date: string;
    bounds: BoundingBox;
    reportCount: number;
    maxGustMph: number;
    sources: string[];
    generatedAt: string;
    /** Whether this is sourced from same-day/recent SPC vs older archive. */
    freshness: 'live' | 'archive' | 'mixed';
  };
}

export interface WindBandLevel {
  minMph: number;
  maxMph: number;
  label: string;
  color: string;
  severity: WindBandFeature['properties']['severity'];
}

/**
 * Insurance-relevant wind damage thresholds, calibrated to roof/siding claim
 * patterns in VA/MD/PA. Bands are exclusive on the upper bound except the top.
 */
export const WIND_BAND_LEVELS: WindBandLevel[] = [
  { minMph: 50, maxMph: 58, label: '50–57 mph', color: '#FFEB99', severity: 'breezy' },
  { minMph: 58, maxMph: 65, label: '58–64 mph', color: '#FFCC33', severity: 'damaging' },
  { minMph: 65, maxMph: 75, label: '65–74 mph', color: '#FF8800', severity: 'severe' },
  { minMph: 75, maxMph: 90, label: '75–89 mph', color: '#FF3300', severity: 'very_severe' },
  { minMph: 90, maxMph: 999, label: '90 mph+', color: '#990033', severity: 'extreme' },
];

/** Max gust → band index (returns highest-applicable band). */
export function getWindBand(mph: number): WindBandLevel | null {
  if (!Number.isFinite(mph) || mph < WIND_BAND_LEVELS[0].minMph) return null;
  for (const band of WIND_BAND_LEVELS) {
    if (mph >= band.minMph && mph < band.maxMph) return band;
  }
  return WIND_BAND_LEVELS[WIND_BAND_LEVELS.length - 1];
}
