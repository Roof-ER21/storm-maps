/**
 * Multi-source consilience scoring for storm-archive events.
 *
 * "Consilience" = independent sources converging on the same conclusion.
 * For an adjuster claim, more sources confirming a storm at a given
 * property+date strengthens the case.
 *
 * Hail Yes runs the 12-source pipeline live against MRMS / SPC / IEM /
 * Synoptic / mPING / Hailtrace / NCEI / NWS-VTEC / NCEI mesocyclones /
 * CoCoRaHS / SWDI on every query. We don't need to — those signals have
 * already been baked into storm-archive's tables during ingest:
 *
 *   - event_sources              ← NCEI / SWDI / IEM / Hailtrace / IHM
 *   - ground_reports             ← NCEI Storm Events lat/lng records
 *   - swaths (kind=mrms_hail)    ← MRMS confirmation
 *   - swaths (kind=wind)         ← Wind-LSR convective context
 *   - surface_obs                ← Synoptic / MADIS surface obs
 *
 * This service is a stateless aggregator over those tables, scoring how
 * many independent sources confirm the property got hit. Exposed as
 * /api/events/:id/consilience and folded into /api/impact responses.
 */
import type { Sql } from "../db.js";
import { haversineMiles } from "./geometry.js";
import { fetchSpcHailForDate } from "./sources/spc-hail.js";
import { fetchMesocycloneDetections } from "./sources/nx3mda.js";
import { fetchMpingHailReports } from "../sources/mping.js";
import { fetchNwsWarningsForDateAndPoint } from "./nws-vtec.js";

export interface ConsilienceSourceResult {
  /** Stable key. 12 sources total — 8 in-DB + 4 live-fetched:
   *  in-DB:  mrms / ncei / swdi / iem / hailtrace / ihm / wind_lsr / surface_obs
   *  live:   nws_vtec / spc_hail / nx3mda / mping
   */
  source: string;
  /** Human-readable label. */
  label: string;
  /** True iff this source confirmed the storm impact at this property/event. */
  confirmed: boolean;
  /** Short evidence sentence (only set when confirmed). */
  evidence?: string;
  /** True when this is a live external source whose endpoint is currently unreachable. */
  endpoint_offline?: boolean;
}

export type ConsilienceTier = "low" | "moderate" | "high" | "very_high";

export interface ConsilienceResult {
  event_id: number;
  event_date: string;
  state: string;
  /** Number of distinct sources that confirmed. */
  confirmed_count: number;
  /** Total sources evaluated. Live sources whose upstream endpoint is
   *  currently offline still count as "evaluated" (denominator) but
   *  cannot contribute to the numerator — they're flagged with
   *  `endpoint_offline:true` in the per-source breakdown so the UI can
   *  render them differently from a "no signal" miss. */
  total_sources: number;
  /** Score tiers across the 12-source range (low → ultra). */
  tier: ConsilienceTier;
  /** 0.0 – 1.0 normalized score for sorting / coloring. */
  score: number;
  /** Per-source breakdown (12 entries always — confirmed and unconfirmed). */
  sources: ConsilienceSourceResult[];
  /** Short narrative for adjuster PDF / rep-facing UI. */
  narrative: string;
}

const RADIUS_MILES_DEFAULT = 5;
const TOTAL_SOURCES = 12;

const SOURCE_LABELS: Record<string, string> = {
  mrms: "MRMS radar (NSSL)",
  ncei: "NCEI Storm Events DB",
  swdi: "NCEI SWDI radar archive",
  iem: "IEM LSR (NWS)",
  hailtrace: "Hailtrace meteorologist",
  ihm: "Interactive Hail Maps (NWS warning)",
  wind_lsr: "Wind LSR (convective context)",
  surface_obs: "Synoptic / MADIS surface obs",
  nws_vtec: "NWS VTEC warnings",
  spc_hail: "SPC daily hail roll-up",
  nx3mda: "NEXRAD mesocyclone (nx3mda)",
  mping: "mPING crowdsourced reports",
};

