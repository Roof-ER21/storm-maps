/**
 * Address-impact computation. Given lat/lng, finds every event whose hail or
 * wind swath contains/borders the point, augments with sources/grounds/
 * surface obs, and classifies each hit into a 4-tier impact label.
 *
 * Algorithm lifted from Hail Yes (storm-maps/server/storm/mrmsService.ts) +
 * the `feedback_direct-hit-ground-truth.md` rule from session memory:
 *
 *   direct_hit  — property INSIDE the MRMS swath polygon (≥¼" band)
 *                 OR a federal ground report (NCEI/SWDI/IEM) within 1mi
 *                 has hail ≥½" — i.e. radar missed but a verified ground
 *                 observation didn't.
 *   near_miss   — property within 0.5mi of any swath edge (≥¼" band).
 *                 Verisk/ISO "At Property" zone, equivalent to a confirming
 *                 point report within 1mi. Still claim-worthy.
 *   area_impact — property within 0.5–10mi of a swath. Context only.
 *   no_impact   — no swath within 10mi.
 *
 * Per-band distance buckets mirror Hail Yes's PDF column layout:
 *   atProperty:  inside polygon
 *   mi1to3:      0.5 < d ≤ 3.0
 *   mi3to5:      3.0 < d ≤ 5.0
 *   mi5to10:     5.0 < d ≤ 10.0
 */
import type { Sql } from "../db.js";
import {
  pointInRing,
  haversineMiles,
  nearestRingDistanceMiles,
} from "@storm-archive/geometry";
import { lookupCounty } from "./geocode.js";

// Distance buckets for impact bands — Hail Yes column layout exactly:
//   At Location:  edge ≤ 0.9 mi (or polygon-containment)
//   Within 1mi:   1.0 ≤ edge ≤ 2.5 mi
//   Within 3mi:   3.0 ≤ edge ≤ 5.0 mi
//   Within 10mi:  5.0 < edge ≤ 10.0 mi
// Gaps at 0.9-1.0 and 2.5-3.0 are intentional — match Hail Yes labels.
const AT_LOCATION_MAX = 0.9;
const WITHIN_1MI_MIN = 1.0;
const WITHIN_1MI_MAX = 2.5;
const WITHIN_3MI_MIN = 3.0;
const WITHIN_3MI_MAX = 5.0;
const WITHIN_10MI_MAX = 10.0;
const TRACE_FLOOR = 0.25;
const HALF_INCH = 0.5;

// Tier-upgrade source classes. Federal observers are independent enough
// to solo-upgrade a near-miss to a direct hit. HailTrace meteo (a
// meteorologist-reviewed report) can upgrade only when a second source
// agrees — its claim alone shouldn't overrule the radar polygon.
// HailTrace algo + IHM never solo-upgrade; they count only as the
// "second source" that corroborates a meteo upgrade.
const FEDERAL_GROUND_SOURCES = new Set([
  "ncei_storm_events",
  "ncei_swdi",
  "iem_lsr",
]);
const VERIFIED_COMMERCIAL_SOURCES = new Set([
  "hailtrace_meteo",
]);
const CORROBORATING_SOURCES = new Set([
  "ncei_storm_events",
  "ncei_swdi",
  "iem_lsr",
  "hailtrace_meteo",
  "hailtrace_algo",
  "ihm",
]);
const FEDERAL_UPGRADE_RADIUS_MILES = 1.0;
const COMMERCIAL_UPGRADE_RADIUS_MILES = 1.0;
const CORROBORATION_RADIUS_MILES = 5.0;

interface SwathFeatureProps {
  level: number;
  sizeInches?: number;
  sizeMm?: number;
  minMph?: number;
  maxMph?: number;
  label: string;
  color: string;
  severity: string;
}

interface SwathFeature {
  type: "Feature";
  properties: SwathFeatureProps;
  geometry: { type: "MultiPolygon"; coordinates: number[][][][] };
}

interface SwathRow {
  id: number;
  event_id: number;
  kind: string;
  source: string;
  geojson: { features: SwathFeature[] };
}

export type ImpactTier = "direct_hit" | "near_miss" | "area_impact" | "no_impact";

/** Hail Yes-aligned distance bands (At Location / Within 1mi / Within 3mi / Within 10mi). */
export interface ImpactBands {
  atLocation: number | null;   // inside polygon OR edge ≤ 0.9 mi
  within1mi: number | null;    // edge in 1.0–2.5 mi
  within3mi: number | null;    // edge in 3.0–5.0 mi
  within10mi: number | null;   // edge in 5.0–10.0 mi
}

export type WindBands = ImpactBands;

export interface AtPropertyBand {
  label: string;
  color: string;
  severity: string;
  sizeInches?: number | null;
  minMph?: number | null;
}

export interface NearbyGroundReport {
  source: string;
  lat: number;
  lng: number;
  hail_size_inches: number | null;
  wind_mph: number | null;
  distance_miles: number;
  /** City name when the report is areal (e.g. IHM city centroids). UI
   *  renders this instead of distance for city-granularity sources so
   *  reps don't quote "0.42 mi" for what's actually a city-wide value. */
  city: string | null;
  /** Source-specific extras: HailTrace meteorologist photo URLs at the
   *  exact intersection where the meteorologist confirmed hail, plus
   *  the spotted location text. Adjuster-grade evidence. */
  photo_url?: string | null;
  photo_text?: string | null;
}

export interface ImpactHit {
  event_id: number;
  /** When consolidated across states, this lists every event_id. */
  event_ids?: number[];
  /** When consolidated, this is the comma-joined list of all states. */
  state: string;
  states?: string[];
  event_date: string;
  tier: number; // catalog tier 0-3 from peak hail
  peak_hail_inches: number | null;
  peak_wind_mph: number | null;
  evidence_sheet_url: string;

  /**
   * Adjuster-credible AT LOCATION value, calibrated against nearby commercial
   * sources (HailTrace meteo > algo > IHM city centroid). Falls back to
   * raw MRMS pixel when no commercial source within 5 mi corroborates.
   *
   * Why this exists: a single MRMS pixel reads as low as 0.25" because
   * MRMS bands are *cumulative lower bounds*, not point estimates — and
   * MRMS' MESH calibration runs colder than HailTrace's. A property
   * walking into an adjuster meeting with 0.25" looks weak even when
   * HailTrace's per-property report says 1.25". This blends the
   * radar pixel with the closest commercial signal, capped at MRMS
   * within-3mi (or 10mi when 3mi is null), floored at the raw pixel,
   * rounded to ¼".
   */
  hail_calibrated_at_location: number | null;

