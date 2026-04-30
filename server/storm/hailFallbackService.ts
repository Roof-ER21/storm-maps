/**
 * Hail polygon fallback — emits IHM-style 13-band MultiPolygon collections
 * built from SPC + IEM hail point reports, *without* requiring the MRMS
 * GRIB2 pipeline that lives in the Susan21 field-assistant backend.
 *
 * Why a fallback:
 *   The Susan21 service has a real MESH GRIB decoder + d3-contour pipeline
 *   that produces the crispest possible swaths. But it's a single point of
 *   failure, and the cold path can take 30s on first decode of an old date.
 *   This module makes sure the standalone app can still serve usable hail
 *   polygons when Susan21 is unavailable, slow, or returns an empty result.
 *
 * Algorithm (same shape as the wind swath service):
 *   1. Pull SPC same-day/yesterday/archive hail CSVs + IEM LSR hail GeoJSON.
 *   2. Filter to the requested bbox (with 30 mi pad).
 *   3. Bucket each report into the 13 IHM hail bands (⅛"–3"+).
 *   4. For each band, buffer every report at-or-above that band into a
 *      gust-aware disk; emit them as a MultiPolygon (cumulative bands so the
 *      ≥½" swath visually contains the ≥1½" swath, matching IHM behavior).
 *   5. Cache via the shared swath_cache wrapper so the second lookup is <50 ms.
 */

import type { HailPointReport } from './spcHailReports.js';
import { fetchIemHailReports } from './iemHailReports.js';
import { bufferCircle, expandBounds } from './geometry.js';
import { getCachedSwath, setCachedSwath } from './cache.js';
import type { BoundingBox } from './types.js';
import { sql as pgSql } from '../db.js';

interface VerifiedHailRow {
  lat: number;
  lng: number;
  hail_size_inches: number | null;
  magnitude: number | null;
  source_ncei_storm_events: boolean | null;
  source_spc_hail: boolean | null;
  source_mping: boolean | null;
  source_iem_lsr: boolean | null;
  state_code: string | null;
  county: string | null;
  narrative: string | null;
}

// IHM-matched 13 hail bands. Mirrors src/types/ihmHailLevels.ts so the
// frontend Legend renders exactly the same color/label set.
export interface IhmHailLevel {
  sizeInches: number;
  sizeMm: number;
  label: string;
  color: string;
  severity: 'trace' | 'minor' | 'moderate' | 'severe' | 'very_severe' | 'extreme';
}

// Keep palette in sync with src/types/ihmHailLevels.ts. Backend embeds these
// colors into the GeoJSON features so the frontend doesn't need a separate
// color lookup pass. Updated to the refined chromatic progression (less
// near-white wash on traces, cleaner reds and purples on severe).
export const IHM_HAIL_LEVELS: IhmHailLevel[] = [
  { sizeInches: 0.13, sizeMm: 3.3, label: '⅛"', color: '#FEF3B0', severity: 'trace' },
  { sizeInches: 0.25, sizeMm: 6.35, label: '¼"', color: '#FDE68A', severity: 'trace' },
  { sizeInches: 0.38, sizeMm: 9.53, label: '⅜"', color: '#FCD34D', severity: 'trace' },
  { sizeInches: 0.5, sizeMm: 12.7, label: '½"', color: '#FBBF24', severity: 'trace' },
  { sizeInches: 0.75, sizeMm: 19.05, label: '¾"', color: '#F59E0B', severity: 'minor' },
  { sizeInches: 1.0, sizeMm: 25.4, label: '1"', color: '#F97316', severity: 'moderate' },
  { sizeInches: 1.25, sizeMm: 31.75, label: '1¼"', color: '#EA580C', severity: 'moderate' },
  { sizeInches: 1.5, sizeMm: 38.1, label: '1½"', color: '#DC2626', severity: 'severe' },
  { sizeInches: 1.75, sizeMm: 44.45, label: '1¾"', color: '#B91C1C', severity: 'severe' },
  { sizeInches: 2.0, sizeMm: 50.8, label: '2"', color: '#BE185D', severity: 'very_severe' },
  { sizeInches: 2.25, sizeMm: 57.15, label: '2¼"', color: '#9D174D', severity: 'very_severe' },
  { sizeInches: 2.5, sizeMm: 63.5, label: '2½"', color: '#7C2D92', severity: 'extreme' },
  { sizeInches: 3.0, sizeMm: 76.2, label: '3"+', color: '#5B21B6', severity: 'extreme' },
];

export interface HailFallbackFeature {
  type: 'Feature';
  properties: {
    level: number;
    sizeInches: number;
    sizeMm: number;
    label: string;
    color: string;
    severity: IhmHailLevel['severity'];
    reportCount: number;
  };
  geometry: {
    type: 'MultiPolygon';
    coordinates: number[][][][];
  };
}

