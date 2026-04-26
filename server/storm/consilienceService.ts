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
import { fetchMpingReportsForDate, type MpingReport } from './mpingService.js';
import { fetchHailtraceReportsForDate, isHailtraceConfigured, type HailtraceReport } from './hailtraceClient.js';
import { fetchSwdiHailReports, type SwdiHailReport } from './ncerSwdiClient.js';
import { fetchIemVtecForDate, pointInWarning, type IemVtecWarning } from './iemVtecClient.js';
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
  mping: SourceResultBase & {
    reportCount: number;
    maxHailInches: number;
    nearestMiles: number | null;
  };
  hailtrace: SourceResultBase & {
    configured: boolean;
    reportCount: number;
    maxHailInches: number;
    nearestMiles: number | null;
    certifiedCount: number;
  };
  ncerSwdi: SourceResultBase & {
    cellCount: number;
    maxHailInches: number;
    peakSeverePct: number;
    radarStations: string[];
  };
  nwsWarnings: SourceResultBase & {
    warningCount: number;
    inWarningPolygon: boolean;
    types: string[];
  };
}

export type ConfidenceTier =
  | 'none'
  | 'single'
  | 'cross-verified'
  | 'triple-verified'
  | 'quadruple-verified'
  | 'quintuple-verified'
  | 'sextuple-verified'
  | 'septuple-verified'
  | 'octuple-verified'
  | 'nontuple-verified';

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

  // Fire all source fetches concurrently. Each handles its own errors
  // (returns empty/null) so a single source failure doesn't fail the call.
  const results = await Promise.all([
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
    fetchMpingReportsForDate({ date: query.date, bounds }).catch(emptyArray<MpingReport>),
    fetchHailtraceReportsForDate({
      date: query.date,
      bbox: { north: bounds.north, south: bounds.south, east: bounds.east, west: bounds.west },
    }).catch(emptyArray<HailtraceReport>),
    fetchSwdiHailReports({ date: query.date, bbox: bounds }).catch(emptyArray<SwdiHailReport>),
    fetchIemVtecForDate({ date: query.date, bounds }).catch(emptyArray<IemVtecWarning>),
  ]);
  const mrmsResult = results[0];
  const spcHailReports = results[1] as HailPointReport[];
  const iemHailReportsResult = results[2] as HailPointReport[];
  const spcWindReports = results[3] as WindReport[];
  const iemWindReportsResult = results[4] as WindReport[];
  const synopticResult = results[5] as SynopticCorroboration;
  const mpingResults = results[6] as MpingReport[];
  const hailtraceResults = results[7] as HailtraceReport[];
  const swdiResults = results[8] as SwdiHailReport[];
  const vtecResults = results[9] as IemVtecWarning[];

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

  // ── mPING ────────────────────────────────────────────
  const mping = analyzeMping(
    mpingResults.filter((r) =>
      withinRadius(r.lat, r.lng, query.lat, query.lng, radius),
    ),
    query.lat,
    query.lng,
  );

  // ── HailTrace ────────────────────────────────────────
  const hailtrace = analyzeHailtrace(
    hailtraceResults.filter((r) =>
      withinRadius(r.lat, r.lng, query.lat, query.lng, radius),
    ),
    query.lat,
    query.lng,
  );

  // ── NCEI SWDI (NX3HAIL — radar TVS-based hail detection) ─────
  const ncerSwdi = analyzeSwdi(
    swdiResults.filter((r) =>
      withinRadius(r.lat, r.lng, query.lat, query.lng, radius),
    ),
  );

  // ── NWS warnings (IEM VTEC — point-in-polygon) ──────────────
  const nwsWarnings = analyzeNwsWarnings(vtecResults, query.lat, query.lng);

  const confirmedCount =
    Number(mrms.confirmed) +
    Number(spcHail.confirmed) +
    Number(iemLsrHail.confirmed) +
    Number(windContext.confirmed) +
    Number(synoptic.confirmed) +
    Number(mping.confirmed) +
    Number(hailtrace.confirmed) +
    Number(ncerSwdi.confirmed) +
    Number(nwsWarnings.confirmed);

  const confidenceTier: ConfidenceTier =
    confirmedCount >= 9
      ? 'nontuple-verified'
      : confirmedCount === 8
        ? 'octuple-verified'
        : confirmedCount === 7
          ? 'septuple-verified'
          : confirmedCount === 6
            ? 'sextuple-verified'
            : confirmedCount === 5
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
    mping,
    hailtrace,
    ncerSwdi,
    nwsWarnings,
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

function analyzeSwdi(reports: SwdiHailReport[]): ConsilienceSources['ncerSwdi'] {
  if (reports.length === 0) {
    return {
      confirmed: false,
      cellCount: 0,
      maxHailInches: 0,
      peakSeverePct: 0,
      radarStations: [],
    };
  }
  const max = reports.reduce((m, r) => Math.max(m, r.maxSizeInches), 0);
  const peakSev = reports.reduce((m, r) => Math.max(m, r.severeProb), 0);
  const stations = [...new Set(reports.map((r) => r.wsrId).filter(Boolean))];
  // ≥0.5" detected hail with ≥30% severe-prob is meaningful corroboration.
  const confirmed = max >= 0.5 && peakSev >= 30;
  const evidence = confirmed
    ? `NEXRAD TVS hail detection (NCEI SWDI): ${reports.length} cell${reports.length === 1 ? '' : 's'} from ${stations.join(', ') || 'WSR-88D'}, peak ${max.toFixed(2)}" (${peakSev.toFixed(0)}% severe).`
    : undefined;
  return {
    confirmed,
    evidence,
    cellCount: reports.length,
    maxHailInches: max,
    peakSeverePct: peakSev,
    radarStations: stations,
  };
}