  /** 4-tier classification — primary signal for rep + adjuster. */
  impact_tier: ImpactTier;
  direct_hit: boolean; // tier === 'direct_hit' (kept for back-compat)
  /** Reason for direct_hit when ground-truth upgraded a near-miss. */
  upgrade_reason?: string;

  /** Polygon-containment band for hail (only set when truly inside). */
  hail_at_property: AtPropertyBand | null;
  /** Polygon-containment band for wind. */
  wind_at_property: AtPropertyBand | null;

  /** Distance breakdowns per the Hail Yes PDF column layout. */
  hail_bands: ImpactBands;
  wind_bands: WindBands;

  /** Distance (miles) to nearest swath edge of any hail size. */
  edge_distance_miles: number | null;
  /** Distance (miles) to nearest ≥½" hail edge. */
  edge_distance_half_inch_miles: number | null;

  sources: {
    ncei: boolean;
    swdi: boolean;
    iem: boolean;
    hailtrace: boolean;
    ihm: boolean;
  };
  source_records: Array<{
    source: string;
    peak_hail_inches: number | null;
    record_count: number | null;
    description: string;
  }>;
  ground_reports_nearby: NearbyGroundReport[];
  surface_obs: {
    stations_total: number;
    stations_with_hail_signal: number;
  };

  /**
   * Adjuster-grade federal citation block — same authoritative records
   * insurance carriers, federal courts, and FEMA all reference verbatim.
   * Surfaces in PDF + Detail panel as the legal-grade citation layer.
   */
  federal_citations: {
    ncei: Array<{
      event_id: string;
      wfo: string | null;
      narrative: string | null;
      event_type: string | null;
      hail_size_inches: number | null;
      wind_mph: number | null;
      distance_miles: number;
    }>;
    fema: Array<{
      disaster_number: number;
      state: string;
      county_name: string | null;
      designated_area: string;
      incident_type: string;
      declaration_title: string;
      declaration_date: string;
      incident_begin_date: string;
      incident_end_date: string | null;
    }>;
    pcs: Array<{
      cat_number: string;
      start_date: string;
      end_date: string;
      description: string;
      affected_states: string[];
    }>;
  };
}

export interface ImpactResponse {
  query: {
    address: string | null;
    lat: number;
    lng: number;
    normalized: string;
    geocode_provider: string | null;
  };
  hits: ImpactHit[];
  meta: {
    hits_count: number;
    direct_hits: number;
    near_misses: number;
    area_impacts: number;
    area_impacts_returned?: number;
    candidate_swaths_evaluated: number;
    query_ms: number;
  };
}

interface BandPick {
  label: string;
  color: string;
  severity: string;
  sizeInches: number | null;
  minMph: number | null;
  level: number;
}

interface PointInPolyResult {
  /** Highest band the point is INSIDE (strict containment, ≥¼" floor for hail). */
  bestBand: BandPick | null;
  /** Bucketed distance breakdowns. */
  hailBands: ImpactBands;
  windBands: WindBands;
  edgeAny: number;
  edgeHalfInch: number;
  // Helpful for tier classification
  hasNearEdge: boolean;
  hasAreaEdge: boolean;
}

/**
 * Single-pass evaluation against one swath GeoJSON FeatureCollection.
 *
 * Mirrors Hail Yes's two-pass approach (containment + edge-distance) but
 * fused so we walk features once. Produces the band breakdown the PDF
 * column layout expects.
 */
/**
 * Walk HailTrace's frozen-cache geoJSON for an event_date, return the
 * highest `hailSizeInches` of any ALGORITHM_HAIL_SIZE polygon that
 * contains the property. This is HailTrace's per-property algorithm
 * output — frozen during the paid-subscription window and used
 * permanently from local cache afterwards.
 */
interface HailtraceFeature {
  type?: string;
  properties?: { featureType?: string; hailSizeInches?: number };
  geometry?: { type?: string; coordinates?: number[][][] | number[][][][] };
}
function hailtraceContainmentValue(
  lat: number,
  lng: number,
  geojson: { features?: HailtraceFeature[] } | null | undefined,
): number | null {
  if (!geojson?.features) return null;
  let best: number | null = null;
  for (const feat of geojson.features) {
    if (feat?.properties?.featureType !== "ALGORITHM_HAIL_SIZE") continue;
    const size = feat.properties.hailSizeInches;
    if (typeof size !== "number" || size <= 0) continue;
    if (best != null && size <= best) continue; // can't beat current best
    if (feat.geometry?.type !== "Polygon" && feat.geometry?.type !== "MultiPolygon") continue;
    const coords = feat.geometry.coordinates as number[][][] | number[][][][];
    // Polygon: number[][][]   (rings of [lng,lat])
    // MultiPolygon: number[][][][]  (array of polygons)
    const polygons: number[][][][] =
      feat.geometry.type === "Polygon"
        ? [coords as number[][][]]
        : (coords as number[][][][]);
    for (const poly of polygons) {
      if (poly.length === 0) continue;
      // pointInRing expects ring as [[lng, lat], ...] (GeoJSON order) and
      // compares signature `(lat, lng, ring)` — pass through unflipped.
      const outer = poly[0]!;
      if (!pointInRing(lat, lng, outer)) continue;
      let inHole = false;
      for (let r = 1; r < poly.length; r += 1) {
        if (pointInRing(lat, lng, poly[r]!)) { inHole = true; break; }
      }
      if (!inHole) { best = size; break; }
    }
  }
  return best;
}