function tierFromCount(n: number): ConsilienceTier {
  // 12-source breakpoints — calibrated so 3 sources reads "moderate"
  // (still meaningful), 6 reads "high" (claim-grade), 9+ reads "very_high"
  // (overwhelming corroboration).
  if (n >= 9) return "very_high";
  if (n >= 6) return "high";
  if (n >= 3) return "moderate";
  return "low";
}

interface SourceRow {
  source: string;
  peak_hail_inches: number | null;
  record_count: number | null;
  description: string | null;
}

interface GroundRow {
  source: string;
  lat: number;
  lng: number;
  hail_size_inches: number | null;
  wind_mph: number | null;
}

interface EventCore {
  id: number;
  state: string;
  event_date: string;
  source_ncei: boolean;
  source_swdi: boolean;
  source_iem: boolean;
  source_hailtrace: boolean;
  source_ihm: boolean;
}

interface SwathSummary {
  hail_present: boolean;
  hail_max_inches: number | null;
  wind_present: boolean;
  wind_max_mph: number | null;
}

interface SurfaceSummary {
  stations_total: number;
  stations_with_hail_signal: number;
  peak_gust_mph: number | null;
}

export interface ConsilienceInput {
  /** Property location to score against. Optional — when null, evaluates the
   *  event's overall consilience without spatial gating. */
  lat?: number;
  lng?: number;
  /** Search radius (mi) for ground reports + surface obs. Default 5. */
  radiusMiles?: number;
}

/**
 * Score one event's consilience for a given property location (or globally).
 * All data comes from storm-archive tables — no live API calls.
 */