export interface HailFallbackCollection {
  type: 'FeatureCollection';
  features: HailFallbackFeature[];
  metadata: {
    date: string;
    bounds: BoundingBox;
    reportCount: number;
    maxHailInches: number;
    sources: string[];
    generatedAt: string;
    source: 'in-repo-fallback';
  };
}

interface BuildHailFallbackParams {
  date: string;
  bounds: BoundingBox;
  states?: string[];
}

/** Larger hail spreads damage farther from the observed point. */
function bufferMilesForHail(inches: number): number {
  if (inches >= 2.5) return 4.0;
  if (inches >= 1.75) return 3.2;
  if (inches >= 1.25) return 2.6;
  if (inches >= 1.0) return 2.2;
  if (inches >= 0.75) return 1.8;
  return 1.5;
}

function dedupeReports(reports: HailPointReport[]): HailPointReport[] {
  // Same dedupe rule as elsewhere — 0.5 mi + 30 min collapses cross-source
  // reports of the same hail core; keep the larger reported size.
  const sorted = [...reports].sort(
    (a, b) => Date.parse(a.time) - Date.parse(b.time),
  );
  const out: HailPointReport[] = [];
  for (const r of sorted) {
    const t = Date.parse(r.time);
    const dup = out.find((existing) => {
      const dt = Math.abs(Date.parse(existing.time) - t);
      if (dt > 30 * 60 * 1000) return false;
      const milesPerLat = 69;
      const milesPerLng =
        69 * Math.max(0.05, Math.cos((existing.lat * Math.PI) / 180));
      const dx = (r.lng - existing.lng) * milesPerLng;
      const dy = (r.lat - existing.lat) * milesPerLat;
      return Math.hypot(dx, dy) < 0.5;
    });
    if (dup) {
      if (r.sizeInches > dup.sizeInches) {
        dup.sizeInches = r.sizeInches;
        dup.description = r.description ?? dup.description;
      }
      continue;
    }
    out.push({ ...r });
  }
  return out;
}

function inBounds(r: HailPointReport, bounds: BoundingBox): boolean {
  return (
    r.lat <= bounds.north &&
    r.lat >= bounds.south &&
    r.lng <= bounds.east &&
    r.lng >= bounds.west
  );
}

function buildBandFeatures(reports: HailPointReport[]): HailFallbackFeature[] {
  const features: HailFallbackFeature[] = [];

  for (let level = 0; level < IHM_HAIL_LEVELS.length; level += 1) {
    const band = IHM_HAIL_LEVELS[level];
    const cumulative = reports.filter((r) => r.sizeInches >= band.sizeInches);
    if (cumulative.length === 0) continue;

    const polygons: number[][][][] = [];
    for (const r of cumulative) {
      const radius = bufferMilesForHail(r.sizeInches);
      const ring = bufferCircle(r.lat, r.lng, radius, 28);
      polygons.push([ring]);
    }

    const inBand = reports.filter(
      (r) =>
        r.sizeInches >= band.sizeInches &&
        (level === IHM_HAIL_LEVELS.length - 1 ||
          r.sizeInches < IHM_HAIL_LEVELS[level + 1].sizeInches),
    );

    features.push({
      type: 'Feature',
      properties: {
        level,
        sizeInches: band.sizeInches,
        sizeMm: band.sizeMm,
        label: band.label,
        color: band.color,
        severity: band.severity,
        reportCount: inBand.length,
      },
      geometry: { type: 'MultiPolygon', coordinates: polygons },
    });
  }

  return features;
}