/**
 * Calibrated AT LOCATION value. See ImpactHit.hail_calibrated_at_location
 * for the why; the algorithm is:
 *
 *   1. Fail open (return null) if there's no MRMS signal at all.
 *   2. Find the closest commercial source within 5 mi, ranked
 *      HailTrace meteo > HailTrace algo > IHM (any with hail >= 0.5").
 *   3. If no commercial source nearby: smooth the pixel by widening
 *      to mrms_1mi (or fall back to raw).
 *   4. If commercial anchor found: blend (anchor + radar_signal) / 2,
 *      cap at mrms_3mi (or 10mi when 3mi missing — Sterling-class
 *      tightly-localized storms have hot pixels with no broader
 *      polygon), floor at raw pixel, round to ¼".
 */
function calibrateAtLocation(
  raw: number | null,
  mrms_1mi: number | null,
  mrms_3mi: number | null,
  mrms_10mi: number | null,
  nearbyAll: NearbyGroundReport[],
): number | null {
  if (raw == null && mrms_1mi == null && mrms_3mi == null && mrms_10mi == null) {
    return null; // not in any meaningful swath
  }

  const within5mi = nearbyAll.filter(
    (g) => g.distance_miles <= 5.0 &&
           g.hail_size_inches != null &&
           g.hail_size_inches >= 0.5,
  );
  const closestOf = (source: string): number | null => {
    const cands = within5mi.filter((g) => g.source === source);
    if (cands.length === 0) return null;
    return cands[0]!.hail_size_inches!; // already sorted by distance asc
  };
  const anchor =
    closestOf("hailtrace_meteo") ??
    closestOf("hailtrace_algo") ??
    closestOf("ihm");

  if (anchor == null) {
    // No commercial corroboration — return MRMS broader window so we don't
    // surface noisy pixel values like 0.25".
    return mrms_1mi ?? raw ?? null;
  }

  const radarSignal = mrms_1mi ?? raw ?? 0;
  let blended = (anchor + radarSignal) / 2;

  const upperCap = mrms_3mi ?? mrms_10mi ?? mrms_1mi ?? raw;
  if (upperCap != null) blended = Math.min(blended, upperCap);
  if (raw != null) blended = Math.max(blended, raw);

  // Round to nearest ¼"
  return Math.round(blended * 4) / 4;
}

function evaluateSwath(
  lat: number,
  lng: number,
  features: SwathFeature[],
  kind: "mrms_hail" | "wind",
): PointInPolyResult {
  const traceFloor = kind === "mrms_hail" ? TRACE_FLOOR : 0; // wind has no trace floor
  let bestBand: BandPick | null = null;
  let bestLevel = -1;
  const hailBands: ImpactBands = { atLocation: null, within1mi: null, within3mi: null, within10mi: null };
  const windBands: WindBands = { atLocation: null, within1mi: null, within3mi: null, within10mi: null };
  let edgeAny = Infinity;
  let edgeHalfInch = Infinity;

  for (const feat of features) {
    const props = feat.properties;
    const sizeIn = props.sizeInches ?? 0;
    const minMph = props.minMph ?? 0;
    const value = kind === "mrms_hail" ? sizeIn : minMph;

    // Skip sub-trace polygons in classification (hail only).
    if (kind === "mrms_hail" && value < traceFloor) continue;

    // Containment check (Pass 1)
    let inside = false;
    for (const polygon of feat.geometry.coordinates) {
      if (polygon.length === 0) continue;
      const outer = polygon[0]!;
      if (!pointInRing(lat, lng, outer)) continue;
      let inHole = false;
      for (let r = 1; r < polygon.length; r += 1) {
        if (pointInRing(lat, lng, polygon[r]!)) { inHole = true; break; }
      }
      if (!inHole) { inside = true; break; }
    }

    if (inside && props.level > bestLevel) {
      bestLevel = props.level;
      bestBand = {
        label: props.label,
        color: props.color,
        severity: props.severity,
        sizeInches: props.sizeInches ?? null,
        minMph: props.minMph ?? null,
        level: props.level,
      };
    }

    // Edge-distance scan (Pass 2)
    let minDist = Infinity;
    for (const polygon of feat.geometry.coordinates) {
      for (const ring of polygon) {
        const d = nearestRingDistanceMiles(lat, lng, ring);
        if (d < minDist) minDist = d;
      }
    }
    if (minDist === Infinity) continue;
    if (minDist < edgeAny) edgeAny = minDist;
    if (kind === "mrms_hail" && sizeIn >= HALF_INCH && minDist < edgeHalfInch) {
      edgeHalfInch = minDist;
    }

    // Distance-bucket per Hail Yes column layout.
    const target = kind === "mrms_hail" ? hailBands : windBands;
    if (inside || minDist <= AT_LOCATION_MAX) {
      if (target.atLocation == null || value > target.atLocation) target.atLocation = value;
    } else if (minDist >= WITHIN_1MI_MIN && minDist <= WITHIN_1MI_MAX) {
      if (target.within1mi == null || value > target.within1mi) target.within1mi = value;
    } else if (minDist >= WITHIN_3MI_MIN && minDist <= WITHIN_3MI_MAX) {
      if (target.within3mi == null || value > target.within3mi) target.within3mi = value;
    } else if (minDist > WITHIN_3MI_MAX && minDist <= WITHIN_10MI_MAX) {
      if (target.within10mi == null || value > target.within10mi) target.within10mi = value;
    }
    // Gaps at 0.9–1.0 and 2.5–3.0 are intentionally unbinned (Hail Yes parity).
  }

  const hasNearEdge = edgeAny <= AT_LOCATION_MAX && bestBand == null;
  const hasAreaEdge = edgeAny <= WITHIN_10MI_MAX && !hasNearEdge && bestBand == null;

  return {
    bestBand,
    hailBands,
    windBands,
    edgeAny,
    edgeHalfInch,
    hasNearEdge,
    hasAreaEdge,
  };
}

