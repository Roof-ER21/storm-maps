/**
 * Wind swath service — converts wind report point data (SPC, IEM LSR, NWS SVR
 * centroids) into per-band MultiPolygon collections for the frontend
 * `WindSwathLayer` to render.
 *
 * Algorithm (production grade for VA/MD/PA at MVP):
 *   1. Pull wind reports for the requested date from SPC + IEM LSR, plus
 *      active NWS SVR centroids when in live mode.
 *   2. Filter to the requested bbox (with 30-mile pad).
 *   3. For each band threshold (50/58/65/75/90 mph), collect every report
 *      whose gust meets-or-exceeds that band, buffer each by a gust-aware
 *      radius (1.5 mi for 50 mph → 4 mi for 90+ mph), and emit them as a
 *      MultiPolygon.
 *   4. Cache results in-memory (24h for archive, 5 min for live).
 *
 * Insurance-grade footprint sizing:
 *   - Mid-Atlantic squall lines typically produce damaging wind swaths
 *     ~2–6 miles wide on either side of a measured gust report. The buffer
 *     radii here are calibrated to that — slightly conservative on the high
 *     bands so the "Direct Hit 75 mph" badge doesn't false-positive.
 */

import { fetchSpcWindReports } from './spcReports.js';
import { fetchIemWindReports } from './iemLsr.js';
import { fetchActiveSvrPolygons, svrPolygonsAsReports } from './nwsAlerts.js';
import { bufferCircle, expandBounds } from './geometry.js';
import { getCachedSwath, setCachedSwath } from './cache.js';
import {
  WIND_BAND_LEVELS,
  type BoundingBox,
  type WindBandCollection,
  type WindBandFeature,
  type WindReport,
} from './types.js';

interface WindSwathRequest {
  date: string;
  bounds: BoundingBox;
  /** Restrict IEM fetch to specific states (e.g. ["VA","MD","PA"]). */
  states?: string[];
  /** Include active NWS SVR polygon centroids (live mode). */
  includeLive?: boolean;
  /**
   * Optional time-of-day slice. When both are set, only reports whose
   * timestamps fall inside [windowStartIso, windowEndIso] are bucketed
   * into the band features. Used by the storm timeline scrubber so each
   * radar frame has its corresponding wind dots.
   */
  windowStartIso?: string;
  windowEndIso?: string;
}

/**
 * In-process LRU layer in front of the Postgres swath_cache so back-to-back
 * requests for the same date+bbox don't even hit the DB. Kept tiny because
 * each entry can be ~100 KB of GeoJSON.
 */
interface CacheEntry {
  expiresAt: number;
  data: WindBandCollection;
}

const memoryCache = new Map<string, CacheEntry>();
const MEMORY_CACHE_MAX = 64;
const ARCHIVE_MEMORY_TTL_MS = 60 * 60 * 1000;
const LIVE_MEMORY_TTL_MS = 5 * 60 * 1000;

function bufferMilesForGust(mph: number): number {
  if (mph >= 90) return 4.0;
  if (mph >= 75) return 3.2;
  if (mph >= 65) return 2.5;
  if (mph >= 58) return 2.0;
  return 1.5;
}

function cacheKey(req: WindSwathRequest): string {
  const b = req.bounds;
  const states = (req.states ?? []).slice().sort().join(',');
  const window =
    req.windowStartIso && req.windowEndIso
      ? `${req.windowStartIso}-${req.windowEndIso}`
      : 'full';
  return [
    req.date,
    b.north.toFixed(3),
    b.south.toFixed(3),
    b.east.toFixed(3),
    b.west.toFixed(3),
    states,
    req.includeLive ? 'live' : 'static',
    window,
  ].join('|');
}