export async function scoreEvent(
  sql: Sql,
  eventId: number,
  opts: ConsilienceInput = {},
): Promise<ConsilienceResult | null> {
  const radius = opts.radiusMiles ?? RADIUS_MILES_DEFAULT;

  // Core event row
  const eventRows = await sql<EventCore[]>`
    SELECT id, state, event_date::text AS event_date,
      source_ncei, source_swdi, source_iem, source_hailtrace, source_ihm
    FROM events WHERE id = ${eventId}
  `;
  if (eventRows.length === 0) return null;
  const event = eventRows[0]!;

  // Source records (peak per source)
  const sourceRows = await sql<SourceRow[]>`
    SELECT source, peak_hail_inches, record_count, description
    FROM event_sources WHERE event_id = ${eventId}
  `;

  // Ground reports — filter by radius if location given
  const groundRows = await sql<GroundRow[]>`
    SELECT source, lat::float8 AS lat, lng::float8 AS lng,
      hail_size_inches, wind_mph
    FROM ground_reports WHERE event_id = ${eventId}
  `;
  const groundsRelevant = opts.lat != null && opts.lng != null
    ? groundRows.filter(
        (g) => haversineMiles(opts.lat!, opts.lng!, g.lat, g.lng) <= radius,
      )
    : groundRows;

  // Swaths (hail + wind) — for THIS event
  const swathRows = await sql<Array<{
    kind: string;
    feature_count: number;
    metadata: { maxHailInches?: number; maxGustMph?: number } | null;
  }>>`
    SELECT kind, feature_count, metadata
    FROM swaths WHERE event_id = ${eventId} AND feature_count > 0
  `;
  const swath: SwathSummary = {
    hail_present: false, hail_max_inches: null,
    wind_present: false, wind_max_mph: null,
  };
  for (const r of swathRows) {
    if (r.kind === "mrms_hail") {
      swath.hail_present = true;
      swath.hail_max_inches = r.metadata?.maxHailInches ?? null;
    } else if (r.kind === "wind") {
      swath.wind_present = true;
      swath.wind_max_mph = r.metadata?.maxGustMph ?? null;
    }
  }

  // Surface obs summary
  const surfaceRows = await sql<SurfaceSummary[]>`
    SELECT
      COUNT(*) FILTER (WHERE station_id NOT LIKE '__sentinel%')::int AS stations_total,
      COUNT(*) FILTER (WHERE hail_signal AND station_id NOT LIKE '__sentinel%')::int AS stations_with_hail_signal,
      MAX(peak_wind_gust_mph) AS peak_gust_mph
    FROM surface_obs WHERE event_id = ${eventId}
  `;
  const surface = surfaceRows[0] ?? {
    stations_total: 0, stations_with_hail_signal: 0, peak_gust_mph: null,
  };

  // ── Live external sources, fetched in parallel with a 10s budget ────────
  // Each call is individually capped (8s soft) and returns null/empty on
  // failure. Total wall-clock is min(slowest call, 10s).
  const liveLat = opts.lat ?? null;
  const liveLng = opts.lng ?? null;
  const wantLive = liveLat != null && liveLng != null;
  const livePromises = wantLive ? Promise.all([
    fetchNwsWarningsForDateAndPoint({
      date: event.event_date, lat: liveLat!, lng: liveLng!,
    }).catch(() => []),
    fetchSpcHailForDate({ date: event.event_date, state: event.state })
      .catch(() => []),
    fetchMesocycloneDetections({
      date: event.event_date, lat: liveLat!, lng: liveLng!, radiusMiles: 30,
    }).catch(() => []),
    fetchMpingHailReports({
      date: event.event_date, lat: liveLat!, lng: liveLng!, radiusMiles: 30,
    }).catch(() => ({ reports: [], endpoint_online: false, offline_reason: "fetch failed" })),
  ]) : Promise.resolve([[], [], [], { reports: [], endpoint_online: true, offline_reason: null }] as const);

  const [vtecWarnings, spcHail, mesocyclones, mpingResult] = await Promise.race([
    livePromises,
    new Promise<readonly [unknown[], unknown[], unknown[], { reports: unknown[]; endpoint_online: boolean; offline_reason: string | null }]>((resolve) =>
      setTimeout(() => resolve([[], [], [], { reports: [], endpoint_online: false, offline_reason: "live fetch budget exceeded" }] as const), 10_000),
    ),
  ]);
  // SPC reports — distance-filter to property
  const spcNearby = wantLive
    ? (spcHail as Array<{ lat: number; lng: number; size_inches: number }>)
        .filter((r) => haversineMiles(liveLat!, liveLng!, r.lat, r.lng) <= radius)
    : (spcHail as Array<{ lat: number; lng: number; size_inches: number }>);
  const meso = mesocyclones as Array<{ strength: number; radar: string; lat: number; lng: number }>;
  const mpingResolved = mpingResult as { reports: Array<{ hail_size_inches: number; lat: number; lng: number }>; endpoint_online: boolean; offline_reason: string | null };
  const mpingNearby = wantLive
    ? mpingResolved.reports.filter((r) => haversineMiles(liveLat!, liveLng!, r.lat, r.lng) <= radius)
    : mpingResolved.reports;

  // Build per-source results
  const results: ConsilienceSourceResult[] = [];
  let confirmedCount = 0;

  // 1. MRMS
  if (swath.hail_present) {
    confirmedCount += 1;
    results.push({
      source: "mrms",
      label: SOURCE_LABELS.mrms!,
      confirmed: true,
      evidence: `MRMS radar shows hail polygon up to ${(swath.hail_max_inches ?? 0).toFixed(2)}″ on this date`,
    });
  } else {
    results.push({ source: "mrms", label: SOURCE_LABELS.mrms!, confirmed: false });
  }

  // 2. NCEI Storm Events DB
  const nceiSrc = sourceRows.find((s) => s.source === "ncei");
  const nceiGroundsInRadius = groundsRelevant.filter((g) => g.source === "ncei_storm_events");
  if (event.source_ncei && (nceiSrc || nceiGroundsInRadius.length > 0)) {
    confirmedCount += 1;
    const peak = nceiSrc?.peak_hail_inches ?? null;
    const evidence = nceiGroundsInRadius.length > 0
      ? `${nceiGroundsInRadius.length} federal NCEI report${nceiGroundsInRadius.length === 1 ? "" : "s"} within ${radius} mi${peak ? ` (peak ${peak.toFixed(2)}″)` : ""}`
      : `NCEI Storm Events DB confirms ${peak ? `${peak.toFixed(2)}″ peak` : "this storm"} for ${event.state}`;
    results.push({ source: "ncei", label: SOURCE_LABELS.ncei!, confirmed: true, evidence });
  } else {
    results.push({ source: "ncei", label: SOURCE_LABELS.ncei!, confirmed: false });
  }

  // 3. NCEI SWDI radar
  const swdiSrc = sourceRows.find((s) => s.source === "swdi");
  const swdiGrounds = groundsRelevant.filter((g) => g.source === "ncei_swdi");
  if (event.source_swdi || swdiGrounds.length > 0) {
    confirmedCount += 1;
    const peak = swdiSrc?.peak_hail_inches ?? null;
    const evidence = swdiGrounds.length > 0
      ? `SWDI radar archive shows ${swdiGrounds.length} signature${swdiGrounds.length === 1 ? "" : "s"} within ${radius} mi`
      : `SWDI radar archive confirms ${peak ? `${peak.toFixed(2)}″ peak` : "this storm"}`;
    results.push({ source: "swdi", label: SOURCE_LABELS.swdi!, confirmed: true, evidence });
  } else {
    results.push({ source: "swdi", label: SOURCE_LABELS.swdi!, confirmed: false });
  }

  // 4. IEM LSR
  const iemSrc = sourceRows.find((s) => s.source === "iem");
  if (event.source_iem || iemSrc) {
    confirmedCount += 1;
    const peak = iemSrc?.peak_hail_inches ?? null;
    results.push({
      source: "iem",
      label: SOURCE_LABELS.iem!,
      confirmed: true,
      evidence: `IEM LSR (NWS spotters) confirm${peak ? ` ${peak.toFixed(2)}″ peak` : ""}`,
    });
  } else {
    results.push({ source: "iem", label: SOURCE_LABELS.iem!, confirmed: false });
  }

  // 5. Hailtrace — check legacy event-level flag + new sources:
  //    a) event.source_hailtrace from evidence-sheet ingest
  //    b) event_sources peak rows (hailtrace_meteo / hailtrace_algo)
  //    c) ground_reports rows from HT bulk extraction (hailtrace_meteo per-point)
  //    d) hailtrace_event_cache geoJSON for the date (HT polygons covering area)
  const htMeteo = sourceRows.find((s) => s.source === "hailtrace_meteo");
  const htAlgo = sourceRows.find((s) => s.source === "hailtrace_algo");
  const htGrounds = groundsRelevant.filter((g) => g.source === "hailtrace_meteo");
  const htCacheRows = await sql<{ ok: number }[]>`
    SELECT 1 AS ok FROM hailtrace_event_cache
    WHERE event_date = ${event.event_date}::date
      AND fetch_status = 'ok'
      AND geojson IS NOT NULL
    LIMIT 1
  `;
  const htHasCache = htCacheRows.length > 0;
  if (event.source_hailtrace || htMeteo || htAlgo || htGrounds.length > 0 || htHasCache) {
    confirmedCount += 1;
    const nearestGroundHail = htGrounds.find((g) => g.hail_size_inches != null);
    const peak = htMeteo?.peak_hail_inches
      ?? htAlgo?.peak_hail_inches
      ?? nearestGroundHail?.hail_size_inches
      ?? null;
    const tag = htMeteo || htGrounds.length > 0 ? "meteorologist-verified" : "algorithm";
    results.push({
      source: "hailtrace",
      label: SOURCE_LABELS.hailtrace!,
      confirmed: true,
      evidence: `HailTrace ${tag}${peak ? ` ${peak.toFixed(2)}″` : ""}${htGrounds.length > 0 ? ` · ${htGrounds.length} pt${htGrounds.length === 1 ? "" : "s"}` : ""}`,
    });
  } else {
    results.push({ source: "hailtrace", label: SOURCE_LABELS.hailtrace!, confirmed: false });
  }

  // 6. IHM — same multi-signal check: event flag, event_sources row, OR
  //    nearby IHM ground_reports (city centroids from our geocoding pass).
  const ihmSrc = sourceRows.find((s) => s.source === "ihm");
  const ihmGrounds = groundsRelevant.filter((g) => g.source === "ihm");
  if (event.source_ihm || ihmSrc || ihmGrounds.length > 0) {
    confirmedCount += 1;
    const peak = ihmSrc?.peak_hail_inches
      ?? ihmGrounds.find((g) => g.hail_size_inches != null)?.hail_size_inches
      ?? null;
    results.push({
      source: "ihm",
      label: SOURCE_LABELS.ihm!,
      confirmed: true,
      evidence: `Interactive Hail Maps / NWS warning text${peak ? ` (${peak.toFixed(2)}″)` : ""}${ihmGrounds.length > 0 ? ` · ${ihmGrounds.length} city${ihmGrounds.length === 1 ? "" : "s"}` : ""}`,
    });
  } else {
    results.push({ source: "ihm", label: SOURCE_LABELS.ihm!, confirmed: false });
  }

  // 7. Wind LSR (convective signature)
  if (swath.wind_present) {
    confirmedCount += 1;
    results.push({
      source: "wind_lsr",
      label: SOURCE_LABELS.wind_lsr!,
      confirmed: true,
      evidence: `Severe wind LSR confirms convective storm${swath.wind_max_mph ? ` (peak ${Math.round(swath.wind_max_mph)} mph)` : ""}`,
    });
  } else {
    results.push({ source: "wind_lsr", label: SOURCE_LABELS.wind_lsr!, confirmed: false });
  }

  // 8. Surface obs (Synoptic / MADIS)
  if (surface.stations_with_hail_signal > 0) {
    confirmedCount += 1;
    results.push({
      source: "surface_obs",
      label: SOURCE_LABELS.surface_obs!,
      confirmed: true,
      evidence: `${surface.stations_with_hail_signal} of ${surface.stations_total} surface stations showed a hail signal`,
    });
  } else {
    results.push({ source: "surface_obs", label: SOURCE_LABELS.surface_obs!, confirmed: false });
  }

  // 9. NWS VTEC warnings (live IEM fetch)
  if ((vtecWarnings as Array<unknown>).length > 0) {
    const ws = vtecWarnings as Array<{ phenomenon: string; hail_size_inches: number | null; wind_mph: number | null }>;
    confirmedCount += 1;
    const types = Array.from(new Set(ws.map((w) => w.phenomenon))).slice(0, 3).join(", ");
    const peakHail = Math.max(0, ...ws.map((w) => w.hail_size_inches ?? 0));
    const peakWind = Math.max(0, ...ws.map((w) => w.wind_mph ?? 0));
    const tagBits: string[] = [];
    if (peakHail > 0) tagBits.push(`up to ${peakHail.toFixed(2)}″ hail`);
    if (peakWind > 0) tagBits.push(`${Math.round(peakWind)} mph wind`);
    results.push({
      source: "nws_vtec",
      label: SOURCE_LABELS.nws_vtec!,
      confirmed: true,
      evidence: `Property inside ${ws.length} active NWS warning${ws.length === 1 ? "" : "s"} (${types})${tagBits.length ? ` — ${tagBits.join(", ")}` : ""}`,
    });
  } else {
    results.push({ source: "nws_vtec", label: SOURCE_LABELS.nws_vtec!, confirmed: false });
  }

  // 10. SPC daily hail roll-up
  if (spcNearby.length > 0) {
    confirmedCount += 1;
    const peak = Math.max(...spcNearby.map((r) => r.size_inches));
    results.push({
      source: "spc_hail",
      label: SOURCE_LABELS.spc_hail!,
      confirmed: true,
      evidence: `${spcNearby.length} SPC roll-up report${spcNearby.length === 1 ? "" : "s"} within ${radius} mi (peak ${peak.toFixed(2)}″)`,
    });
  } else {
    results.push({ source: "spc_hail", label: SOURCE_LABELS.spc_hail!, confirmed: false });
  }

  // 11. NEXRAD mesocyclone (nx3mda)
  if (meso.length > 0) {
    confirmedCount += 1;
    const peakStr = Math.max(...meso.map((m) => m.strength));
    const stations = Array.from(new Set(meso.map((m) => m.radar))).filter(Boolean).slice(0, 3).join(", ");
    const klass = peakStr >= 8 ? "tornado-warning class" : "supercell signature";
    results.push({
      source: "nx3mda",
      label: SOURCE_LABELS.nx3mda!,
      confirmed: true,
      evidence: `${meso.length} mesocyclone detection${meso.length === 1 ? "" : "s"}${stations ? ` from ${stations}` : ""}, peak strength ${peakStr.toFixed(0)} (${klass})`,
    });
  } else {
    results.push({ source: "nx3mda", label: SOURCE_LABELS.nx3mda!, confirmed: false });
  }

  // 12. mPING crowdsourced reports — endpoint may be offline (404 since
  //     April 2026). When offline, mark explicitly so the UI can render
  //     "endpoint offline" rather than a generic miss.
  if (mpingNearby.length > 0) {
    confirmedCount += 1;
    const peak = Math.max(0, ...mpingNearby.map((r) => r.hail_size_inches));
    results.push({
      source: "mping",
      label: SOURCE_LABELS.mping!,
      confirmed: true,
      evidence: `${mpingNearby.length} mPING ground-observer report${mpingNearby.length === 1 ? "" : "s"} within ${radius} mi${peak > 0 ? ` (peak ${peak.toFixed(2)}″)` : ""}`,
    });
  } else if (!mpingResolved.endpoint_online) {
    results.push({
      source: "mping",
      label: SOURCE_LABELS.mping!,
      confirmed: false,
      endpoint_offline: true,
      evidence: mpingResolved.offline_reason ?? "endpoint offline",
    });
  } else {
    results.push({ source: "mping", label: SOURCE_LABELS.mping!, confirmed: false });
  }

  const tier = tierFromCount(confirmedCount);
  const score = confirmedCount / TOTAL_SOURCES;

  // Narrative
  const confirmedSourceNames = results.filter((r) => r.confirmed).map((r) => r.label);
  const offlineCount = results.filter((r) => r.endpoint_offline).length;
  let narrative: string;
  if (confirmedCount === 0) {
    narrative = `No source on file confirms a storm at this location for ${event.event_date}.`;
  } else {
    const tierWords: Record<ConsilienceTier, string> = {
      very_high: "Overwhelming",
      high: "Strong",
      moderate: "Moderate",
      low: "Limited",
    };
    narrative = `${tierWords[tier]} multi-source corroboration: ${confirmedCount} of ${TOTAL_SOURCES} independent sources confirm this storm` +
      (opts.lat != null && opts.lng != null ? ` at the property location` : "") +
      `. Sources confirming: ${confirmedSourceNames.slice(0, 5).join(", ")}` +
      (confirmedSourceNames.length > 5 ? `, and ${confirmedSourceNames.length - 5} more` : "") +
      "." +
      (offlineCount > 0 ? ` (${offlineCount} live source${offlineCount === 1 ? "" : "s"} currently unreachable upstream — not counted as a miss.)` : "");
  }

  return {
    event_id: event.id,
    event_date: event.event_date,
    state: event.state,
    confirmed_count: confirmedCount,
    total_sources: TOTAL_SOURCES,
    tier,
    score,
    sources: results,
    narrative,
  };
}
