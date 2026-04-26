/**
 * Consilience service — 5-source corroboration for a property+date.
 *
 * "Consilience" = independent sources converging on the same conclusion.
 * For a roofing-claim use case, the more independent sources confirm a
 * storm at a given lat/lng on a given date, the stronger the case.
 *
 * The 5 sources Hail Yes already touches:
 *   1. **MRMS**         — radar-derived MESH hail polygon (algorithm)
 *   2. **SPC hail**     — Storm Prediction Center same-day/archive hail reports
 *   3. **IEM LSR hail** — NWS Local Storm Reports (ground truth, hail type)
 *   4. **Wind context** — SPC + IEM LSR severe wind reports (convective signature)
 *   5. **Synoptic**     — MADIS surface obs (CWOP/METAR/PWS), surface ground truth
 *
 * The consilience service is **stateless** — it calls the 5 underlying
 * services live and aggregates. Persistence into `verified_hail_events` is
 * a separate optimization (write-after-compute), not required for correctness.
 *
 * **Auto-curate rule** (for adjuster-facing PDF output):
 *   - Include positives only — sources that confirmed the storm
 *   - Silently omit absences (source returned no data) and contradictions
 *     (source returned data but no signal)
 *   - The CLI debug output bypasses curation and shows everything
 */

import { buildMrmsImpactResponse } from './mrmsService.js';
import { fetchSpcHailReportsForDate, type HailPointReport } from './spcHailReports.js';
import { fetchIemHailReports } from './iemHailReports.js';
import { fetchSpcWindReports } from './spcReports.js';
import { fetchIemWindReports } from './iemLsr.js';
import { corroborateSynopticObservations, type SynopticCorroboration } from './synopticObservationsService.js';
import type { BoundingBox, WindReport } from './types.js';

export interface ConsilienceQuery {
  /** Property latitude (decimal degrees). */
  lat: number;
  /** Property longitude (decimal degrees). */
  lng: number;
  /** Storm date in `YYYY-MM-DD` (Eastern). */
  date: string;
  /** Search radius for ground reports + Synoptic. Default 5 mi. */
  radiusMiles?: number;
  /** Override the UTC start of the storm window. Default 04:00 UTC of date. */
  startUtcOverride?: Date;
  /** Override the UTC end. Default 12:00 UTC of next day. */
  endUtcOverride?: Date;
}

export interface SourceResultBase {
  /** True iff the source confirmed the storm. */
  confirmed: boolean;
  /** Short human-readable evidence sentence (only when confirmed). */
  evidence?: string;
}

export interface ConsilienceSources {
  mrms: SourceResultBase & {
    directHit: boolean;
    hailSizeInches: number | null;
    bandLabel: string | null;
  };
  spcHail: SourceResultBase & {
    reportCount: number;
    maxHailInches: number;
    nearestMiles: number | null;
  };
  iemLsrHail: SourceResultBase & {
    reportCount: number;
    maxHailInches: number;
    nearestMiles: number | null;
  };
  windContext: SourceResultBase & {
    reportCount: number;
    peakGustMph: number | null;
    nearestMiles: number | null;
    sources: string[];
  };
  synoptic: SourceResultBase & {
    stationsTotal: number;
    stationsWithHailSignal: number;
    stationsWithSevereWindSignal: number;
    peakGustMph: number | null;
  };
}

export type ConfidenceTier =
  | 'none'
  | 'single'
  | 'cross-verified'
  | 'triple-verified'
  | 'quadruple-verified'
  | 'quintuple-verified';

export interface ConsilienceResult {
  query: Required<Pick<ConsilienceQuery, 'lat' | 'lng' | 'date' | 'radiusMiles'>> & {
    startUtc: string;
    endUtc: string;
  };
  sources: ConsilienceSources;
  confirmedCount: number;
  confidenceTier: ConfidenceTier;
  /**
   * Adjuster-facing curated output. Only positives included. Empty arrays
   * mean "render nothing" — do not surface absences as negative findings.
   */
  curated: {
    confirmedSources: string[];
    evidenceLines: string[];
    /** One-paragraph summary suitable for the PDF body. Empty if 0 sources. */
    narrative: string;
  };
  generatedAt: string;
}