function dedupeReports(reports: WindReport[]): WindReport[] {
  // Two reports within 0.5 mi and 30 minutes are treated as the same gust.
  const out: WindReport[] = [];
  const sorted = [...reports].sort(
    (a, b) => new Date(a.time).getTime() - new Date(b.time).getTime(),
  );
  for (const r of sorted) {
    const t = new Date(r.time).getTime();
    const dup = out.find((existing) => {
      const dt = Math.abs(new Date(existing.time).getTime() - t);
      if (dt > 30 * 60 * 1000) return false;
      const milesPerLat = 69;
      const milesPerLng =
        69 * Math.max(0.05, Math.cos((existing.lat * Math.PI) / 180));
      const dx = (r.lng - existing.lng) * milesPerLng;
      const dy = (r.lat - existing.lat) * milesPerLat;
      return Math.hypot(dx, dy) < 0.5;
    });
    if (dup) {
      // Prefer the higher gust value.
      if (r.gustMph > dup.gustMph) {
        dup.gustMph = r.gustMph;
        dup.description = r.description ?? dup.description;
        dup.source = r.source;
      }
      continue;
    }
    out.push({ ...r });
  }
  return out;
}

function buildBandFeatures(reports: WindReport[]): WindBandFeature[] {
  return WIND_BAND_LEVELS.map((band, level) => {
    const inBand = reports.filter(
      (r) => r.gustMph >= band.minMph && r.gustMph < band.maxMph,
    );
    // Each higher-or-equal report also contributes to lower bands' MultiPolygon
    // (so the ≥50 mph swath visually contains the ≥75 mph swath). Build the
    // "≥minMph" footprint, not just the strict-band one.
    const cumulative = reports.filter((r) => r.gustMph >= band.minMph);
    const polygons: number[][][][] = [];
    for (const r of cumulative) {
      const radius = bufferMilesForGust(r.gustMph);
      const ring = bufferCircle(r.lat, r.lng, radius, 28);
      polygons.push([ring]);
    }
    const feature: WindBandFeature = {
      type: 'Feature',
      properties: {
        level,
        minMph: band.minMph,
        maxMph: band.maxMph,
        label: band.label,
        color: band.color,
        severity: band.severity,
        reportCount: inBand.length,
      },
      geometry: {
        type: 'MultiPolygon',
        coordinates: polygons,
      },
    };
    return feature;
  }).filter((f) => f.geometry.coordinates.length > 0);
}

function inBounds(r: WindReport, bounds: BoundingBox): boolean {
  return (
    r.lat <= bounds.north &&
    r.lat >= bounds.south &&
    r.lng <= bounds.east &&
    r.lng >= bounds.west
  );
}

export async function buildWindSwathCollection(
  req: WindSwathRequest,
): Promise<WindBandCollection> {
  const key = cacheKey(req);
  const now = Date.now();

  // L1 — in-process memory cache.
  const memHit = memoryCache.get(key);
  if (memHit && memHit.expiresAt > now) {
    return memHit.data;
  }

  // L2 — Postgres swath_cache. Survives restarts and lets multiple replicas
  // share the result of a single 30s GRIB+CSV decode.
  const dbHit = await getCachedSwath<WindBandCollection>({
    source: req.includeLive ? 'wind-live' : 'wind-archive',
    date: req.date,
    bounds: req.bounds,
  });
  if (dbHit) {
    memoryCache.set(key, {
      expiresAt: now + (req.includeLive ? LIVE_MEMORY_TTL_MS : ARCHIVE_MEMORY_TTL_MS),
      data: dbHit.payload,
    });
    enforceMemoryCacheCap();
    return dbHit.payload;
  }

  const padded = expandBounds(req.bounds, 30);
  const sources: string[] = [];

  const [spcReports, iemReports, livePolys] = await Promise.all([
    fetchSpcWindReports(req.date).catch(() => []),
    fetchIemWindReports({
      date: req.date,
      bounds: padded,
      states: req.states,
    }).catch(() => []),
    req.includeLive
      ? fetchActiveSvrPolygons({ bounds: padded }).catch(() => [])
      : Promise.resolve([]),
  ]);

  if (spcReports.length > 0) sources.push('SPC');
  if (iemReports.length > 0) sources.push('IEM-LSR');
  if (livePolys.length > 0) sources.push('NWS-SVR');

  const liveCentroids = svrPolygonsAsReports(livePolys);
  const all = [...spcReports, ...iemReports, ...liveCentroids].filter(
    (r) => Number.isFinite(r.gustMph) && r.gustMph >= WIND_BAND_LEVELS[0].minMph,
  );
  // Optional time slice — drives the storm timeline scrubber.
  const windowStart =
    req.windowStartIso ? Date.parse(req.windowStartIso) : Number.NaN;
  const windowEnd =
    req.windowEndIso ? Date.parse(req.windowEndIso) : Number.NaN;
  const hasWindow = Number.isFinite(windowStart) && Number.isFinite(windowEnd);

  const inFrame = all
    .filter((r) => inBounds(r, padded))
    .filter((r) => {
      if (!hasWindow) return true;
      const t = Date.parse(r.time);
      if (Number.isNaN(t)) return false;
      return t >= windowStart && t <= windowEnd;
    });
  const deduped = dedupeReports(inFrame);

  const features = buildBandFeatures(deduped);
  const maxGustMph = deduped.reduce((m, r) => Math.max(m, r.gustMph), 0);

  const collection: WindBandCollection = {
    type: 'FeatureCollection',
    features,
    metadata: {
      date: req.date,
      bounds: req.bounds,
      reportCount: deduped.length,
      maxGustMph,
      sources,
      generatedAt: new Date().toISOString(),
      freshness: req.includeLive
        ? 'live'
        : sources.length > 0
          ? 'archive'
          : 'archive',
    },
  };

  memoryCache.set(key, {
    expiresAt: now + (req.includeLive ? LIVE_MEMORY_TTL_MS : ARCHIVE_MEMORY_TTL_MS),
    data: collection,
  });
  enforceMemoryCacheCap();

  // Fire-and-forget DB write. We don't await it — the response goes back to
  // the client first and the cache populates in the background.
  void setCachedSwath({
    source: req.includeLive ? 'wind-live' : 'wind-archive',
    date: req.date,
    bounds: req.bounds,
    payload: collection,
    metadata: {
      sources,
      reportCount: deduped.length,
      states: req.states ?? [],
    },
    featureCount: features.length,
    maxValue: maxGustMph,
  });

  return collection;
}