export async function buildHailFallbackCollection(
  req: BuildHailFallbackParams,
): Promise<HailFallbackCollection> {
  // L2 — Postgres swath_cache. Survives restarts.
  const dbHit = await getCachedSwath<HailFallbackCollection>({
    source: 'mrms-hail',
    date: req.date,
    bounds: req.bounds,
  });
  if (dbHit) {
    // The cached payload may have been written by either the real MRMS
    // pipeline or this fallback — both share the IHM-13-band shape, so
    // either way the frontend renders cleanly.
    return dbHit.payload;
  }

  const padded = expandBounds(req.bounds, 30);
  const sources: string[] = [];

  // 1. Fetch live IEM LSR reports.
  const iemReports = await fetchIemHailReports({
    date: req.date,
    bounds: padded,
    states: req.states,
  }).catch(() => []);

  if (iemReports.length > 0) sources.push('IEM LSR');

  // 2. Fetch archived verified ground reports (Bug 1 Enhancement).
  // This pulls from federal ground sources already in our DB, capturing
  // historical dates that the live LSR feed may have rolled off.
  let archiveReports: HailPointReport[] = [];
  try {
    const rows = await pgSql<VerifiedHailRow[]>`
      SELECT lat, lng, hail_size_inches, magnitude,
             source_ncei_storm_events, source_mping,
             source_iem_lsr, source_nws_warnings,
             state_code, county, narrative
        FROM verified_hail_events
       WHERE event_date = ${req.date}::date
         AND lat BETWEEN ${padded.south} AND ${padded.north}
         AND lng BETWEEN ${padded.west} AND ${padded.east}
         AND (
           source_ncei_storm_events = TRUE
           OR source_mping = TRUE
           OR source_iem_lsr = TRUE
           OR source_nws_warnings = TRUE
         )
    `;
    archiveReports = rows.map((row, idx) => {
      let sourceLabel = 'Verified Archive';
      if (row.source_ncei_storm_events) sourceLabel = 'NCEI Storm Events';
      else if (row.source_iem_lsr) sourceLabel = 'IEM LSR';
      else if (row.source_nws_warnings) sourceLabel = 'NWS Warning';

      return {
        id: `arch-h-${req.date}-${idx}`,
        time: req.date,
        lat: row.lat,
        lng: row.lng,
        sizeInches: row.hail_size_inches ?? row.magnitude ?? 0.5,
        source: sourceLabel,
        state: row.state_code ?? undefined,
        county: row.county ?? undefined,
        description: row.narrative ?? undefined,
      };
    });
    if (archiveReports.length > 0) sources.push('Verified Archive');
  } catch (err) {
    console.warn('[hail-fallback] DB archive fetch failed:', err);
  }

  const all = [...iemReports, ...archiveReports]
    .filter((r) => Number.isFinite(r.sizeInches) && r.sizeInches > 0)
    .filter((r) => inBounds(r, padded));
  const deduped = dedupeReports(all);

  const features = buildBandFeatures(deduped);
  const maxHailInches = deduped.reduce((m, r) => Math.max(m, r.sizeInches), 0);

  const collection: HailFallbackCollection = {
    type: 'FeatureCollection',
    features,
    metadata: {
      date: req.date,
      bounds: req.bounds,
      reportCount: deduped.length,
      maxHailInches,
      sources: [...new Set(sources)],
      generatedAt: new Date().toISOString(),
      source: 'in-repo-fallback',
    },
  };

  // Fire-and-forget cache write. Skip empty results — same rationale as
  // windSwathService: caching negative results just bloats the table.
  if (features.length > 0) {
    void setCachedSwath({
      source: 'mrms-hail',
      date: req.date,
      bounds: req.bounds,
      payload: collection,
      metadata: {
        sources,
        reportCount: deduped.length,
        maxHailInches,
        origin: 'in-repo-fallback',
      },
      featureCount: features.length,
      maxValue: maxHailInches,
    });
  }

  return collection;
}

/**
 * Point-in-polygon impact lookup mirroring the wind impact endpoint shape.
 * Used by the AddressImpactBadge "DIRECT HIT 1.75"" badge when the Susan21
 * /api/hail/storm-impact endpoint isn't available.
 */
export interface HailImpactInput {
  date: string;
  bounds: BoundingBox;
  states?: string[];
  points: Array<{ id: string; lat: number; lng: number }>;
}

export interface HailImpactResult {
  id: string;
  maxHailInches: number | null;
  level: number | null;
  color: string | null;
  label: string | null;
  severity: string | null;
  directHit: boolean;
}

export interface HailImpactResponse {
  date: string;
  metadata: {
    stormMaxInches: number;
    reportCount: number;
    pointsChecked: number;
    directHits: number;
  };
  results: HailImpactResult[];
}

import { pointInRing } from './geometry.js';

export async function buildHailImpactResponse(
  req: HailImpactInput,
): Promise<HailImpactResponse> {
  const collection = await buildHailFallbackCollection({
    date: req.date,
    bounds: req.bounds,
    states: req.states,
  });

  const results: HailImpactResult[] = [];
  let directHits = 0;

  for (const pt of req.points) {
    let bestLevel = -1;
    let bestBand: {
      sizeInches: number;
      color: string;
      label: string;
      severity: string;
    } | null = null;

    for (const feature of collection.features) {
      const idx = feature.properties.level;
      if (idx <= bestLevel) continue;
      let inside = false;
      for (const polygon of feature.geometry.coordinates) {
        if (polygon.length === 0) continue;
        if (pointInRing(pt.lat, pt.lng, polygon[0])) {
          inside = true;
          break;
        }
      }
      if (inside) {
        bestLevel = idx;
        bestBand = {
          sizeInches: feature.properties.sizeInches,
          color: feature.properties.color,
          label: feature.properties.label,
          severity: feature.properties.severity,
        };
      }
    }

    if (bestBand && bestLevel >= 0) {
      directHits += 1;
      results.push({
        id: pt.id,
        maxHailInches: bestBand.sizeInches,
        level: bestLevel,
        color: bestBand.color,
        label: bestBand.label,
        severity: bestBand.severity,
        directHit: true,
      });
    } else {
      results.push({
        id: pt.id,
        maxHailInches: null,
        level: null,
        color: null,
        label: null,
        severity: null,
        directHit: false,
      });
    }
  }

  return {
    date: req.date,
    metadata: {
      stormMaxInches: collection.metadata.maxHailInches,
      reportCount: collection.metadata.reportCount,
      pointsChecked: req.points.length,
      directHits,
    },
    results,
  };
}