function analyzeNwsWarnings(
  warnings: IemVtecWarning[],
  lat: number,
  lng: number,
): ConsilienceSources['nwsWarnings'] {
  if (warnings.length === 0) {
    return {
      confirmed: false,
      warningCount: 0,
      inWarningPolygon: false,
      types: [],
    };
  }
  // Check whether the property fell inside ANY warning polygon — that's
  // the strongest signal (NWS officially declared a SVR/Tornado warning at
  // this location during the storm).
  const overlapping = warnings.filter((w) => pointInWarning(lat, lng, w));
  const inPolygon = overlapping.length > 0;
  const typeSet = new Set<string>();
  for (const w of overlapping.length > 0 ? overlapping : warnings) {
    if (w.phenomenon === 'SV') typeSet.add('Severe Thunderstorm');
    else if (w.phenomenon === 'TO') typeSet.add('Tornado');
    else if (w.phenomenon === 'FF') typeSet.add('Flash Flood');
    else if (w.phenomenon === 'EW') typeSet.add('Extreme Wind');
  }
  const types = [...typeSet];
  // If the property is inside a warning polygon, that's a confirmation.
  // Nearby (in radius) warnings count as supporting context but not
  // confirmation here — we already have radial sources for that.
  const confirmed = inPolygon;
  const evidence = confirmed
    ? `NWS warning archive: property fell inside ${overlapping.length} ${types.join(' + ')} warning${overlapping.length === 1 ? '' : 's'} (${overlapping[0]?.wfo || 'NWS'}).`
    : undefined;
  return {
    confirmed,
    evidence,
    warningCount: warnings.length,
    inWarningPolygon: inPolygon,
    types,
  };
}

function analyzeHailtrace(
  reports: HailtraceReport[],
  lat: number,
  lng: number,
): ConsilienceSources['hailtrace'] {
  const configured = isHailtraceConfigured();
  if (reports.length === 0) {
    return {
      confirmed: false,
      configured,
      reportCount: 0,
      maxHailInches: 0,
      nearestMiles: null,
      certifiedCount: 0,
    };
  }
  const maxInches = reports.reduce((m, r) => Math.max(m, r.sizeInches), 0);
  const nearest = reports.reduce(
    (best, r) => {
      const d = haversineMiles(lat, lng, r.lat, r.lng);
      return d < best ? d : best;
    },
    Number.POSITIVE_INFINITY,
  );
  const certifiedCount = reports.filter((r) => r.certified).length;
  const confirmed = maxInches >= 0.25;
  const certifiedSuffix =
    certifiedCount > 0
      ? `, ${certifiedCount} meteorologist-certified`
      : '';
  const evidence = confirmed
    ? `HailTrace database: ${reports.length} hail event${reports.length === 1 ? '' : 's'} within ${nearest.toFixed(1)} mi, peak size ${maxInches.toFixed(2)}"${certifiedSuffix}.`
    : undefined;
  return {
    confirmed,
    evidence,
    configured,
    reportCount: reports.length,
    maxHailInches: maxInches,
    nearestMiles: Number.isFinite(nearest) ? nearest : null,
    certifiedCount,
  };
}

function analyzeMping(
  reports: MpingReport[],
  lat: number,
  lng: number,
): ConsilienceSources['mping'] {
  // Only Hail-category reports counted toward hail consilience. Wind/tornado
  // reports could be wired into windContext later.
  const hail = reports.filter((r) => r.category === 'Hail');
  if (hail.length === 0) {
    return { confirmed: false, reportCount: 0, maxHailInches: 0, nearestMiles: null };
  }
  const maxInches = hail.reduce((m, r) => Math.max(m, r.hailSizeInches), 0);
  const nearest = hail.reduce(
    (best, r) => {
      const d = haversineMiles(lat, lng, r.lat, r.lng);
      return d < best ? d : best;
    },
    Number.POSITIVE_INFINITY,
  );
  // mPING reports are crowdsourced — single-report bar is low (any sized
  // hail report from a real human within 5mi is meaningful), but we still
  // require ≥0.25" to filter out micro-hail / sleet noise.
  const confirmed = maxInches >= 0.25;
  const evidence = confirmed
    ? `mPING crowd reports: ${hail.length} hail observation${hail.length === 1 ? '' : 's'} within ${nearest.toFixed(1)} mi, peak size ${maxInches.toFixed(2)}".`
    : undefined;
  return {
    confirmed,
    evidence,
    reportCount: hail.length,
    maxHailInches: maxInches,
    nearestMiles: Number.isFinite(nearest) ? nearest : null,
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
  if (sources.mping.confirmed && sources.mping.evidence) {
    confirmedSources.push('mPING crowd reports');
    evidenceLines.push(sources.mping.evidence);
  }
  if (sources.hailtrace.confirmed && sources.hailtrace.evidence) {
    confirmedSources.push('HailTrace');
    evidenceLines.push(sources.hailtrace.evidence);
  }
  if (sources.ncerSwdi.confirmed && sources.ncerSwdi.evidence) {
    confirmedSources.push('NCEI SWDI radar');
    evidenceLines.push(sources.ncerSwdi.evidence);
  }
  if (sources.nwsWarnings.confirmed && sources.nwsWarnings.evidence) {
    confirmedSources.push('NWS warnings');
    evidenceLines.push(sources.nwsWarnings.evidence);
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