export async function computeImpact(
  sql: Sql,
  lat: number,
  lng: number,
  startedAt: number,
  query: ImpactResponse["query"],
): Promise<ImpactResponse> {
  // Reverse-geocode lat/lng to county once per request — used downstream to
  // filter FEMA disaster declarations to the property's actual county
  // instead of the whole state. ~150ms latency, in-memory cached after
  // first hit. Best-effort: if FCC API fails we just don't county-filter.
  const propertyCounty = await lookupCounty(lat, lng, sql);

  // Spatial prefilter via bbox.
  const candidates = await sql<SwathRow[]>`
    SELECT id, event_id, kind, source, geojson
    FROM swaths
    WHERE bbox_n >= ${lat - 0.15} AND bbox_s <= ${lat + 0.15}
      AND bbox_e >= ${lng - 0.20} AND bbox_w <= ${lng + 0.20}
      AND feature_count > 0
  `;
  // ^ widen by ~10mi so events whose tight polygon is ~10mi from the point
  //   still qualify for area_impact tier classification.

  interface PerEvent {
    hail?: PointInPolyResult;
    wind?: PointInPolyResult;
  }
  const perEvent = new Map<number, PerEvent>();

  for (const row of candidates) {
    const features = row.geojson?.features ?? [];
    if (features.length === 0) continue;
    const kind = row.kind === "mrms_hail" || row.kind === "wind" ? row.kind : null;
    if (!kind) continue;
    const res = evaluateSwath(lat, lng, features, kind);
    // Ignore rows that produce no signal (point too far for any band)
    if (
      !res.bestBand &&
      res.edgeAny > WITHIN_10MI_MAX &&
      res.hailBands.within1mi == null &&
      res.hailBands.within3mi == null &&
      res.hailBands.within10mi == null &&
      res.windBands.within1mi == null &&
      res.windBands.within3mi == null &&
      res.windBands.within10mi == null
    ) continue;
    const entry = perEvent.get(row.event_id) ?? {};
    if (kind === "mrms_hail") entry.hail = res;
    else entry.wind = res;
    perEvent.set(row.event_id, entry);
  }

  if (perEvent.size === 0) {
    return {
      query,
      hits: [],
      meta: {
        hits_count: 0,
        direct_hits: 0,
        near_misses: 0,
        area_impacts: 0,
        candidate_swaths_evaluated: candidates.length,
        query_ms: Date.now() - startedAt,
      },
    };
  }

  const eventIds = Array.from(perEvent.keys());

  const events = await sql<Array<{
    id: number;
    state: string;
    event_date: string;
    tier: number;
    peak_hail_inches: number | null;
    peak_wind_mph: number | null;
    source_ncei: boolean;
    source_swdi: boolean;
    source_iem: boolean;
    source_hailtrace: boolean;
    source_ihm: boolean;
    evidence_sheet_path: string | null;
  }>>`
    SELECT id, state, event_date::text AS event_date, tier,
      peak_hail_inches, peak_wind_mph,
      source_ncei, source_swdi, source_iem, source_hailtrace, source_ihm,
      evidence_sheet_path
    FROM events WHERE id = ANY(${eventIds}::int[])
  `;

  const sourceRows = await sql<Array<{
    event_id: number; source: string; peak_hail_inches: number | null;
    record_count: number | null; description: string | null;
  }>>`
    SELECT event_id, source, peak_hail_inches, record_count, description
    FROM event_sources WHERE event_id = ANY(${eventIds}::int[])
  `;

  // LEFT JOIN hailtrace_photos so the API hands back our locally-mirrored
  // photo URL (`/api/hailtrace/photo/<id>`) when we have the JPG bytes
  // cached, falling back to the original HailTrace CDN URL otherwise.
  // After HT subscription expires the local URLs keep working forever.
  const groundRows = await sql<Array<{
    event_id: number; source: string; lat: number; lng: number;
    hail_size_inches: number | null; wind_mph: number | null;
    city: string | null;
    raw_data: { photo_url?: string | null; info_text?: string | null } | null;
    local_photo_id: number | null;
  }>>`
    SELECT g.event_id, g.source, g.lat, g.lng, g.hail_size_inches, g.wind_mph, g.city, g.raw_data,
           hp.id AS local_photo_id
    FROM ground_reports g
    LEFT JOIN hailtrace_photos hp
      ON g.source = 'hailtrace_meteo'
     AND hp.source_url = g.raw_data->>'photo_url'
    WHERE g.event_id = ANY(${eventIds}::int[])
  `;

  const surfaceRows = await sql<Array<{
    event_id: number; stations_total: number; stations_with_hail_signal: number;
  }>>`
    SELECT event_id,
      COUNT(*) FILTER (WHERE station_id NOT LIKE '__sentinel%')::int AS stations_total,
      COUNT(*) FILTER (WHERE hail_signal AND station_id NOT LIKE '__sentinel%')::int AS stations_with_hail_signal
    FROM surface_obs WHERE event_id = ANY(${eventIds}::int[])
    GROUP BY event_id
  `;

  // Federal citations — pulled once for all event dates on this query
  // and matched per-hit downstream. PCS dates can span 2-4 days so we
  // match by date-range overlap; FEMA matches by state + date overlap.
  const eventDateStrs = Array.from(new Set(events.map((e) => e.event_date)));
  const eventStates = Array.from(new Set(events.flatMap((e) => e.state.split(",").map((s) => s.trim()))));

  // NCEI narratives — searched across the WHOLE date+state space, not
  // just events with bbox-matching swaths. The Storm Events DB sync
  // attaches narratives to per-state events that may not be in our
  // impact response (different state, different event_id) but they're
  // the legal-grade citation we want for any storm on that date.
  const nceiNarrativeRows = eventDateStrs.length === 0 ? [] : await sql<Array<{
    event_date: string; state: string; lat: number; lng: number;
    hail_size_inches: number | null; wind_mph: number | null;
    raw_data: { event_id?: string; wfo?: string; narrative?: string; event_type?: string } | null;
  }>>`
    SELECT e.event_date::text AS event_date, e.state,
      g.lat::float8 AS lat, g.lng::float8 AS lng,
      g.hail_size_inches, g.wind_mph, g.raw_data
    FROM ground_reports g JOIN events e ON g.event_id = e.id
    WHERE g.source = 'ncei_storm_events'
      AND e.event_date::text = ANY(${eventDateStrs})
      AND e.state = ANY(${eventStates})
  `;

  const femaRows = eventDateStrs.length === 0 ? [] : await sql<Array<{
    disaster_number: number; state: string; county_name: string | null;
    designated_area: string; incident_type: string;
    declaration_title: string; declaration_date: string;
    incident_begin_date: string; incident_end_date: string | null;
  }>>`
    SELECT disaster_number, state, county_name, designated_area, incident_type,
           declaration_title, declaration_date::text AS declaration_date,
           incident_begin_date::text AS incident_begin_date,
           incident_end_date::text AS incident_end_date
    FROM fema_declarations
    WHERE state = ANY(${eventStates})
      AND incident_begin_date::text <= ANY(${eventDateStrs})
      AND (incident_end_date IS NULL OR incident_end_date::text >= ANY(${eventDateStrs}))
  `;

  const pcsRows = eventDateStrs.length === 0 ? [] : await sql<Array<{
    cat_number: string; start_date: string; end_date: string;
    affected_states: string[]; description: string;
  }>>`
    SELECT cat_number, start_date::text AS start_date, end_date::text AS end_date,
           affected_states, description
    FROM pcs_catastrophes
    WHERE start_date::text <= ANY(${eventDateStrs})
      AND end_date::text >= ANY(${eventDateStrs})
  `;

  // Pull HailTrace's frozen-cache geoJSON for the dates we're rendering.
  // postgres.js v3 chokes on date[] binding; cast through text per
  // feedback_postgres-js-date-array.md.
  const htCacheRows = eventDateStrs.length === 0
    ? []
    : await sql<Array<{ event_date: string; geojson: unknown }>>`
        SELECT event_date::text AS event_date, geojson
        FROM hailtrace_event_cache
        WHERE event_date::text = ANY(${eventDateStrs})
          AND fetch_status = 'ok' AND geojson IS NOT NULL
      `;
  const htByDate = new Map<string, { features?: HailtraceFeature[] } | null>();
  for (const r of htCacheRows) {
    htByDate.set(r.event_date, r.geojson as { features?: HailtraceFeature[] } | null);
  }

  // Index helpers
  type SourceRow = (typeof sourceRows)[number];
  type GroundRow = (typeof groundRows)[number];
  const sourcesByEvent = new Map<number, SourceRow[]>();
  for (const r of sourceRows) {
    const list = sourcesByEvent.get(r.event_id) ?? [];
    list.push(r);
    sourcesByEvent.set(r.event_id, list);
  }
  const groundsByEvent = new Map<number, GroundRow[]>();
  for (const r of groundRows) {
    const list = groundsByEvent.get(r.event_id) ?? [];
    list.push(r);
    groundsByEvent.set(r.event_id, list);
  }
  const surfaceByEvent = new Map(surfaceRows.map((r) => [r.event_id, r]));

  let directHits = 0;
  let nearMisses = 0;
  let areaImpacts = 0;
  const hits: ImpactHit[] = [];

  for (const event of events) {
    const eval_ = perEvent.get(event.id)!;
    const hail = eval_.hail;
    const wind = eval_.wind;

    // Compute distance-augmented ground reports (always, for the UI)
    const grounds = groundsByEvent.get(event.id) ?? [];
    const nearbyAll = grounds
      .map((g) => ({
        source: g.source,
        lat: Number(g.lat),
        lng: Number(g.lng),
        hail_size_inches: g.hail_size_inches,
        wind_mph: g.wind_mph,
        distance_miles: haversineMiles(lat, lng, Number(g.lat), Number(g.lng)),
        city: g.city,
        photo_url: g.local_photo_id != null
          ? `/api/hailtrace/photo/${g.local_photo_id}`
          : (g.raw_data?.photo_url ?? null),
        photo_text: g.raw_data?.info_text ?? null,
      }))
      .sort((a, b) => a.distance_miles - b.distance_miles);
    const nearby = nearbyAll.filter((g) => g.distance_miles <= 5).slice(0, 8);

    // ── Master classification (Hail Yes-aligned) ──────────────────────
    //
    // direct_hit — anything in the "At Location" column has a value, i.e.
    //              point is INSIDE polygon OR edge ≤ 0.9 mi (Hail Yes
    //              "At Location" definition). This matches what reps see
    //              labeled "DIRECT HIT" in Hail Yes for the same address.
    // near_miss  — only the "Within 1mi" column is populated (1.0–2.5 mi).
    // area_impact — only "Within 3mi" / "Within 10mi" columns populated.
    // no_impact  — nothing.
    //
    // Ground-truth upgrade — radar polygon may miss what observers caught.
    // Federal observers (NCEI/SWDI/IEM) can solo-upgrade. HailTrace meteo
    // can upgrade only with corroboration (a second source ≥½" within 5mi).
    // HailTrace algo + IHM never solo-upgrade — they count only as the
    // corroborating second source.
    const hailDirect = !!hail && hail.hailBands.atLocation != null;
    const hailNear   = !!hail && !hailDirect && hail.hailBands.within1mi != null;
    const hailArea   = !!hail && !hailDirect && !hailNear &&
      (hail.hailBands.within3mi != null || hail.hailBands.within10mi != null);

    const windDirect = !!wind && wind.windBands.atLocation != null;
    const windNear   = !!wind && !windDirect && wind.windBands.within1mi != null;
    const windArea   = !!wind && !windDirect && !windNear &&
      (wind.windBands.within3mi != null || wind.windBands.within10mi != null);

    let impactTier: ImpactTier;
    let upgradeReason: string | undefined;

    if (hailDirect || windDirect) {
      impactTier = "direct_hit";
    } else if (hailNear || windNear) {
      const fmt = (g: NearbyGroundReport) =>
        `${g.source} reported ${g.hail_size_inches!.toFixed(2)}″ at ${g.distance_miles.toFixed(2)} mi`;

      // Federal solo-upgrade: any NCEI/SWDI/IEM ≥½" within 1mi.
      const federal = nearbyAll.find((g) =>
        FEDERAL_GROUND_SOURCES.has(g.source) &&
        g.distance_miles <= FEDERAL_UPGRADE_RADIUS_MILES &&
        g.hail_size_inches != null &&
        g.hail_size_inches >= HALF_INCH,
      );

      if (federal) {
        impactTier = "direct_hit";
        upgradeReason = fmt(federal);
      } else {
        // HailTrace meteo upgrade — needs a corroborating second source.
        const meteo = nearbyAll.find((g) =>
          VERIFIED_COMMERCIAL_SOURCES.has(g.source) &&
          g.distance_miles <= COMMERCIAL_UPGRADE_RADIUS_MILES &&
          g.hail_size_inches != null &&
          g.hail_size_inches >= HALF_INCH,
        );
        const corroborator = meteo
          ? nearbyAll.find((g) =>
              g !== meteo &&
              CORROBORATING_SOURCES.has(g.source) &&
              g.distance_miles <= CORROBORATION_RADIUS_MILES &&
              g.hail_size_inches != null &&
              g.hail_size_inches >= HALF_INCH,
            )
          : undefined;

        if (meteo && corroborator) {
          impactTier = "direct_hit";
          upgradeReason = `${fmt(meteo)} (corroborated by ${corroborator.source} at ${corroborator.distance_miles.toFixed(2)} mi)`;
        } else {
          impactTier = "near_miss";
        }
      }
    } else if (hailArea || windArea) {
      impactTier = "area_impact";
    } else {
      impactTier = "no_impact";
    }

    if (impactTier === "no_impact") continue; // skip from response

    if (impactTier === "direct_hit") directHits += 1;
    else if (impactTier === "near_miss") nearMisses += 1;
    else if (impactTier === "area_impact") areaImpacts += 1;

    const surface = surfaceByEvent.get(event.id) ?? {
      stations_total: 0, stations_with_hail_signal: 0,
    };

    const hailBand = hail?.bestBand ?? null;
    const windBand = wind?.bestBand ?? null;

    const hailBands = hail?.hailBands ?? { atLocation: null, within1mi: null, within3mi: null, within10mi: null };

    // HailTrace polygon-containment is the gold-standard per-property
    // anchor when we have it — that's literally the number HailTrace
    // would put on the rep's claim PDF for this exact lat/lng. Frozen
    // from their subscription window into hailtrace_event_cache; persists
    // forever even after the live API access expires.
    const htGeo = htByDate.get(event.event_date) ?? null;
    const htAtProperty = htGeo ? hailtraceContainmentValue(lat, lng, htGeo) : null;

    // Federal-consistency gate: if NCEI/IEM/SWDI all reported zero hail
    // for this state on this date (peak_hail_inches=0 or null AND no
    // federal source flag set), HailTrace's NEXRAD algorithm pixel is
    // probably picking up MESH noise on a wind storm — showing 1.00"
    // here when peak_hail=0 looks wrong to adjusters and contradicts
    // the rep's own peak figures. Trust federal when federal is silent.
    const federalSawHail =
      (event.peak_hail_inches != null && event.peak_hail_inches >= 0.5) ||
      event.source_ncei || event.source_swdi || event.source_iem;
    const useHt = htAtProperty != null && federalSawHail;

    let calibratedAtLocation: number | null;
    if (useHt) {
      // HailTrace says exactly this much hail hit this property. Round to
      // ¼" but otherwise pass through — never undercut HT's own number,
      // and never let MRMS pixel noise dilute it.
      let v = Math.round(htAtProperty! * 4) / 4;
      // Safety floor at raw MRMS pixel — if both agree property got hit,
      // never display less than the radar's own observation.
      if (hailBands.atLocation != null && hailBands.atLocation > v) v = hailBands.atLocation;
      // Cap at peak_hail_inches — HT's polygon never claims more than
      // any source on the date saw. Prevents a stray 1.5" pixel from
      // overstating against a federal peak of 0.75".
      if (event.peak_hail_inches != null && event.peak_hail_inches > 0 && v > event.peak_hail_inches) {
        v = Math.round(event.peak_hail_inches * 4) / 4;
      }
      calibratedAtLocation = v;
    } else {
      calibratedAtLocation = calibrateAtLocation(
        hailBands.atLocation,
        hailBands.within1mi,
        hailBands.within3mi,
        hailBands.within10mi,
        nearbyAll,
      );
    }

    hits.push({
      event_id: event.id,
      state: event.state,
      event_date: event.event_date,
      tier: event.tier,
      peak_hail_inches: event.peak_hail_inches,
      peak_wind_mph: event.peak_wind_mph,
      evidence_sheet_url: event.evidence_sheet_path
        ? `/evidence/${event.evidence_sheet_path}`
        : "",
      hail_calibrated_at_location: calibratedAtLocation,

      impact_tier: impactTier,
      direct_hit: impactTier === "direct_hit",
      upgrade_reason: upgradeReason,

      hail_at_property: hailBand
        ? {
            label: hailBand.label,
            color: hailBand.color,
            severity: hailBand.severity,
            sizeInches: hailBand.sizeInches,
          }
        : null,
      wind_at_property: windBand
        ? {
            label: windBand.label,
            color: windBand.color,
            severity: windBand.severity,
            minMph: windBand.minMph,
          }
        : null,
      hail_bands: hail?.hailBands ?? { atLocation: null, within1mi: null, within3mi: null, within10mi: null },
      wind_bands: wind?.windBands ?? { atLocation: null, within1mi: null, within3mi: null, within10mi: null },
      edge_distance_miles: hail?.edgeAny != null && hail.edgeAny !== Infinity ? hail.edgeAny : null,
      edge_distance_half_inch_miles:
        hail?.edgeHalfInch != null && hail.edgeHalfInch !== Infinity ? hail.edgeHalfInch : null,

      sources: {
        ncei: event.source_ncei,
        swdi: event.source_swdi,
        iem: event.source_iem,
        hailtrace: event.source_hailtrace,
        ihm: event.source_ihm,
      },
      source_records: (sourcesByEvent.get(event.id) ?? []).map((s) => ({
        source: s.source,
        peak_hail_inches: s.peak_hail_inches,
        record_count: s.record_count,
        description: s.description ?? "",
      })),
      ground_reports_nearby: nearby,
      surface_obs: {
        stations_total: surface.stations_total,
        stations_with_hail_signal: surface.stations_with_hail_signal,
      },

      // Federal citation block — adjuster-grade pulls. Computed below
      // from per-hit data + the prefetched FEMA/PCS pools.
      federal_citations: (() => {
        // NCEI: pluck narratives by (state, date) — broader than the
        // event_id-bbox-matched ground_reports. Sources confirm same
        // storm via different ingest paths; we want the narrative
        // regardless of which path produced it.
        const stateList = event.state.split(",").map((s) => s.trim());
        const ncei = nceiNarrativeRows
          .filter((g) =>
            g.event_date === event.event_date &&
            stateList.includes(g.state) &&
            g.raw_data?.event_id
          )
          .map((g) => {
            const distance = haversineMiles(lat, lng, Number(g.lat), Number(g.lng));
            const rd = g.raw_data!;
            return {
              event_id: rd.event_id ?? "",
              wfo: rd.wfo ?? null,
              narrative: rd.narrative ?? null,
              event_type: rd.event_type ?? null,
              hail_size_inches: g.hail_size_inches,
              wind_mph: g.wind_mph,
              distance_miles: distance,
            };
          })
          .filter((r) => r.event_id)
          // dedupe by event_id (consolidating hits across states will
          // also dedupe but earlier is cleaner)
          .reduce((acc, r) => {
            if (!acc.find((x) => x.event_id === r.event_id)) acc.push(r);
            return acc;
          }, [] as Array<{
            event_id: string; wfo: string | null; narrative: string | null;
            event_type: string | null; hail_size_inches: number | null;
            wind_mph: number | null; distance_miles: number;
          }>)
          .sort((a, b) => a.distance_miles - b.distance_miles)
          .slice(0, 5);

        // FEMA: prefer county-level match when we know the property's
        // county; fall back to state-level (with no county_name set) when
        // FCC reverse-geocode failed or the declaration was statewide.
        // Filtering by county dramatically tightens the citation: a
        // disaster declared for Loudoun County won't be mis-cited for a
        // property in Fairfax County.
        const propCounty = propertyCounty?.county_name ?? null;
        const fema = femaRows
          .filter((f) => {
            if (!stateList.includes(f.state)) return false;
            if (f.incident_begin_date > event.event_date) return false;
            if (f.incident_end_date != null && f.incident_end_date < event.event_date) return false;
            // County match: either declaration is statewide (county_name null),
            // or it matches the property's county. If we don't know the
            // property's county, accept state-level (legacy behavior).
            if (!propCounty) return true;
            return f.county_name == null || f.county_name === propCounty;
          })
          // Dedupe by disaster_number (one disaster, many designated areas)
          .reduce((map, f) => {
            const key = `${f.disaster_number}|${f.state}`;
            if (!map.has(key)) map.set(key, f);
            return map;
          }, new Map<string, typeof femaRows[number]>());

        const pcs = pcsRows
          .filter((p) =>
            p.start_date <= event.event_date &&
            p.end_date >= event.event_date &&
            (p.affected_states.length === 0 || p.affected_states.some((s) => stateList.includes(s)))
          )
          .map((p) => ({
            cat_number: p.cat_number,
            start_date: p.start_date,
            end_date: p.end_date,
            description: p.description,
            affected_states: p.affected_states,
          }));

        return {
          ncei,
          fema: Array.from(fema.values()),
          pcs,
        };
      })(),
    });
  }

  // ── Consolidate same-date hits across states ──────────────────────────
  // A storm system spanning VA + MD + DC produces three separate event_id
  // rows for the same calendar date — but for a rep at one property, that's
  // one storm. Merge by event_date: take the highest tier, max metrics,
  // union of sources/grounds; keep all event_ids for traceability.
  const consolidated = consolidateByDate(hits);

  // 5-year default cap. UI/API can override via ?since=YYYY-MM-DD if older
  // events are needed (rare — reps file claims within 1-2 years).
  const fiveYearsAgo = new Date(Date.now() - 5 * 365 * 24 * 3600_000)
    .toISOString().slice(0, 10);
  const inWindow = consolidated.filter((h) => h.event_date >= fiveYearsAgo);

  // Recount meta after consolidation + window (this is what reps see).
  directHits = inWindow.filter((h) => h.impact_tier === "direct_hit").length;
  nearMisses = inWindow.filter((h) => h.impact_tier === "near_miss").length;
  areaImpacts = inWindow.filter((h) => h.impact_tier === "area_impact").length;

  const tierRank: Record<ImpactTier, number> = {
    direct_hit: 0, near_miss: 1, area_impact: 2, no_impact: 3,
  };
  inWindow.sort((a, b) => {
    const tierCmp = tierRank[a.impact_tier] - tierRank[b.impact_tier];
    if (tierCmp !== 0) return tierCmp;
    return b.event_date.localeCompare(a.event_date);
  });

  // Caps to keep response payload bounded. Direct + near are claim-grade
  // and never truncated below 80 each; area is context only.
  const DIRECT_LIMIT = 80;
  const NEAR_LIMIT = 80;
  const AREA_LIMIT = 15;
  const directs = inWindow.filter((h) => h.impact_tier === "direct_hit").slice(0, DIRECT_LIMIT);
  const nears = inWindow.filter((h) => h.impact_tier === "near_miss").slice(0, NEAR_LIMIT);
  const areas = inWindow.filter((h) => h.impact_tier === "area_impact").slice(0, AREA_LIMIT);
  const cappedHits = [...directs, ...nears, ...areas];

  return {
    query,
    hits: cappedHits,
    meta: {
      hits_count: cappedHits.length,
      direct_hits: directHits,
      near_misses: nearMisses,
      area_impacts: areaImpacts, // total before cap
      area_impacts_returned: areas.length,
      candidate_swaths_evaluated: candidates.length,
      query_ms: Date.now() - startedAt,
      since: fiveYearsAgo,
    } as ImpactResponse["meta"] & { area_impacts_returned: number; since: string },
  };
}