const DEFAULT_RADIUS_MI = 5;

export async function buildConsilience(
  query: ConsilienceQuery,
): Promise<ConsilienceResult> {
  const radius = query.radiusMiles ?? DEFAULT_RADIUS_MI;
  const startUtc =
    query.startUtcOverride ?? new Date(`${query.date}T04:00:00Z`);
  const endUtc =
    query.endUtcOverride ??
    (() => {
      const d = new Date(`${query.date}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + 1);
      d.setUTCHours(12, 0, 0, 0);
      return d;
    })();

  const bounds = boundsFromPoint(query.lat, query.lng, radius + 5);

  // Fire all 5 source fetches concurrently. Each handles its own errors
  // (returns empty/null) so a single source failure doesn't fail the call.
  const [
    mrmsResult,
    spcHailReports,
    iemHailReportsResult,
    spcWindReports,
    iemWindReportsResult,
    synopticResult,
  ] = await Promise.all([
    safeMrms(query.date, query.lat, query.lng, bounds),
    fetchSpcHailReportsForDate(query.date).catch(emptyArray<HailPointReport>),
    fetchIemHailReports({ date: query.date, bounds }).catch(emptyArray<HailPointReport>),
    fetchSpcWindReports(query.date).catch(emptyArray<WindReport>),
    fetchIemWindReports({ date: query.date, bounds }).catch(emptyArray<WindReport>),
    corroborateSynopticObservations({
      lat: query.lat,
      lng: query.lng,
      radiusMiles: radius,
      startUtc,
      endUtc,
    }).catch(emptySynoptic),
  ]);

  // ── MRMS ─────────────────────────────────────────────
  const mrms = analyzeMrms(mrmsResult);

  // ── SPC hail ─────────────────────────────────────────
  const spcHail = analyzeHailReports(
    spcHailReports.filter((r) => withinRadius(r.lat, r.lng, query.lat, query.lng, radius)),
    query.lat,
    query.lng,
    'SPC',
  );

  // ── IEM LSR hail ─────────────────────────────────────
  const iemLsrHail = analyzeHailReports(
    iemHailReportsResult,
    query.lat,
    query.lng,
    'IEM LSR',
  );

  // ── Wind context (SPC wind ∪ IEM LSR wind, ≥58 mph) ──
  const windReportsAll = [
    ...spcWindReports.filter((r) =>
      withinRadius(r.lat, r.lng, query.lat, query.lng, radius),
    ),
    ...iemWindReportsResult,
  ];
  const windContext = analyzeWindReports(windReportsAll, query.lat, query.lng);

  // ── Synoptic ─────────────────────────────────────────
  const synoptic = analyzeSynoptic(synopticResult);

  const confirmedCount =
    Number(mrms.confirmed) +
    Number(spcHail.confirmed) +
    Number(iemLsrHail.confirmed) +
    Number(windContext.confirmed) +
    Number(synoptic.confirmed);

  const confidenceTier: ConfidenceTier =
    confirmedCount >= 5
      ? 'quintuple-verified'
      : confirmedCount === 4
        ? 'quadruple-verified'
        : confirmedCount === 3
          ? 'triple-verified'
          : confirmedCount === 2
            ? 'cross-verified'
            : confirmedCount === 1
              ? 'single'
              : 'none';

  const sources: ConsilienceSources = {
    mrms,
    spcHail,
    iemLsrHail,
    windContext,
    synoptic,
  };

  const curated = curateForAdjuster(sources, query.date);

  return {
    query: {
      lat: query.lat,
      lng: query.lng,
      date: query.date,
      radiusMiles: radius,
      startUtc: startUtc.toISOString(),
      endUtc: endUtc.toISOString(),
    },
    sources,
    confirmedCount,
    confidenceTier,
    curated,
    generatedAt: new Date().toISOString(),
  };
}

// ── Source analyzers ──────────────────────────────────────────

async function safeMrms(
  date: string,
  lat: number,
  lng: number,
  bounds: BoundingBox,
): Promise<{ directHit: boolean; hailSizeInches: number | null; bandLabel: string | null } | null> {
  try {
    const resp = await buildMrmsImpactResponse({
      date,
      bounds,
      points: [{ id: 'property', lat, lng }],
    });
    if (!resp || resp.results.length === 0) return null;
    const r = resp.results[0];
    return {
      directHit: r.directHit,
      hailSizeInches: r.maxHailInches,
      bandLabel: r.label,
    };
  } catch (err) {
    console.warn('[consilience] MRMS lookup failed:', (err as Error).message);
    return null;
  }
}

function analyzeMrms(
  result: { directHit: boolean; hailSizeInches: number | null; bandLabel: string | null } | null,
): ConsilienceSources['mrms'] {
  if (!result) {
    return { confirmed: false, directHit: false, hailSizeInches: null, bandLabel: null };
  }
  const confirmed = result.directHit && (result.hailSizeInches ?? 0) >= 0.25;
  const evidence = confirmed && result.hailSizeInches !== null
    ? `MRMS radar shows the property inside a ${result.bandLabel ?? `${result.hailSizeInches.toFixed(2)}"`} hail swath (algorithm-derived MESH).`
    : undefined;
  return {
    confirmed,
    evidence,
    directHit: result.directHit,
    hailSizeInches: result.hailSizeInches,
    bandLabel: result.bandLabel,
  };
}

function analyzeHailReports(
  reports: HailPointReport[],
  lat: number,
  lng: number,
  label: 'SPC' | 'IEM LSR',
): ConsilienceSources['spcHail'] {
  if (reports.length === 0) {
    return { confirmed: false, reportCount: 0, maxHailInches: 0, nearestMiles: null };
  }
  const maxInches = reports.reduce((m, r) => Math.max(m, r.sizeInches), 0);
  const nearest = reports.reduce(
    (best, r) => {
      const d = haversineMiles(lat, lng, r.lat, r.lng);
      return d < best ? d : best;
    },
    Number.POSITIVE_INFINITY,
  );
  // ≥0.25" hail report is meaningful; anything smaller could be background.
  const confirmed = maxInches >= 0.25;
  const sourceTag = label === 'SPC' ? 'SPC ground reports' : 'NWS Local Storm Reports';
  const evidence = confirmed
    ? `${sourceTag}: ${reports.length} hail report${reports.length === 1 ? '' : 's'} within ${nearest.toFixed(1)} mi, peak size ${maxInches.toFixed(2)}".`
    : undefined;
  return {
    confirmed,
    evidence,
    reportCount: reports.length,
    maxHailInches: maxInches,
    nearestMiles: Number.isFinite(nearest) ? nearest : null,
  };
}

function analyzeWindReports(
  reports: WindReport[],
  lat: number,
  lng: number,
): ConsilienceSources['windContext'] {
  if (reports.length === 0) {
    return {
      confirmed: false,
      reportCount: 0,
      peakGustMph: null,
      nearestMiles: null,
      sources: [],
    };
  }
  const peak = reports.reduce((m, r) => Math.max(m, r.gustMph), 0);
  const nearest = reports.reduce(
    (best, r) => {
      const d = haversineMiles(lat, lng, r.lat, r.lng);
      return d < best ? d : best;
    },
    Number.POSITIVE_INFINITY,
  );
  const sources = [...new Set(reports.map((r) => r.source))];
  // Insurance-actionable wind threshold: ≥58 mph.
  const confirmed = peak >= 58;
  const evidence = confirmed
    ? `Severe wind reports: ${reports.length} report${reports.length === 1 ? '' : 's'} within ${nearest.toFixed(1)} mi, peak gust ${peak.toFixed(0)} mph (${sources.join(', ')}).`
    : undefined;
  return {
    confirmed,
    evidence,
    reportCount: reports.length,
    peakGustMph: peak,
    nearestMiles: Number.isFinite(nearest) ? nearest : null,
    sources,
  };
}

function analyzeSynoptic(c: SynopticCorroboration): ConsilienceSources['synoptic'] {
  // Require ≥2 stations with hail signal OR ≥1 hail-keyword + ≥1 severe-wind
  // station (avoids the lone-CWOP-sensor-error case from the POC).
  const peakGust = c.stations.reduce(
    (m, s) =>
      s.signal.peakGustMph !== null && s.signal.peakGustMph > (m ?? -Infinity)
        ? s.signal.peakGustMph
        : m,
    null as number | null,
  );
  const explicitHailStations = c.stations.filter(
    (s) =>
      s.signal.hailKeywordHits.includes('hail') ||
      s.signal.hailCondCodeHits.length > 0,
  ).length;
  const confirmed =
    c.stationsWithHailSignal >= 2 ||
    (explicitHailStations >= 1 && c.stationsWithSevereWindSignal >= 1);
  const evidence = confirmed
    ? `Synoptic surface obs: ${c.stationsWithHailSignal}/${c.stationsTotal} stations flagged hail signature${peakGust !== null ? `, peak gust ${peakGust.toFixed(0)} mph` : ''}.`
    : undefined;
  return {
    confirmed,
    evidence,
    stationsTotal: c.stationsTotal,
    stationsWithHailSignal: c.stationsWithHailSignal,
    stationsWithSevereWindSignal: c.stationsWithSevereWindSignal,
    peakGustMph: peakGust,
  };
}

// ── Auto-curate ─────────────────────────────────────────────

function curateForAdjuster(
  sources: ConsilienceSources,
  date: string,
): ConsilienceResult['curated'] {
  const confirmedSources: string[] = [];
  const evidenceLines: string[] = [];

  // Order matters — strongest signal types first for narrative readability.
  if (sources.mrms.confirmed && sources.mrms.evidence) {
    confirmedSources.push('MRMS radar (NOAA/MTArchive)');
    evidenceLines.push(sources.mrms.evidence);
  }
  if (sources.spcHail.confirmed && sources.spcHail.evidence) {
    confirmedSources.push('SPC hail reports');
    evidenceLines.push(sources.spcHail.evidence);
  }
  if (sources.iemLsrHail.confirmed && sources.iemLsrHail.evidence) {
    confirmedSources.push('NWS Local Storm Reports');
    evidenceLines.push(sources.iemLsrHail.evidence);
  }
  if (sources.windContext.confirmed && sources.windContext.evidence) {
    confirmedSources.push('Severe wind reports');
    evidenceLines.push(sources.windContext.evidence);
  }
  if (sources.synoptic.confirmed && sources.synoptic.evidence) {
    confirmedSources.push('Synoptic surface stations');
    evidenceLines.push(sources.synoptic.evidence);
  }

  if (confirmedSources.length === 0) {
    return { confirmedSources, evidenceLines, narrative: '' };
  }

  // Render-ready narrative paragraph for the PDF.
  const dateLabel = formatDateLabel(date);
  const tier =
    confirmedSources.length >= 3
      ? 'multiple independent sources'
      : confirmedSources.length === 2
        ? 'two independent sources'
        : 'one official source';
  const narrative = [
    `Storm corroboration for ${dateLabel}: ${tier} confirmed severe-weather impact at this property.`,
    ...evidenceLines.map((l) => `• ${l}`),
  ].join(' ');

  return { confirmedSources, evidenceLines, narrative };
}

// ── Geometry helpers ────────────────────────────────────────

function boundsFromPoint(lat: number, lng: number, paddingMiles: number): BoundingBox {
  const latDeg = paddingMiles / 69; // 1° lat ≈ 69 mi
  const lngDeg = paddingMiles / (69 * Math.cos((lat * Math.PI) / 180));
  return {
    north: lat + latDeg,
    south: lat - latDeg,
    east: lng + lngDeg,
    west: lng - lngDeg,
  };
}

function withinRadius(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
  radiusMiles: number,
): boolean {
  return haversineMiles(lat1, lng1, lat2, lng2) <= radiusMiles;
}

function haversineMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3958.8;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function emptyArray<T>(): T[] {
  return [];
}

function emptySynoptic(): SynopticCorroboration {
  return {
    query: { startUtc: '', endUtc: '' },
    stationsTotal: 0,
    stationsWithHailSignal: 0,
    stationsWithSevereWindSignal: 0,
    stations: [],
    fetchedAt: new Date().toISOString(),
  };
}

function formatDateLabel(date: string): string {
  // YYYY-MM-DD → e.g. "April 1, 2026"
  const d = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return date;
  return d.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'America/New_York',
  });
}