function enforceMemoryCacheCap(): void {
  while (memoryCache.size > MEMORY_CACHE_MAX) {
    const oldestKey = memoryCache.keys().next().value;
    if (!oldestKey) break;
    memoryCache.delete(oldestKey);
  }
}

/**
 * Point-in-polygon impact check for a list of property coordinates against the
 * stored band collection. Used by the AddressImpactBadge "wind hit?" lookup.
 */
export interface WindImpactInput {
  date: string;
  bounds: BoundingBox;
  states?: string[];
  includeLive?: boolean;
  points: Array<{ id: string; lat: number; lng: number }>;
}

export interface WindImpactResult {
  id: string;
  maxGustMph: number | null;
  level: number | null;
  color: string | null;
  label: string | null;
  severity: string | null;
  directHit: boolean;
}

export interface WindImpactResponse {
  date: string;
  metadata: {
    stormMaxMph: number;
    reportCount: number;
    pointsChecked: number;
    directHits: number;
  };
  results: WindImpactResult[];
}

import { pointInRing } from './geometry.js';

export async function buildWindImpactResponse(
  req: WindImpactInput,
): Promise<WindImpactResponse> {
  const collection = await buildWindSwathCollection({
    date: req.date,
    bounds: req.bounds,
    states: req.states,
    includeLive: req.includeLive,
  });
  const results: WindImpactResult[] = [];
  let directHits = 0;

  for (const pt of req.points) {
    let bestLevel = -1;
    let bestBand: { color: string; label: string; severity: string; minMph: number; maxMph: number } | null = null;

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
          color: feature.properties.color,
          label: feature.properties.label,
          severity: feature.properties.severity,
          minMph: feature.properties.minMph,
          maxMph: feature.properties.maxMph,
        };
      }
    }

    if (bestBand && bestLevel >= 0) {
      directHits += 1;
      results.push({
        id: pt.id,
        maxGustMph: bestBand.minMph,
        level: bestLevel,
        color: bestBand.color,
        label: bestBand.label,
        severity: bestBand.severity,
        directHit: true,
      });
    } else {
      results.push({
        id: pt.id,
        maxGustMph: null,
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
      stormMaxMph: collection.metadata.maxGustMph,
      reportCount: collection.metadata.reportCount,
      pointsChecked: req.points.length,
      directHits,
    },
    results,
  };
}