/**
 * Consolidate hits with the same event_date across states. A single storm
 * system that spanned VA + MD + DC on the same calendar day shouldn't appear
 * three times in a rep's results — it's one storm.
 *
 * Merge strategy:
 *  - tier:   max across states (direct_hit > near_miss > area_impact)
 *  - state:  comma-separated list, primary first (the one with the highest
 *            at-property value)
 *  - peak_hail_inches / peak_wind_mph: max across states
 *  - hail_at_property / wind_at_property: pick the entry with highest sizeInches
 *  - hail_bands / wind_bands: max-merge per column
 *  - sources: OR-merge boolean flags
 *  - source_records: union (dedupe by source key, keep highest peak per source)
 *  - ground_reports_nearby: union, sorted by distance, top 8
 *  - surface_obs: max across states
 *  - event_ids: keep ALL primary + secondary for traceability
 *  - upgrade_reason: keep first non-null
 */
function consolidateByDate(hits: ImpactHit[]): ImpactHit[] {
  const byDate = new Map<string, ImpactHit[]>();
  for (const h of hits) {
    const list = byDate.get(h.event_date) ?? [];
    list.push(h);
    byDate.set(h.event_date, list);
  }

  const tierRank: Record<ImpactTier, number> = {
    direct_hit: 0, near_miss: 1, area_impact: 2, no_impact: 3,
  };

  const out: ImpactHit[] = [];
  for (const [date, list] of byDate) {
    if (list.length === 1) {
      out.push(list[0]!);
      continue;
    }
    // Sort by severity then by at-location hail size — primary is the one
    // with the most damaging at-property reading.
    list.sort((a, b) => {
      const t = tierRank[a.impact_tier] - tierRank[b.impact_tier];
      if (t !== 0) return t;
      const aAt = a.hail_bands.atLocation ?? 0;
      const bAt = b.hail_bands.atLocation ?? 0;
      return bAt - aAt;
    });

    const primary = list[0]!;
    const states = Array.from(new Set(list.map((h) => h.state)));
    const eventIds = list.map((h) => h.event_id);

    const maxOrNull = (vals: Array<number | null | undefined>): number | null => {
      const nums = vals.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
      return nums.length === 0 ? null : Math.max(...nums);
    };

    const merged: ImpactHit = {
      ...primary,
      // Synthetic event_id is primary's; expose all via event_ids
      event_id: primary.event_id,
      state: states.join(", "),
      peak_hail_inches: maxOrNull(list.map((h) => h.peak_hail_inches)),
      peak_wind_mph: maxOrNull(list.map((h) => h.peak_wind_mph)),
      hail_calibrated_at_location: maxOrNull(list.map((h) => h.hail_calibrated_at_location)),
      hail_bands: {
        atLocation: maxOrNull(list.map((h) => h.hail_bands.atLocation)),
        within1mi: maxOrNull(list.map((h) => h.hail_bands.within1mi)),
        within3mi: maxOrNull(list.map((h) => h.hail_bands.within3mi)),
        within10mi: maxOrNull(list.map((h) => h.hail_bands.within10mi)),
      },
      wind_bands: {
        atLocation: maxOrNull(list.map((h) => h.wind_bands.atLocation)),
        within1mi: maxOrNull(list.map((h) => h.wind_bands.within1mi)),
        within3mi: maxOrNull(list.map((h) => h.wind_bands.within3mi)),
        within10mi: maxOrNull(list.map((h) => h.wind_bands.within10mi)),
      },
      hail_at_property: list
        .map((h) => h.hail_at_property)
        .filter((b): b is NonNullable<typeof b> => b != null)
        .sort((a, b) => (b.sizeInches ?? 0) - (a.sizeInches ?? 0))[0] ?? null,
      wind_at_property: list
        .map((h) => h.wind_at_property)
        .filter((b): b is NonNullable<typeof b> => b != null)
        .sort((a, b) => (b.minMph ?? 0) - (a.minMph ?? 0))[0] ?? null,
      sources: {
        ncei: list.some((h) => h.sources.ncei),
        swdi: list.some((h) => h.sources.swdi),
        iem: list.some((h) => h.sources.iem),
        hailtrace: list.some((h) => h.sources.hailtrace),
        ihm: list.some((h) => h.sources.ihm),
      },
      source_records: dedupeSources(list.flatMap((h) => h.source_records)),
      ground_reports_nearby: list
        .flatMap((h) => h.ground_reports_nearby)
        .sort((a, b) => a.distance_miles - b.distance_miles)
        .slice(0, 8),
      surface_obs: {
        stations_total: list.reduce((m, h) => Math.max(m, h.surface_obs.stations_total), 0),
        stations_with_hail_signal: list.reduce(
          (m, h) => Math.max(m, h.surface_obs.stations_with_hail_signal), 0,
        ),
      },
      federal_citations: {
        ncei: list.flatMap((h) => h.federal_citations.ncei)
          .reduce((acc, n) => {
            if (!acc.find((x) => x.event_id === n.event_id)) acc.push(n);
            return acc;
          }, [] as ImpactHit["federal_citations"]["ncei"])
          .sort((a, b) => a.distance_miles - b.distance_miles)
          .slice(0, 5),
        fema: list.flatMap((h) => h.federal_citations.fema)
          .reduce((acc, f) => {
            const k = `${f.disaster_number}|${f.state}`;
            if (!acc.find((x) => `${x.disaster_number}|${x.state}` === k)) acc.push(f);
            return acc;
          }, [] as ImpactHit["federal_citations"]["fema"]),
        pcs: list.flatMap((h) => h.federal_citations.pcs)
          .reduce((acc, p) => {
            if (!acc.find((x) => x.cat_number === p.cat_number)) acc.push(p);
            return acc;
          }, [] as ImpactHit["federal_citations"]["pcs"]),
      },
      upgrade_reason: list.find((h) => h.upgrade_reason)?.upgrade_reason,
      // Embed the multi-state event_ids so PDF / detail view can fetch them all.
      event_ids: eventIds,
      states: states,
    } as ImpactHit & { event_ids: number[]; states: string[] };

    void date;
    out.push(merged);
  }
  return out;
}

function dedupeSources(
  records: ImpactHit["source_records"],
): ImpactHit["source_records"] {
  const bySource = new Map<string, ImpactHit["source_records"][number]>();
  for (const r of records) {
    const existing = bySource.get(r.source);
    if (!existing) {
      bySource.set(r.source, r);
      continue;
    }
    // Prefer the record with the highest peak_hail_inches.
    const existingPeak = existing.peak_hail_inches ?? 0;
    const newPeak = r.peak_hail_inches ?? 0;
    if (newPeak > existingPeak) {
      bySource.set(r.source, r);
    } else if (newPeak === existingPeak && (r.record_count ?? 0) > (existing.record_count ?? 0)) {
      bySource.set(r.source, r);
    }
  }
  return Array.from(bySource.values()).sort((a, b) => a.source.localeCompare(b.source));
}
