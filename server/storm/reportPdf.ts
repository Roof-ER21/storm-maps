/**
 * Fallback storm-day PDF report — used when the Susan21 polished PDF is
 * unavailable. Built with PDFKit (no headless browser, no native deps).
 *
 * Sections:
 *   1. Header — rep + company + address + date of loss
 *   2. Storm summary — peak hail, peak wind, event count, damage score
 *   3. Vector swath visualization — drawn from swath_cache, projected onto
 *      a square area on the page. No basemap (we don't ship Google Static
 *      Maps server-side); just the polygons + bbox grid.
 *   4. Event detail table — top 20 reports for the date
 *   5. Footer — sources + generated-at
 *
 * Returns a `Buffer` so the express handler can `res.send(...)` directly.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import PDFDocument from 'pdfkit';

// Resolve the header logos once at module load.
//   LOGO_PATH      → Roof-ER company wordmark (left side, 140×60 box)
//   SEAL_LOGO_PATH → Hail Yes! brand square seal (right side, 52×52 box)
// Layout per user direction 4/28/26: company logo left, product seal right
// (mirrors the s21-style report). Roof-ER is the company; Hail Yes is the
// tool generating the report.
const LOGO_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'assets',
  'roofer-logo.png',
);
const SEAL_LOGO_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'assets',
  'hail-yes-seal.png',
);
import {
  buildMrmsVectorPolygons,
  buildMrmsImpactResponse,
  type MrmsImpactResult,
} from './mrmsService.js';
import { composeStormNarrative } from './narrativeComposer.js';
import { haversineMiles, pointInRing } from './geometry.js';
import { buildHailFallbackCollection } from './hailFallbackService.js';
import { fetchStormEventsCached, type StormEventDto } from './eventService.js';
import { buildConsilience, type ConsilienceResult } from './consilienceService.js';
import { fetchNexradImageForWarning } from './nexradWarningImage.js';
import { fetchNwsWarningsForProperty } from './nwsWarningsService.js';
// fetchIemVtecForDate / pointInWarning are now consumed via the
// fetchNwsWarningsForProperty wrapper (nwsWarningsService.ts); no
// direct imports needed here in the redesigned PDF.
import { sql as pgSql } from '../db.js';
import type { BoundingBox } from './types.js';
import {
  bandVerification as buildBandVerification,
  displayHailInches,
  type VerificationContext,
} from './displayCapService.js';
import { buildVerificationBulk } from './verificationService.js';
import {
  isGovObserverSource,
  primarySourceLabel,
  type SourceFlags,
} from './sourceTier.js';
import {
  computeDirectionAndSpeedFromPoints,
  computeDurationFromPoints,
  computeHailDuration,
  computePeakTimeFromPoints,
  computeStormDirectionAndSpeed,
  computeStormPeakTime,
  filterEventsByEtDate,
} from './stormMetrics.js';

interface NceiAppendixRow {
  event_date: string;
  state_code: string | null;
  county: string | null;
  event_type: string | null;
  magnitude: number | null;
  /** F0–F5 / EF0–EF5 — populated for Tornado rows from NCEI's TOR_F_SCALE. */
  tor_f_scale: string | null;
  ncei_event_id: string | null;
  begin_time_utc: string | null;
  narrative: string | null;
  /** Event lat/lng — used to compute haversine distance to subject property
   *  for tier classification + "X mi away" copy. Without these columns the
   *  hit history defaulted every distance to 5 mi (visible bug: every row
   *  read "1.00\" hail · 5.0 mi away"). */
  lat: number | null;
  lng: number | null;
  /** Source flags — driven by sourceTier.classifySource for the
   *  primary-vs-supplemental gating per the 2026-04-27 afternoon
   *  addendum. Only primary sources move the headline display cells;
   *  supplemental sources are still surfaced in the Sources detail
   *  section. */
  source_ncei_storm_events: boolean | null;
  source_iem_lsr: boolean | null;
  source_nws_warnings: boolean | null;
  source_ncei_swdi: boolean | null;
  source_mping: boolean | null;
  source_hailtrace: boolean | null;
  source_spc_hail: boolean | null;
  source_synoptic: boolean | null;
}

async function fetchNceiArchiveForReport(opts: {
  lat: number;
  lng: number;
  dateOfLoss: string;
  radiusMiles: number;
  windowDays?: number;
  /** When true, restrict to NCEI Storm Events Database rows only (for the
   *  bottom appendix). When false (default — used by the Property Hail Hit
   *  History panel), pull from ALL ingest sources: NCEI, SPC WCM, IEM LSR,
   *  NEXRAD SWDI, CoCoRaHS, HailTrace, MRMS swath. Mirrors SA21's
   *  storm_days_public materialized view that backs sa21.up.railway.app's
   *  storm-maps page (which sees 15 hail dates / 605 reports for properties
   *  where our NCEI-only filter sees 4). */
  nceiOnly?: boolean;
}): Promise<NceiAppendixRow[]> {
  if (!pgSql) return [];
  const days = opts.windowDays ?? 30;
  // Tight bbox around property — radius+pad in degrees.
  const latPad = (opts.radiusMiles + 5) / 69;
  const lngPad = (opts.radiusMiles + 5) / (69 * Math.cos((opts.lat * Math.PI) / 180));
  try {
    const rows = opts.nceiOnly
      ? await pgSql<NceiAppendixRow[]>`
          SELECT event_date::text, state_code, county, event_type,
                 magnitude, tor_f_scale, ncei_event_id::text,
                 begin_time_utc::text, narrative,
                 lat::float AS lat, lng::float AS lng,
                 source_ncei_storm_events,
                 source_iem_lsr,
                 source_nws_warnings,
                 source_ncei_swdi,
                 source_mping,
                 source_hailtrace,
                 source_spc_hail,
                 source_synoptic
            FROM verified_hail_events
           WHERE source_ncei_storm_events = TRUE
             AND lat BETWEEN ${opts.lat - latPad} AND ${opts.lat + latPad}
             AND lng BETWEEN ${opts.lng - lngPad} AND ${opts.lng + lngPad}
             AND event_date BETWEEN
                 (${opts.dateOfLoss}::date - ${days}::int)
             AND (${opts.dateOfLoss}::date + ${days}::int)
           ORDER BY event_date DESC, magnitude DESC NULLS LAST
           LIMIT 500
        `
      : await pgSql<NceiAppendixRow[]>`
          SELECT event_date::text, state_code, county, event_type,
                 magnitude, tor_f_scale, ncei_event_id::text,
                 begin_time_utc::text, narrative,
                 lat::float AS lat, lng::float AS lng,
                 source_ncei_storm_events,
                 source_iem_lsr,
                 source_nws_warnings,
                 source_ncei_swdi,
                 source_mping,
                 source_hailtrace,
                 source_spc_hail,
                 source_synoptic
            FROM verified_hail_events
           WHERE (
                  source_ncei_storm_events = TRUE
               OR source_iem_lsr = TRUE
               OR source_ncei_swdi = TRUE
               OR source_mping = TRUE
               OR source_hailtrace = TRUE
               OR source_nws_warnings = TRUE
               OR source_spc_hail = TRUE
             )
             AND lat BETWEEN ${opts.lat - latPad} AND ${opts.lat + latPad}
             AND lng BETWEEN ${opts.lng - lngPad} AND ${opts.lng + lngPad}
             AND event_date BETWEEN
                 (${opts.dateOfLoss}::date - ${days}::int)
             AND (${opts.dateOfLoss}::date + ${days}::int)
           ORDER BY event_date DESC, magnitude DESC NULLS LAST
           LIMIT 500
        `;
    return rows;
  } catch (err) {
    console.warn('[reportPdf] history fetch failed:', (err as Error).message);
    return [];
  }
}

const GOOGLE_STATIC_MAPS_API_KEY =
  process.env.GOOGLE_STATIC_MAPS_API_KEY?.trim() ||
  process.env.GOOGLE_MAPS_API_KEY?.trim() ||
  '';

export interface ReportEvidenceItem {
  /** Public URL or data URL — both are fetched + embedded. */
  imageUrl?: string;
  /** Pre-fetched bytes (base64 or raw) from the frontend; preferred over URL. */
  imageDataUrl?: string;
  title?: string;
  caption?: string;
}

export interface ReportRequest {
  address: string;
  lat: number;
  lng: number;
  radiusMiles: number;
  dateOfLoss: string;
  /** Anchor timestamp (when known) for the storm — picks the right MRMS file. */
  anchorTimestamp?: string | null;
  rep: { name: string; phone?: string; email?: string };
  company: { name: string };
  /** Optional homeowner name — surfaces in the Property Information
   *  "Customer Info:" subsection. Omitted entirely when undefined/empty. */
  customerName?: string;
  /** Override events; if omitted we pull from the in-repo /api/storm/events cache. */
  events?: StormEventDto[];
  /** Override bounds; if omitted we derive from event extent + 25 mi pad. */
  bounds?: BoundingBox;
  /** Evidence images to embed at the end of the report. Up to 6 are rendered. */
  evidence?: ReportEvidenceItem[];
}

/**
 * 2026-04-27 PDF redesign — concrete layout constants from
 * PDF-REDESIGN-LAYOUT.md. Sourced from the target reference at
 * ~/Downloads/E2E_Fresh_Test.pdf via pdfminer measurement.
 */
export const PDF_LAYOUT = {
  page: { width: 612, height: 792 },
  margin: { top: 8, bottom: 40, left: 50, right: 50 },
  contentWidth: 512,

  colors: {
    bannerBg: '#D9D9D9',
    bannerText: '#4A4A4A',
    bodyText: '#1A1A1A',
    labelGray: '#666666',
    mutedGray: '#8C8C8C',
    borderGray: '#BFBFBF',
    stripBg: '#E8E8E8',
    brandRed: '#C8102E',
    linkRed: '#C8102E',
    rowStripe: '#F7F7F7',
    white: '#FFFFFF',
  },

  banner: { height: 22, fontSize: 13, padTop: 14, padBottom: 8 },

  header: {
    topStrip: { y: 0, height: 22, fontSize: 9.5 },
    logo: { x: 50, y: 35, w: 140, h: 60 },
    repContact: { x: 220, y: 47, w: 100 },
    reportMeta: { x: 331.6, y: 42, w: 130 },
    seal: { x: 510, y: 38, w: 52, h: 52, radius: 6 },
    verifyStrip: { y: 102, height: 18, fontSize: 8.5 },
  },

  property: {
    map: { x: 70, w: 160, h: 120, zoom: 16, type: 'roadmap' },
    text: { x: 245, w: 317 },
  },

  hailImpact: {
    rowHeight: 18,
    rows: 4,
    col: {
      label1: { x: 58, w: 140 },
      value1: { x: 200, w: 110 },
      label2: { x: 314, w: 140 },
      value2: { x: 456, w: 100 },
    },
  },

  groundObs: {
    headerHeight: 18,
    bodyRowHeight: 24,
    headerFontSize: 8.5,
    bodyFontSize: 8.5,
    cellPad: { top: 4, left: 4 },
    cols: {
      hail: [
        { key: 'datetime', label: 'Date / Time', x: 54, w: 80 },
        { key: 'source', label: 'Source', x: 134, w: 50 },
        { key: 'size', label: 'Hail Size', x: 184, w: 55 },
        { key: 'distance', label: 'Distance from Property', x: 239, w: 130 },
        { key: 'comments', label: 'Comments', x: 369, w: 193 },
      ] as const,
      wind: [
        { key: 'datetime', label: 'Date / Time', x: 54, w: 80 },
        { key: 'source', label: 'Source', x: 134, w: 50 },
        { key: 'speed', label: 'Wind Speed', x: 184, w: 55 },
        { key: 'distance', label: 'Distance from Property', x: 239, w: 130 },
        { key: 'comments', label: 'Comments', x: 369, w: 193 },
      ] as const,
    },
  },

  warning: {
    image: { x: 50, w: 200, h: 130 },
    rightCol: { x: 265, w: 297 },
    titleFontSize: 10,
    titleLineHeight: 11.5,
    grid: {
      rowPitch: 18,
      rows: 3,
      col: { labelL: 265, valueL: 340, labelR: 413.5, valueR: 488.5 },
    },
    captionFontSize: 8,
    narrativeFontSize: 8.5,
    blockHeight: 210,
  },

  historical: {
    headerHeight: 22,
    bodyRowHeight: 30,
    headerFontSize: 8,
    bodyFontSize: 8,
    cellPad: { top: 6, left: 4 },
    cols: [
      { key: 'mapDate', label: 'Map Date*', x: 54, w: 62 },
      { key: 'impactTime', label: 'Impact Time', x: 116, w: 70 },
      { key: 'direction', label: 'Direction', x: 186, w: 48 },
      { key: 'speed', label: 'Speed', x: 234, w: 38 },
      { key: 'duration', label: 'Duration', x: 272, w: 44 },
      { key: 'atLocation', label: 'At Location', x: 316, w: 58 },
      { key: 'within1mi', label: 'Within 1mi', x: 374, w: 54 },
      { key: 'within3mi', label: 'Within 3mi', x: 428, w: 54 },
      { key: 'within10mi', label: 'Within 10mi', x: 482, w: 80 },
    ] as const,
    footnoteFontSize: 8,
  },

  copyright: { height: 24, fontSize: 9.5 },
} as const;

// (RenderedPolygon, hexToRgb, makeMercatorProjector helpers removed in
// Phase 7 cleanup — they were only used by the deleted "NEXRAD Radar +
// Hail Footprint Map" wide-map section. The vector swath rendering
// machinery lives in mrmsService.ts; this PDF doesn't draw maps anymore.)

/**
 * Fetch a Google Static Maps roadmap centered on the property point at a
 * fixed zoom. Used by the Section 1 Property Information layout (160×120
 * pt slot, zoom 16). 8s timeout, returns null on any failure — the PDF
 * still renders the address column without it.
 */
async function fetchPropertyRoadmap(
  lat: number,
  lng: number,
  width: number,
  height: number,
  zoom = 16,
): Promise<Buffer | null> {
  if (!GOOGLE_STATIC_MAPS_API_KEY) return null;
  const sizeW = Math.min(640, Math.max(120, Math.round(width)));
  const sizeH = Math.min(640, Math.max(120, Math.round(height)));
  const params = new URLSearchParams({
    center: `${lat.toFixed(6)},${lng.toFixed(6)}`,
    zoom: String(zoom),
    size: `${sizeW}x${sizeH}`,
    scale: '2',
    maptype: 'roadmap',
    markers: `color:red|${lat.toFixed(6)},${lng.toFixed(6)}`,
    key: GOOGLE_STATIC_MAPS_API_KEY,
  });
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 8_000);
    const res = await fetch(
      `https://maps.googleapis.com/maps/api/staticmap?${params.toString()}`,
      { signal: ac.signal },
    );
    clearTimeout(timer);
    if (!res.ok) return null;
    const ab = await res.arrayBuffer();
    return Buffer.from(ab);
  } catch {
    return null;
  }
}

// (fetchSatelliteAerial, fetchStreetViewImage, fetchEvidenceImageBytes
// removed in Phase 7 cleanup — none of the new sections render
// satellite or street-view imagery, and Field Evidence was retired.
// fetchPropertyRoadmap above replaces them for the new Property Information
// map slot.)

function deriveBounds(events: StormEventDto[], lat: number, lng: number): BoundingBox {
  if (events.length === 0) {
    return {
      north: lat + 0.5,
      south: lat - 0.5,
      east: lng + 0.5,
      west: lng - 0.5,
    };
  }
  let north = -Infinity,
    south = Infinity,
    east = -Infinity,
    west = Infinity;
  for (const e of events) {
    if (e.beginLat > north) north = e.beginLat;
    if (e.beginLat < south) south = e.beginLat;
    if (e.beginLon > east) east = e.beginLon;
    if (e.beginLon < west) west = e.beginLon;
  }
  // Pad ~0.4° (≈25 mi).
  return {
    north: north + 0.4,
    south: south - 0.4,
    east: east + 0.4,
    west: west - 0.4,
  };
}

/**
 * Display floor — sub-¼" hail rounded UP to "0.25"" so adjusters don't
 * dismiss "0.13"" trace radar signatures. Matches Verisk/ISO + Gemini
 * Field's display convention.
 */
/** Pure formatter — takes a (capped) hail size and renders it. */
function formatHailIn(inches: number | null): string {
  if (inches === null || inches <= 0) return '—';
  return `${inches.toFixed(2)}"`;
}

/**
 * Apply the 2026-04-27 display-cap algorithm and return formatted string.
 *
 * Use this for ANY at-property or distance-band hail display in the PDF.
 * The raw input might be 4" (a single hot MRMS pixel); the cap returns
 * 2.5"/2.0"/etc. per the verified-vs-unverified rules + Sterling-class +
 * cross-source consensus override.
 */
function displayHailIn(
  inches: number | null,
  ctx: VerificationContext,
): string {
  return formatHailIn(displayHailInches(inches ?? 0, ctx));
}

/** Default ctx for places where we don't (yet) have a verification — falls
 *  through to the unverified-cap branches in displayHailInches. */
const UNVERIFIED_CTX: VerificationContext = {
  isVerified: false,
  isAtLocation: false,
  isSterlingClass: false,
  consensusSize: null,
};

/** "Far band" ctx — strips the consensus override since cross-source
 *  agreement at ≤0.5 mi shouldn't dictate the size shown for the 1–3 mi
 *  or 3–5 mi columns. The verified/Sterling flags still apply. */
function farBandCtx(ctx: VerificationContext): VerificationContext {
  return { ...ctx, consensusSize: null };
}

/** Local convenience wrapper — every callsite below uses this signature.
 *  The shared implementation lives in displayCapService.ts; we close over
 *  isGovObserverSource from sourceTier so it doesn't need to be passed at
 *  every call. */
function bandVerification(
  reports: Array<{ source: string; sizeIn: number }>,
  date: string,
  lat: number,
  lng: number,
): VerificationContext {
  return buildBandVerification(reports, date, lat, lng, isGovObserverSource);
}

export async function buildStormReportPdf(req: ReportRequest): Promise<Buffer> {
  // Fire consilience (5-source corroboration) early so it overlaps with the
  // event/swath fetch work below. 25s soft cap — PDF still renders without
  // it. Auto-curate rule applied at render time: only positives are shown.
  const consiliencePromise: Promise<ConsilienceResult | null> = Promise.race([
    buildConsilience({
      lat: req.lat,
      lng: req.lng,
      date: req.dateOfLoss,
      radiusMiles: Math.min(req.radiusMiles, 10),
    }).catch((err) => {
      console.warn('[reportPdf] consilience failed:', (err as Error).message);
      return null;
    }),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 25_000)),
  ]);

  // 2026-04-27 redesign — Property Information map (Section 1) is a
  // tighter zoom 16 roadmap centered on the property pin. Start the
  // fetch now so it's ready by the time we render Section 1.
  // fetchPropertyRoadmap enforces its own 8s abort.
  const propertyMapPromise: Promise<Buffer | null> = Promise.race([
    fetchPropertyRoadmap(req.lat, req.lng, 320, 240, PDF_LAYOUT.property.map.zoom),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 10_000)),
  ]);

  // 1. Resolve events (fall through to cached aggregator if not passed).
  let events = req.events;
  if (!events) {
    const result = await fetchStormEventsCached({
      lat: req.lat,
      lng: req.lng,
      radiusMiles: req.radiusMiles,
      months: 12,
      sinceDate: null,
    });
    events = result.events;
  }
  const datedEvents = events.filter((e) => {
    // Eastern-day match — same rule as the frontend reportService uses.
    const t = new Date(e.beginDate);
    if (Number.isNaN(t.getTime())) return false;
    const easternDate = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/New_York',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(t);
    return easternDate === req.dateOfLoss;
  });

  const bounds = req.bounds ?? deriveBounds(datedEvents, req.lat, req.lng);

  // 2. Pull swath polygons — try real MRMS first, then in-repo fallback.
  let collection = await buildMrmsVectorPolygons({
    date: req.dateOfLoss,
    bounds,
    anchorIso: req.anchorTimestamp ?? undefined,
  });
  if (!collection || collection.features.length === 0) {
    const fb = await buildHailFallbackCollection({
      date: req.dateOfLoss,
      bounds,
    });
    if (fb && fb.features.length > 0) {
      collection = {
        type: 'FeatureCollection',
        features: fb.features.map((f) => ({
          type: 'Feature',
          properties: {
            level: f.properties.level,
            sizeInches: f.properties.sizeInches,
            sizeMm: f.properties.sizeMm,
            label: f.properties.label,
            color: f.properties.color,
            severity: f.properties.severity,
          },
          geometry: f.geometry,
        })),
        metadata: {
          date: req.dateOfLoss,
          refTime: req.dateOfLoss + 'T23:30:00Z',
          bounds,
          maxHailInches: fb.metadata.maxHailInches,
          hailCells: fb.metadata.reportCount,
          sourceFile: 'fallback:SPC+IEM',
          generatedAt: new Date().toISOString(),
          source: 'mrms-vector',
        },
      };
    }
  }

  // 3. Render PDF.
  const doc = new PDFDocument({
    size: 'LETTER',
    margins: {
      top: PDF_LAYOUT.margin.top,
      bottom: PDF_LAYOUT.margin.bottom,
      left: PDF_LAYOUT.margin.left,
      right: PDF_LAYOUT.margin.right,
    },
    info: {
      Title: `Hail Impact Report - ${req.address}`,
      Author: 'Hail Yes Storm Intelligence',
      Subject: `Hail Impact Report for ${req.address}`,
      Creator: 'Hail Yes! · HYSI Weather Intelligence Platform',
    },
  });
  const chunks: Buffer[] = [];
  doc.on('data', (c) => chunks.push(c as Buffer));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  // Page geometry shared by every section helper. Margins are 50/50 left
  // and right per the 2026-04-27 redesign (was 54/54). Anything 50→562
  // is content; banner fills span exactly that range. Top strip and
  // verification strip are full-bleed (0→612).
  const M = PDF_LAYOUT.margin.left;
  const PW = PDF_LAYOUT.page.width;
  const CW = PDF_LAYOUT.contentWidth;
  const BOTTOM = 752;
  const COLOR = PDF_LAYOUT.colors;

  // Universal section banner — gray fill, centered title, NOT bold (target
  // PDF uses Helvetica regular at 13 pt). Replaces the legacy navy/italic
  // banner. Auto-paginates if banner + 24pt content tail won't fit.
  const drawSectionBanner = (title: string): void => {
    const h = PDF_LAYOUT.banner.height;
    if (doc.y + h + 24 > BOTTOM) doc.addPage();
    doc.y = Math.max(doc.y, PDF_LAYOUT.margin.top + 8);
    const y = doc.y;
    doc.rect(M, y, CW, h).fill(COLOR.bannerBg);
    doc
      .fillColor(COLOR.bannerText)
      .font('Helvetica')
      .fontSize(PDF_LAYOUT.banner.fontSize)
      .text(title, M, y + 5, { width: CW, align: 'center' });
    doc.y = y + h + PDF_LAYOUT.banner.padBottom;
  };

  // Auto-generated identifiers — adjuster trust signals.
  const reportId = `${Math.floor(Date.now() / 1000)}-${Math.floor(Math.random() * 9_999_999)
    .toString()
    .padStart(7, '0')}`;
  const verificationCode = Math.random().toString(16).substring(2, 8);

  // ── Header (top strip + 3-col + verification strip) ────────────────────

  // 2a. Top thin gray strip — full-bleed "Hail Impact Report #: <id>"
  {
    const ts = PDF_LAYOUT.header.topStrip;
    doc.rect(0, ts.y, PW, ts.height).fill(COLOR.stripBg);
    doc
      .fillColor(COLOR.labelGray)
      .font('Helvetica')
      .fontSize(ts.fontSize)
      .text(`Hail Impact Report #: ${reportId}`, 0, ts.y + 6, {
        width: PW,
        align: 'center',
      });
  }

  // 2b. Three-column header row + logos (y = 35..95)
  // ── Left logo box — Roof-ER company wordmark (server/assets/roofer-logo.png) ──
  // PNG is 768×433 (~1.77:1); fit-into the 140×60 box with doc.image's
  // `fit` option which preserves aspect ratio. Hail Yes seal lives on the
  // right side as the product badge.
  {
    const lg = PDF_LAYOUT.header.logo;
    try {
      doc.image(LOGO_PATH, lg.x, lg.y, {
        fit: [lg.w, lg.h],
        align: 'left',
        valign: 'center',
      });
    } catch (err) {
      console.warn('[reportPdf] logo image embed failed:', (err as Error).message);
      // Fallback to text wordmark so the header still renders something
      // recognizable if the asset goes missing or PDFKit chokes on it.
      doc
        .fillColor(COLOR.brandRed)
        .font('Helvetica-Bold')
        .fontSize(22)
        .text('ROOFER', lg.x, lg.y + 14, { width: lg.w, align: 'left' });
      doc
        .fillColor(COLOR.brandRed)
        .font('Helvetica-Bold')
        .fontSize(8)
        .text('THE ROOF DOCS', lg.x, lg.y + 44, {
          width: lg.w,
          align: 'left',
          characterSpacing: 1,
        });
    }
  }

  // ── Center-left rep contact ──
  {
    const rc = PDF_LAYOUT.header.repContact;
    let yc = rc.y;
    if (req.rep?.name) {
      doc
        .fillColor(COLOR.bodyText)
        .font('Helvetica-Bold')
        .fontSize(9)
        .text(req.rep.name, rc.x, yc, { width: rc.w, lineBreak: false });
      yc += 10;
    }
    if (req.rep?.phone) {
      doc
        .fillColor(COLOR.bodyText)
        .font('Helvetica')
        .fontSize(8.5)
        .text(req.rep.phone, rc.x, yc, { width: rc.w, lineBreak: false });
      yc += 10;
    }
    if (req.rep?.email) {
      doc
        .fillColor(COLOR.linkRed)
        .font('Helvetica')
        .fontSize(8.5)
        .text(req.rep.email, rc.x, yc, {
          width: rc.w,
          lineBreak: false,
          underline: true,
        });
    }
  }

  // ── Center-right report metadata ──
  {
    const rm = PDF_LAYOUT.header.reportMeta;
    doc
      .fillColor(COLOR.bodyText)
      .font('Helvetica-Bold')
      .fontSize(11)
      .text('Hail Impact Report', rm.x, rm.y, { width: rm.w, lineBreak: false });
    const dateStr = new Date().toLocaleString('en-US', {
      timeZone: 'America/New_York',
      month: 'numeric',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZoneName: 'short',
    });
    doc
      .fillColor(COLOR.bodyText)
      .font('Helvetica')
      .fontSize(8.5)
      .text(`Report #: ${reportId}`, rm.x, rm.y + 13, {
        width: rm.w,
        lineBreak: false,
      });
    doc.text(`Date: ${dateStr}`, rm.x, rm.y + 23, {
      width: rm.w,
      lineBreak: false,
    });
    doc.text('Hail Yes Storm Intelligence', rm.x, rm.y + 33, {
      width: rm.w,
      lineBreak: false,
    });
  }

  // ── Right seal/badge — Hail Yes! brand square (server/assets/hail-yes-seal.png) ──
  // 256×256 PNG rendered from the brand favicon SVG (purple rounded
  // square + cloud + hail streaks). Embedded in the 52×52 seal slot via
  // doc.image's `fit`. Falls through to the previous red-square + "HY"
  // text glyph if the PNG fails to load, so the header always renders
  // something recognizable.
  {
    const sl = PDF_LAYOUT.header.seal;
    try {
      doc.image(SEAL_LOGO_PATH, sl.x, sl.y, {
        fit: [sl.w, sl.h],
        align: 'center',
        valign: 'center',
      });
    } catch (err) {
      console.warn('[reportPdf] seal image embed failed:', (err as Error).message);
      doc
        .roundedRect(sl.x, sl.y, sl.w, sl.h, sl.radius)
        .fill(COLOR.brandRed);
      doc
        .fillColor(COLOR.white)
        .font('Helvetica-Bold')
        .fontSize(sl.h * 0.55)
        .text('HY', sl.x, sl.y + sl.h * 0.18, {
          width: sl.w,
          align: 'center',
          lineBreak: false,
        });
    }
  }

  // 2c. Verification line strip — full-bleed gray, code in red+bold+underline
  {
    const vs = PDF_LAYOUT.header.verifyStrip;
    doc.rect(0, vs.y, PW, vs.height).fill(COLOR.stripBg);
    const prefix = `You can verify the authenticity of this report using report number ${reportId} and the following Verification Code: `;
    // Center horizontally — measure widths first so we know where to anchor.
    doc.fillColor(COLOR.bodyText).font('Helvetica').fontSize(vs.fontSize);
    const prefixW = doc.widthOfString(prefix);
    doc.font('Helvetica-Bold');
    const codeW = doc.widthOfString(verificationCode);
    const totalW = prefixW + codeW;
    const startX = Math.max(M, (PW - totalW) / 2);
    // Use explicit `width` (with lineBreak:false the text never wraps but
    // PDFKit's `continued:true` machinery still expects a width so the
    // underline lineTo() doesn't get NaN).
    doc
      .fillColor(COLOR.bodyText)
      .font('Helvetica')
      .fontSize(vs.fontSize)
      .text(prefix, startX, vs.y + 5, {
        lineBreak: false,
        width: prefixW + 1,
      });
    doc
      .fillColor(COLOR.linkRed)
      .font('Helvetica-Bold')
      .fontSize(vs.fontSize)
      .text(verificationCode, startX + prefixW, vs.y + 5, {
        lineBreak: false,
        width: codeW + 4,
        underline: true,
      });
  }

  // Reset doc.y to the bottom of the verification strip + spacing.
  doc.y = PDF_LAYOUT.header.verifyStrip.y + PDF_LAYOUT.header.verifyStrip.height + 8;

  // ── Section 1 — Property Information ──────────────────────────────────
  drawSectionBanner('Property Information');
  {
    const sectionY = doc.y;
    const map = PDF_LAYOUT.property.map;
    const text = PDF_LAYOUT.property.text;

    // Left: roadmap of the property
    const propertyMap = await propertyMapPromise;
    if (propertyMap) {
      try {
        doc.image(propertyMap, map.x, sectionY, {
          width: map.w,
          height: map.h,
        });
        doc
          .rect(map.x, sectionY, map.w, map.h)
          .strokeColor(COLOR.borderGray)
          .lineWidth(0.5)
          .stroke();
      } catch (err) {
        console.warn('[reportPdf] property map embed failed:', (err as Error).message);
        doc.rect(map.x, sectionY, map.w, map.h).fill(COLOR.stripBg);
      }
    } else {
      // Map fetch failed — leave a light gray placeholder so the layout
      // stays balanced; address column carries the property identity.
      doc.rect(map.x, sectionY, map.w, map.h).fill(COLOR.stripBg);
    }

    // Right: Property Address + Customer Info
    let yt = sectionY;
    doc
      .fillColor(COLOR.bodyText)
      .font('Helvetica-Bold')
      .fontSize(9.5)
      .text('Property Address:', text.x, yt, { width: text.w });
    yt += 13;

    // Parse "112 Levenbury Pl, Hamilton, VA 20158" → line1 + line2.
    const addressParts = req.address
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const line1 = addressParts[0] ?? req.address;
    const line2 =
      addressParts.length >= 2
        ? addressParts.slice(1).join(', ')
        : '';
    doc
      .fillColor(COLOR.bodyText)
      .font('Helvetica')
      .fontSize(9.5)
      .text(line1, text.x, yt, { width: text.w });
    yt += 12;
    if (line2) {
      doc.text(line2, text.x, yt, { width: text.w });
      yt += 12;
    }

    // Customer Info subsection — only when customerName is provided.
    if (req.customerName && req.customerName.trim().length > 0) {
      yt += 8; // spacer
      doc
        .fillColor(COLOR.linkRed)
        .font('Helvetica-Bold')
        .fontSize(9.5)
        .text('Customer Info:', text.x, yt, { width: text.w });
      yt += 13;
      doc
        .fillColor(COLOR.bodyText)
        .font('Helvetica')
        .fontSize(9.5)
        .text(req.customerName.trim(), text.x, yt, { width: text.w });
      yt += 12;
    }

    // Push doc.y past whichever side ended lower.
    doc.y = Math.max(yt + 6, sectionY + map.h + 6);
  }

  // ── Build the Property Hail Hit History dataset early ─────────────────
  // This data drives both the Top "Hail Hit History" section (tier-
  // classified, sorted newest-first) AND the bottom per-band detail
  // table. Pulled from NCEI Storm Events archive (18mo window centered
  // on date of loss) + augmented with the 12mo events array for any
  // SPC LSR rows not yet ingested into NCEI.
  //
  // Strict bucketing per the 2026-04-27 afternoon addendum:
  //   atProperty:  dist ≤ 0.5 mi  (ONLY)
  //   mi1to3:      0.5 < dist ≤ 3 mi
  //   mi3to5:      3   < dist ≤ 5 mi
  //   mi5to10:     5   < dist ≤ 10 mi  (filter only — column not displayed)
  // No spillage. A 4" reading at 0.6 mi lands in mi1to3, NEVER in atProperty.
  //
  // bandReports captures every primary-source report in the band so the
  // cap algorithm can compute a per-band VerificationContext (≥3 primary +
  // ≥1 gov-observer for that band's reports) instead of inheriting the
  // property-level context across all columns.
  type BandReport = { source: string; sizeIn: number };
  type HistRow = {
    dateIso: string;
    label: string;
    atProperty: number;
    mi1to3: number;
    mi3to5: number;
    mi5to10: number;
    biggestNearby: number;
    biggestNearbyMi: number;
    /** Primary-source reports per band, used to compute the per-band
     *  VerificationContext at render time. Supplemental sources still
     *  contribute to biggestNearby (transparency / debug visibility) but
     *  never enter these arrays — they're invisible to the cap path. */
    primaryAtProperty: BandReport[];
    primaryMi1to3: BandReport[];
    primaryMi3to5: BandReport[];
  };
  // Widened to match SA21's storm_days_public defaults — 25mi radius, 24mo
  // window — and pulls from ALL ingest sources (NCEI + SWDI + mPING +
  // HailTrace + NWS warnings), not just NCEI Storm Events. This is what
  // closes the "we see 4 dates / SA21 sees 15" gap on the same property.
  const histNceiRows = await fetchNceiArchiveForReport({
    lat: req.lat,
    lng: req.lng,
    dateOfLoss: req.dateOfLoss,
    radiusMiles: 25,
    windowDays: 730,
    nceiOnly: false,
  }).catch(() => [] as Awaited<ReturnType<typeof fetchNceiArchiveForReport>>);

  const histGroups = new Map<string, HistRow>();
  const newRow = (dateIso: string): HistRow => ({
    dateIso,
    label: '',
    atProperty: 0,
    mi1to3: 0,
    mi3to5: 0,
    mi5to10: 0,
    biggestNearby: 0,
    biggestNearbyMi: 0,
    primaryAtProperty: [],
    primaryMi1to3: [],
    primaryMi3to5: [],
  });
  /** Strict-bucketed ingestion. `source` carries the canonical primary
   *  label (or null for supplemental sources). Only primary readings
   *  feed the band-driving max + the per-band reports list; supplemental
   *  rows still set biggestNearby for transparency. */
  const ingestRow = (
    dateIso: string,
    sizeIn: number,
    dist: number,
    source: string | null,
  ): void => {
    if (sizeIn < 0.25 || dist > 25) return;
    const row = histGroups.get(dateIso) ?? newRow(dateIso);
    // biggestNearby always tracks the loudest signal we saw, regardless of
    // tier — it's a "debug / context" cell, not an adjuster claim, and
    // it gets capped at render time anyway.
    if (sizeIn > row.biggestNearby) {
      row.biggestNearby = sizeIn;
      row.biggestNearbyMi = dist;
    }
    if (source !== null) {
      // Primary source — feeds the band-driving max + per-band reports.
      // Strict bucketing: each report lands in exactly one band based on
      // distance. No spillage.
      if (dist <= 0.5) {
        if (sizeIn > row.atProperty) row.atProperty = sizeIn;
        row.primaryAtProperty.push({ source, sizeIn });
      } else if (dist <= 3.0) {
        if (sizeIn > row.mi1to3) row.mi1to3 = sizeIn;
        row.primaryMi1to3.push({ source, sizeIn });
      } else if (dist <= 5.0) {
        if (sizeIn > row.mi3to5) row.mi3to5 = sizeIn;
        row.primaryMi3to5.push({ source, sizeIn });
      } else if (dist <= 10.0) {
        if (sizeIn > row.mi5to10) row.mi5to10 = sizeIn;
      }
    }
    histGroups.set(dateIso, row);
  };

  for (const r of histNceiRows) {
    if (r.event_type !== 'Hail') continue;
    if (r.magnitude === null || r.magnitude < 0.25) continue;
    const dateIso =
      typeof r.event_date === 'string'
        ? r.event_date.slice(0, 10)
        : String(r.event_date).slice(0, 10);
    if (!dateIso) continue;
    // Compute distance from the row's own lat/lng — the verified_hail_events
    // table carries event coords directly. The previous join against
    // `events` (the sparse SPC/IEM live cache) defaulted to 5mi on every
    // miss, which made every row in the hit history read "5.0 mi away".
    const eLat = typeof r.lat === 'number' ? r.lat : Number(r.lat);
    const eLng = typeof r.lng === 'number' ? r.lng : Number(r.lng);
    if (!Number.isFinite(eLat) || !Number.isFinite(eLng)) continue;
    const dist = haversineMiles(req.lat, req.lng, eLat, eLng);
    ingestRow(dateIso, r.magnitude ?? 0, dist, primarySourceLabel(r));
  }
  for (const e of events) {
    if (e.eventType !== 'Hail') continue;
    if (!e.beginLat || !e.beginLon) continue;
    if (e.magnitude < 0.25) continue;
    const t = new Date(e.beginDate);
    if (Number.isNaN(t.getTime())) continue;
    const dateIso = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/New_York',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(t);
    // Live `events` cache rows are SPC/IEM-sourced — treat as iem-lsr
    // primary so they keep contributing to verification. Anything that
    // lacks lat/lng was already filtered above.
    ingestRow(
      dateIso,
      e.magnitude,
      haversineMiles(req.lat, req.lng, e.beginLat, e.beginLon),
      'iem-lsr',
    );
  }

  const sortedHistRows = Array.from(histGroups.values())
    .sort((a, b) => b.dateIso.localeCompare(a.dateIso))
    .slice(0, 14);
  for (const r of sortedHistRows) {
    r.label = new Date(`${r.dateIso}T12:00:00`).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }

  // ── MRMS swath DIRECT HIT check across ALL cached dates ──────────────
  // SA21 shows "Direct Hit (point)" by point-in-polygon against the
  // mrms_swath_cache table for every cached date. We do the same here:
  // grab every swath_cache entry from the last 24 months whose bbox
  // contains the property point, decode the GeoJSON payload, run
  // point-in-polygon, and emit a HistRow for any date where the
  // property is inside a polygon. This catches storms that aren't in
  // verified_hail_events at all (e.g. SA21's Aug 16/17 2025 dates which
  // we don't have NCEI rows for) — those are pure swath hits.
  if (pgSql) {
    try {
      type SwathRow = {
        date: string;
        payload: { features: Array<{ properties: { sizeInches: number }; geometry: { coordinates: number[][][][] } }> };
      };
      const swathRows = await pgSql<SwathRow[]>`
        SELECT date::text, payload
          FROM swath_cache
         WHERE source IN ('mrms-hail', 'mrms-vector', 'mrms-mesh')
           AND date::date BETWEEN
               (${req.dateOfLoss}::date - 730)
           AND (${req.dateOfLoss}::date)
           AND bbox_south <= ${req.lat}
           AND bbox_north >= ${req.lat}
           AND bbox_west  <= ${req.lng}
           AND bbox_east  >= ${req.lng}
         LIMIT 1000
      `;
      for (const sr of swathRows) {
        let bestSize = 0;
        const features = sr.payload?.features ?? [];
        for (const feat of features) {
          const polys = feat.geometry?.coordinates ?? [];
          let inside = false;
          for (const polygon of polys) {
            if (!polygon || polygon.length === 0) continue;
            if (!pointInRing(req.lat, req.lng, polygon[0])) continue;
            // Hole rejection — outer-must-contain, holes must not.
            let inHole = false;
            for (let r = 1; r < polygon.length; r += 1) {
              if (pointInRing(req.lat, req.lng, polygon[r])) {
                inHole = true;
                break;
              }
            }
            if (!inHole) {
              inside = true;
              break;
            }
          }
          if (inside) {
            const sz = Number(feat.properties?.sizeInches ?? 0);
            if (sz > bestSize) bestSize = sz;
          }
        }
        if (bestSize > 0) {
          const dateIso = sr.date.slice(0, 10);
          const existing = histGroups.get(dateIso);
          if (existing) {
            // Existing row from NCEI — promote atProperty if the swath
            // says we're inside.
            if (bestSize > existing.atProperty) existing.atProperty = bestSize;
            if (bestSize > existing.biggestNearby) {
              existing.biggestNearby = bestSize;
              existing.biggestNearbyMi = 0;
            }
          } else {
            // New row — swath-only direct hit (no NCEI/SWDI/etc record
            // for this date in our DB, but the property was clearly
            // inside the swath). MRMS swath is primary, so log a primary
            // report at distance 0 (containment) into the atProperty
            // band — that way bandVerification has something to chew on
            // when computing the per-column context.
            const swathRow = newRow(dateIso);
            swathRow.atProperty = bestSize;
            swathRow.biggestNearby = bestSize;
            swathRow.primaryAtProperty.push({ source: 'mrms', sizeIn: bestSize });
            histGroups.set(dateIso, swathRow);
          }
        }
      }
    } catch (err) {
      console.warn('[reportPdf] swath direct-hit scan failed:', (err as Error).message);
    }
  }

  // (Reverted: per-date polygon-edge band promotion. It made PDF gen
  // 30-60s slower because each hit-history row triggered a fresh
  // buildMrmsImpactResponse call, hammering the GRIB pipeline and
  // queueing up every other MRMS request on the server. The downstream
  // effect was reps couldn't generate PDFs at all in normal load. The
  // existing NCEI-distance + swath-containment fill above is good
  // enough for the rep-facing table; the top-of-PDF Storm Coverage
  // tier card still uses the strict polygon-truth `propertyImpact`.)

  // sortedHistRows might need re-sorting now that the swath scan added new
  // dates. Recompute below after this block (the original sort happens on
  // line ~689). Move sort here to capture the swath-injected rows too.
  //
  // CREDIBILITY FILTER: drop rows where the closest event is >10 mi.
  // AREA IMPACT means "Storm cell within 10 mi" on the cover card, so a
  // hit-history row reading "AREA IMPACT 20.0 mi away" undermines every
  // claim that follows. We only show DIRECT HIT (≤1 mi at-property),
  // NEAR MISS (1–3 mi), and AREA IMPACT (within 10 mi). Wider events
  // are still in the per-band detail table at the bottom.
  // Drop rows where every band is below the 0.25" trace floor and the
  // closest event is >10 mi away. A row with all dashes is just visual
  // noise; the rep-facing list should only show storms that produced
  // claim-relevant hail somewhere in the search area.
  const finalSortedHistRows = Array.from(histGroups.values())
    .filter(
      (r) =>
        r.atProperty >= 0.25 ||
        r.mi1to3 >= 0.25 ||
        r.mi3to5 >= 0.25 ||
        r.mi5to10 >= 0.25 ||
        (r.biggestNearby >= 0.25 && r.biggestNearbyMi <= 10),
    )
    .sort((a, b) => b.dateIso.localeCompare(a.dateIso))
    .slice(0, 14);
  for (const r of finalSortedHistRows) {
    if (!r.label) {
      r.label = new Date(`${r.dateIso}T12:00:00`).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
    }
  }
  // Replace sortedHistRows with the filtered + sorted set.
  sortedHistRows.length = 0;
  sortedHistRows.push(...finalSortedHistRows);

  // ── Property impact + verification (data plumb for downstream sections) ─
  // The tier card visual got removed in the 2026-04-27 redesign, but
  // propertyImpact still feeds the Hail Impact Details "Size of Hail
  // Detected" cell + the narrative "max at property" line. Keep the
  // fetch + verification bulk lookup intact.
  let propertyImpact: MrmsImpactResult | null = null;
  if (collection) {
    try {
      const resp = await buildMrmsImpactResponse({
        date: req.dateOfLoss,
        bounds,
        anchorIso: req.anchorTimestamp ?? undefined,
        points: [{ id: 'property', lat: req.lat, lng: req.lng }],
      });
      propertyImpact = resp?.results[0] ?? null;
    } catch (err) {
      console.warn('[reportPdf] impact response failed:', (err as Error).message);
    }
  }

  // Sync the date-of-loss histRow with propertyImpact's band data so the
  // hit-history table row and the Hail Impact Details cell agree.
  if (propertyImpact?.bands) {
    const dolRow = histGroups.get(req.dateOfLoss) ?? newRow(req.dateOfLoss);
    const b = propertyImpact.bands;
    if (typeof b.atProperty === 'number' && b.atProperty > 0) {
      if (b.atProperty > dolRow.atProperty) dolRow.atProperty = b.atProperty;
      if (dolRow.primaryAtProperty.length === 0) {
        dolRow.primaryAtProperty.push({ source: 'mrms', sizeIn: b.atProperty });
      }
    }
    if (typeof b.mi1to3 === 'number' && b.mi1to3 > 0) {
      if (b.mi1to3 > dolRow.mi1to3) dolRow.mi1to3 = b.mi1to3;
      if (dolRow.primaryMi1to3.length === 0) {
        dolRow.primaryMi1to3.push({ source: 'mrms', sizeIn: b.mi1to3 });
      }
    }
    if (typeof b.mi3to5 === 'number' && b.mi3to5 > 0) {
      if (b.mi3to5 > dolRow.mi3to5) dolRow.mi3to5 = b.mi3to5;
      if (dolRow.primaryMi3to5.length === 0) {
        dolRow.primaryMi3to5.push({ source: 'mrms', sizeIn: b.mi3to5 });
      }
    }
    if (typeof b.mi5to10 === 'number' && b.mi5to10 > 0) {
      if (b.mi5to10 > dolRow.mi5to10) dolRow.mi5to10 = b.mi5to10;
    }
    if (b.atProperty && b.atProperty > dolRow.biggestNearby) {
      dolRow.biggestNearby = b.atProperty;
      dolRow.biggestNearbyMi = 0;
    }
    histGroups.set(req.dateOfLoss, dolRow);
  }

  // 2026-04-27 cap algorithm — pull verification context for the date of
  // loss + every hit-history date in one bulk SQL round-trip. Drives the
  // Hail Impact Details cell, narrative, AND every Section 7 row's
  // banded display.
  const allCapDates = Array.from(
    new Set([req.dateOfLoss, ...histGroups.keys()].filter(Boolean)),
  );
  const verificationByDate = await buildVerificationBulk({
    lat: req.lat,
    lng: req.lng,
    dates: allCapDates,
  });
  const propertyVerification: VerificationContext =
    verificationByDate.get(req.dateOfLoss) ?? UNVERIFIED_CTX;

  // Per-band verification context for the date of loss — feeds the
  // Hail Impact Details "Size of Hail Detected" + Max nearby cells, and
  // the narrative composer's cappedHeadline. Computed once here so the
  // legacy hit-history table (still rendered until Phase 6 retires it)
  // can keep using it without recomputing.
  const dolRow = histGroups.get(req.dateOfLoss);
  const dolAtPropCtx = dolRow
    ? bandVerification(dolRow.primaryAtProperty, req.dateOfLoss, req.lat, req.lng)
    : propertyVerification;
  const dolFarBandCtx = farBandCtx(propertyVerification);

  // ── Section 2 — Hail Impact Details (4×2 label/value table) ───────────
  drawSectionBanner('Hail Impact Details');
  {
    const tableY = doc.y;
    const RH = PDF_LAYOUT.hailImpact.rowHeight;
    const C1L = PDF_LAYOUT.hailImpact.col.label1;
    const C1V = PDF_LAYOUT.hailImpact.col.value1;
    const C2L = PDF_LAYOUT.hailImpact.col.label2;
    const C2V = PDF_LAYOUT.hailImpact.col.value2;

    const dolDate = new Date(`${req.dateOfLoss}T12:00:00`);
    const dolMdy = `${dolDate.getMonth() + 1}/${dolDate.getDate()}/${dolDate.getFullYear()}`;

    // Hail Impact Details metrics — try the StormEventDto cache first, then
    // fall back to histNceiRows when the cache window doesn't cover the
    // date of loss (e.g., 2-year-old adjuster pull). The hist rows come
    // from verified_hail_events so they cover the full retention period.
    const histHailPoints: Array<{ lat: number; lng: number; timeIso: string }> = [];
    for (const r of histNceiRows) {
      const dateIso = typeof r.event_date === 'string'
        ? r.event_date.slice(0, 10)
        : String(r.event_date).slice(0, 10);
      if (dateIso !== req.dateOfLoss) continue;
      if (r.event_type !== 'Hail') continue;
      const lat = typeof r.lat === 'number' ? r.lat : Number(r.lat);
      const lng = typeof r.lng === 'number' ? r.lng : Number(r.lng);
      const iso = r.begin_time_utc;
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || !iso) continue;
      const dist = haversineMiles(req.lat, req.lng, lat, lng);
      if (dist > req.radiusMiles) continue;
      histHailPoints.push({ lat, lng, timeIso: iso });
    }

    const peakTimeStr =
      computeStormPeakTime(events, req.dateOfLoss) ??
      computePeakTimeFromPoints(histHailPoints) ??
      '—';

    const cacheDirSpeed = computeStormDirectionAndSpeed(events, req.dateOfLoss);
    const dirSpeed = cacheDirSpeed.speedMph !== null
      ? cacheDirSpeed
      : computeDirectionAndSpeedFromPoints(histHailPoints);
    const headingStr = dirSpeed.heading;
    const speedStr = dirSpeed.speedMph !== null
      ? `${dirSpeed.speedMph.toFixed(1)} mph`
      : '—';

    const durationMin =
      computeHailDuration(events, req.dateOfLoss) ??
      computeDurationFromPoints(histHailPoints);
    const durationStr = durationMin !== null ? `${durationMin.toFixed(1)} minutes` : '—';

    // At-property hail size — uses the same cap call that previously fed
    // the tier card. dolAtPropCtx is the per-band verification ctx.
    // Fallback chain when MRMS bands.atProperty is null (older DoLs where
    // the GRIB2 file rotated out of the IEM archive cache). Without
    // fallback, the cell reads "—" while the narrative below says
    // "penny-sized hail" because composeStormNarrative consults a wider
    // signal — visibly inconsistent on the same page.
    //   1) propertyImpact.bands.atProperty   (best — at the pin, polygon-contained)
    //   2) propertyImpact.maxHailInches      (Pass 2 atPropertyMax for near_miss
    //                                         tier — closest swath edge ≤0.5mi)
    //   3) propertyImpact.bands.mi1to3       (1-3mi MRMS band)
    //   4) closest ground report ≤1mi        (radar gap, ground-truth filled)
    // Order chosen so the Size cell matches the narrative's cappedHeadline,
    // which favors the at-or-near-property signal over the wider mi1to3
    // band. Falling to mi1to3 only when both at-pin signals are null.
    let atPropertyVal = propertyImpact?.bands.atProperty ?? null;
    if (atPropertyVal === null || atPropertyVal === 0) {
      const wide = propertyImpact?.maxHailInches ?? null;
      if (wide !== null && wide > 0) atPropertyVal = wide;
    }
    if (atPropertyVal === null || atPropertyVal === 0) {
      const mi1to3 = propertyImpact?.bands.mi1to3 ?? null;
      if (mi1to3 !== null && mi1to3 > 0) {
        atPropertyVal = mi1to3;
      }
    }
    if (atPropertyVal === null || atPropertyVal === 0) {
      let closestMag = 0;
      let closestDist = Infinity;
      for (const r of histNceiRows) {
        const dateIso = typeof r.event_date === 'string'
          ? r.event_date.slice(0, 10)
          : String(r.event_date).slice(0, 10);
        if (dateIso !== req.dateOfLoss) continue;
        if (r.event_type !== 'Hail') continue;
        const lat = typeof r.lat === 'number' ? r.lat : Number(r.lat);
        const lng = typeof r.lng === 'number' ? r.lng : Number(r.lng);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
        const dist = haversineMiles(req.lat, req.lng, lat, lng);
        if (dist > 1) continue;
        const mag = r.magnitude;
        if (!Number.isFinite(mag) || mag === null || mag <= 0) continue;
        if (dist < closestDist) {
          closestDist = dist;
          closestMag = mag;
        }
      }
      if (closestMag > 0) atPropertyVal = closestMag;
    }
    const atPropertyStr = atPropertyVal !== null && atPropertyVal > 0
      ? displayHailIn(atPropertyVal, dolAtPropCtx)
      : '—';

    // Nearby hail count + max — prefer the StormEventDto cache, fall back
    // to histNceiRows when cache is empty (older dates of loss).
    const datedHail = datedEvents.filter((e) => e.eventType === 'Hail');
    let nearbyCount = datedHail.length;
    let biggestNearbyRaw = datedHail.reduce((m, e) => Math.max(m, e.magnitude), 0);
    if (nearbyCount === 0 || biggestNearbyRaw === 0) {
      let histCount = 0;
      let histMax = 0;
      for (const r of histNceiRows) {
        const dateIso = typeof r.event_date === 'string'
          ? r.event_date.slice(0, 10)
          : String(r.event_date).slice(0, 10);
        if (dateIso !== req.dateOfLoss) continue;
        if (r.event_type !== 'Hail') continue;
        const lat = typeof r.lat === 'number' ? r.lat : Number(r.lat);
        const lng = typeof r.lng === 'number' ? r.lng : Number(r.lng);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
        const dist = haversineMiles(req.lat, req.lng, lat, lng);
        if (dist > req.radiusMiles) continue;
        const mag = r.magnitude;
        if (!Number.isFinite(mag) || mag === null || mag <= 0) continue;
        histCount += 1;
        if (mag > histMax) histMax = mag;
      }
      if (nearbyCount === 0) nearbyCount = histCount;
      if (biggestNearbyRaw === 0) biggestNearbyRaw = histMax;
    }
    const maxNearbyStr = biggestNearbyRaw > 0
      ? displayHailIn(biggestNearbyRaw, dolFarBandCtx)
      : '—';

    const rows: Array<[string, string, string, string]> = [
      ['Date of Hail Impact:', dolMdy, 'Hail Duration:', durationStr],
      ['Time of Hail Impact:', peakTimeStr, 'Size of Hail Detected:', atPropertyStr],
      ['Storm Direction:', headingStr, 'Nearby Hail Reported:', `${nearbyCount} report${nearbyCount === 1 ? '' : 's'}`],
      ['Storm Speed:', speedStr, 'Max Hail Size Reported:', maxNearbyStr],
    ];

    rows.forEach((r, i) => {
      const ry = tableY + i * RH;
      const baseY = ry + 5;
      doc
        .fillColor(COLOR.labelGray)
        .font('Helvetica')
        .fontSize(9)
        .text(r[0], C1L.x, baseY, { width: C1L.w, lineBreak: false });
      doc
        .fillColor(COLOR.bodyText)
        .font('Helvetica-Bold')
        .fontSize(9)
        .text(r[1], C1V.x, baseY, { width: C1V.w, lineBreak: false });
      doc
        .fillColor(COLOR.labelGray)
        .font('Helvetica')
        .fontSize(9)
        .text(r[2], C2L.x, baseY, { width: C2L.w, lineBreak: false });
      doc
        .fillColor(COLOR.bodyText)
        .font('Helvetica-Bold')
        .fontSize(9)
        .text(r[3], C2V.x, baseY, { width: C2V.w, lineBreak: false });
    });

    doc.y = tableY + rows.length * RH + 6;
  }

  // (Legacy "Property Hail Hit History" combined table removed in
  // Phase 6 of the 2026-04-27 redesign — replaced by the new 9-column
  // "Historical Storm Activity" table that fires AFTER Severe Weather
  // Warnings per the spec render order. The dataset (sortedHistRows
  // + histGroups) is still populated here and consumed downstream.)

  // ── Storm Narrative (adjuster prose) ──────────────────────────────────
  // Composes Gemini-Field-style language: "On April 1, 2026, a severe
  // weather system impacted the Loudoun area producing pea-sized hail
  // measuring up to 0.86"..." Avoids prescriptive claim wording so
  // adversarial counsel can't flag it.
  {
    const peakHailEvents = datedEvents
      .filter((e) => e.eventType === 'Hail')
      .reduce((m, e) => Math.max(m, e.magnitude), 0);
    const peakWindEvents = datedEvents
      .filter((e) => e.eventType === 'Thunderstorm Wind')
      .reduce((m, e) => Math.max(m, e.magnitude), 0);
    const collectionMax = collection?.metadata.maxHailInches ?? 0;
    const headlineHailIn = Math.max(
      propertyImpact?.bands.atProperty ?? 0,
      propertyImpact?.maxHailInches ?? 0,
      peakHailEvents,
    );
    const severeCount = datedEvents.filter(
      (e) => e.eventType === 'Hail' && e.magnitude >= 1.5,
    ).length;

    // Closest hail report (event with shortest distance — using haversine)
    let closestHailMi: number | undefined;
    let biggestHailIn = collectionMax;
    let biggestHailMi: number | undefined;
    for (const e of datedEvents) {
      if (e.eventType !== 'Hail') continue;
      const d = haversineMiles(req.lat, req.lng, e.beginLat, e.beginLon);
      if (closestHailMi === undefined || d < closestHailMi) {
        closestHailMi = d;
      }
      if (e.magnitude > biggestHailIn) {
        biggestHailIn = e.magnitude;
        biggestHailMi = d;
      }
    }

    const formattedDate = new Date(`${req.dateOfLoss}T12:00:00`).toLocaleDateString(
      'en-US',
      { month: 'long', day: 'numeric', year: 'numeric' },
    );
    // Best-effort location label from address — extracts "City, ST" by
    // walking parts right-to-left, skipping a trailing "USA" / country
    // suffix and detecting the "STATE ZIP" segment (e.g., "VA 22182").
    // Examples:
    //   "21000 Cascades Pkwy, Sterling, VA 20165, USA" → "Sterling, VA"
    //   "8100 Boone Blvd, Vienna, VA 22182"           → "Vienna, VA"
    //   "Sterling, VA"                                → "Sterling, VA"
    const locationFallback = (() => {
      let parts = req.address.split(',').map((s) => s.trim()).filter(Boolean);
      // Drop trailing country suffix.
      if (
        parts.length > 0 &&
        /^(usa|united states|us)$/i.test(parts[parts.length - 1])
      ) {
        parts = parts.slice(0, -1);
      }
      // Find the "STATE ZIP" segment from the right (e.g., "VA 22182" or "VA").
      const stateZipRe = /^([A-Z]{2})(?:\s+\d{5}(?:-\d{4})?)?$/;
      for (let i = parts.length - 1; i >= 0; i -= 1) {
        const m = parts[i].match(stateZipRe);
        if (m) {
          const state = m[1];
          const city = i > 0 ? parts[i - 1] : null;
          return city ? `${city}, ${state}` : state;
        }
      }
      // No state token found — return the last 2 segments or the raw input.
      if (parts.length >= 2) {
        return `${parts[parts.length - 2]}, ${parts[parts.length - 1]}`;
      }
      return req.address;
    })();

    // Cap the hail values headed into narrative prose. Narrative says
    // things like "ping-pong-sized hail measuring up to 4.00" in
    // diameter" — feeding raw 4" through would re-introduce the exact
    // adjuster-credibility problem this whole feature exists to solve.
    // Use property verification for the at-property max, far-band ctx
    // (no consensus override) for the biggest-nearby callout since
    // that's deliberately a >property descriptor.
    const cappedHeadline =
      displayHailInches(headlineHailIn, propertyVerification) ?? 0;
    const cappedBiggest =
      biggestHailIn > 0
        ? displayHailInches(biggestHailIn, farBandCtx(propertyVerification))
        : null;
    const narrative = composeStormNarrative({
      formattedDate,
      location: locationFallback,
      maxHailInches: cappedHeadline,
      maxWindMph: peakWindEvents,
      totalEvents: datedEvents.length,
      radiusMiles: req.radiusMiles,
      closestHailMiles: closestHailMi,
      biggestHailInches: cappedBiggest && cappedBiggest > 0 ? cappedBiggest : undefined,
      biggestHailMiles: biggestHailMi,
      severeHailCount: severeCount,
    });

    if (narrative.length > 0) {
      drawSectionBanner('Hail Impact Narrative');
      // Indent paragraph 20 pt past the page margin per layout spec — gives
      // the prose visual breathing room from the banner edges. Width 472,
      // 9 pt Helvetica, 14 pt line height, justified.
      doc
        .fillColor(COLOR.bodyText)
        .font('Helvetica')
        .fontSize(9)
        .text(narrative, 70, doc.y + 4, {
          width: 472,
          align: 'justify',
          lineGap: 5,
        });
      doc.moveDown(0.6);
    }
  }

  // ── Section 4 — Ground Observations - Hail ────────────────────────────
  // ── Section 5 — Ground Observations - Wind ────────────────────────────
  //
  // Both pull from histNceiRows (already fetched at line ~810), filtered
  // to date-of-loss + within radiusMiles + PRIMARY source rows. Source
  // labels are mapped to display names per spec:
  //   iem-lsr / nws-lsr / ncei-storm-events  → "NOAA"
  //   mrms / nexrad-mrms                      → "NEXRAD"
  // Hail size renders via displayHailIn with a per-row VerificationContext
  // computed against THAT row's primary reports — never inherits the
  // property-level ctx so a single mPING-only sighting still caps at 2.0".
  {
    type GroundRow = {
      iso: string;
      sourceLabel: 'NOAA' | 'NEXRAD';
      magnitudeRaw: number; // hail in inches; wind in mph or kts (numeric)
      magnitudeUnit?: 'kts' | 'mph'; // wind only
      distanceMi: number;
      narrative: string;
      eventType: 'Hail' | 'Thunderstorm Wind';
      sourceFlags: SourceFlags;
    };

    /** Map a primary-source label to the rep-facing display name. */
    const displaySourceFor = (r: SourceFlags): 'NOAA' | 'NEXRAD' | null => {
      // mrms / nexrad-mrms — NEXRAD branding
      if (r.source_ncei_storm_events) return 'NOAA';
      if (r.source_iem_lsr) return 'NOAA';
      if (r.source_nws_warnings) return 'NOAA';
      // No explicit MRMS source flag in this row shape; primary radar
      // source is the swath_cache injection, which is presented as
      // 'mrms' string in primaryAtProperty/Mi1to3/Mi3to5 arrays — not
      // present here. So if no NOAA flag is set, fall through to null.
      return null;
    };

    /** Build per-row verification context. The "row" here is one ground
     *  observation; we treat its source as a single-source primary
     *  report at its own raw size so bandVerification can still gate
     *  the cap (≥3 distinct primary sources or Sterling allow-list). */
    const rowVerificationCtx = (
      r: GroundRow,
      label: 'NOAA' | 'NEXRAD',
    ): VerificationContext => {
      const reports = [
        { source: label === 'NEXRAD' ? 'mrms' : 'iem-lsr', sizeIn: r.magnitudeRaw },
      ];
      return bandVerification(reports, r.iso.slice(0, 10), req.lat, req.lng);
    };

    const datedHailRows: GroundRow[] = [];
    const datedWindRows: GroundRow[] = [];

    for (const r of histNceiRows) {
      const dateIso = typeof r.event_date === 'string'
        ? r.event_date.slice(0, 10)
        : String(r.event_date).slice(0, 10);
      if (dateIso !== req.dateOfLoss) continue;
      if (r.event_type !== 'Hail' && r.event_type !== 'Thunderstorm Wind') continue;
      const lat = typeof r.lat === 'number' ? r.lat : Number(r.lat);
      const lng = typeof r.lng === 'number' ? r.lng : Number(r.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      const dist = haversineMiles(req.lat, req.lng, lat, lng);
      if (dist > req.radiusMiles) continue;
      const label = displaySourceFor(r);
      if (label === null) continue; // primary-only filter
      const mag = r.magnitude;
      if (mag === null || !Number.isFinite(mag) || mag <= 0) continue;
      const narrative = (r.narrative ?? '').trim();
      const iso = r.begin_time_utc ?? `${dateIso}T12:00:00Z`;
      const row: GroundRow = {
        iso,
        sourceLabel: label,
        magnitudeRaw: mag,
        distanceMi: dist,
        narrative,
        eventType: r.event_type,
        sourceFlags: r,
      };
      if (r.event_type === 'Hail') datedHailRows.push(row);
      else datedWindRows.push(row);
    }

    // Sort newest-first by event time.
    datedHailRows.sort((a, b) => new Date(b.iso).getTime() - new Date(a.iso).getTime());
    datedWindRows.sort((a, b) => new Date(b.iso).getTime() - new Date(a.iso).getTime());

    /** Format the row's date+time as two stacked lines: "M/D/YYYY" and
     *  "h:mm A z" — fits the 80pt-wide "Date / Time" column. */
    const fmtDateTwoLines = (iso: string): { d1: string; d2: string } => {
      const t = new Date(iso);
      if (Number.isNaN(t.getTime())) return { d1: '—', d2: '' };
      const d1 = t.toLocaleDateString('en-US', {
        timeZone: 'America/New_York',
        month: 'numeric',
        day: 'numeric',
        year: 'numeric',
      });
      const d2 = t.toLocaleTimeString('en-US', {
        timeZone: 'America/New_York',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
        timeZoneName: 'short',
      });
      return { d1, d2 };
    };

    /** Render one ground-observations table. Returns the y-coord below
     *  the last row. Auto-paginates with a header redraw if needed. */
    const drawGroundTable = (
      banner: string,
      caption: string,
      rows: GroundRow[],
      kind: 'hail' | 'wind',
    ): void => {
      if (rows.length === 0) return; // omit empty section per spec
      drawSectionBanner(banner);
      // Sub-caption
      doc
        .fillColor(COLOR.labelGray)
        .font('Helvetica')
        .fontSize(8)
        .text(caption, M, doc.y + 2, { width: CW });
      doc.moveDown(0.5);

      const cols = kind === 'hail'
        ? PDF_LAYOUT.groundObs.cols.hail
        : PDF_LAYOUT.groundObs.cols.wind;
      const HEADER_H = PDF_LAYOUT.groundObs.headerHeight;
      const BODY_H = PDF_LAYOUT.groundObs.bodyRowHeight;
      const PAD = PDF_LAYOUT.groundObs.cellPad;

      let yt = doc.y;
      // Outer table top border + header background
      doc.rect(M, yt, CW, HEADER_H).fill(COLOR.bannerBg);
      doc.fillColor(COLOR.labelGray).font('Helvetica-Bold').fontSize(PDF_LAYOUT.groundObs.headerFontSize);
      for (const col of cols) {
        doc.text(col.label, col.x + PAD.left, yt + PAD.top + 1, {
          width: col.w - PAD.left * 2,
          lineBreak: false,
        });
      }
      yt += HEADER_H;

      // Body rows — slice to a sensible cap (10 hail / 5 wind) per spec.
      const maxRows = kind === 'hail' ? 10 : 5;
      const rendered = rows.slice(0, maxRows);

      for (const r of rendered) {
        // Auto-paginate before drawing the row if it won't fit.
        if (yt + BODY_H > BOTTOM - 8) {
          doc.addPage();
          // Re-render banner on continuation page so the table identifies itself.
          drawSectionBanner(`${banner} (continued)`);
          yt = doc.y;
          doc.rect(M, yt, CW, HEADER_H).fill(COLOR.bannerBg);
          doc.fillColor(COLOR.labelGray).font('Helvetica-Bold').fontSize(PDF_LAYOUT.groundObs.headerFontSize);
          for (const col of cols) {
            doc.text(col.label, col.x + PAD.left, yt + PAD.top + 1, {
              width: col.w - PAD.left * 2,
              lineBreak: false,
            });
          }
          yt += HEADER_H;
        }

        // Cell text. Date column gets two lines; size/wind/distance get
        // one line each; comments wraps with ellipsis to fit body row.
        const dt = fmtDateTwoLines(r.iso);
        doc.fillColor(COLOR.bodyText).font('Helvetica').fontSize(PDF_LAYOUT.groundObs.bodyFontSize);
        for (const col of cols) {
          const cellX = col.x + PAD.left;
          const cellW = col.w - PAD.left * 2;
          const cellY = yt + PAD.top;
          if (col.key === 'datetime') {
            doc.text(dt.d1, cellX, cellY, { width: cellW, lineBreak: false });
            doc.text(dt.d2, cellX, cellY + 11, { width: cellW, lineBreak: false });
          } else if (col.key === 'source') {
            doc.text(r.sourceLabel, cellX, cellY, { width: cellW, lineBreak: false });
          } else if (col.key === 'size') {
            const ctx = rowVerificationCtx(r, r.sourceLabel);
            doc.text(displayHailIn(r.magnitudeRaw, ctx), cellX, cellY, {
              width: cellW,
              lineBreak: false,
            });
          } else if (col.key === 'speed') {
            // Wind: report kts when source is NEXRAD/ASOS-style; mph
            // for LSR. We don't carry that distinction in the row shape
            // here, so default to mph (matches the existing legacy
            // column). Reps can spot-check the comments column for
            // unit ambiguity. Spec line 130 calls for unit-preservation
            // — future improvement when we ingest unit metadata.
            doc.text(`${Math.round(r.magnitudeRaw)} mph`, cellX, cellY, {
              width: cellW,
              lineBreak: false,
            });
          } else if (col.key === 'distance') {
            doc.text(`${r.distanceMi.toFixed(1)} miles`, cellX, cellY, {
              width: cellW,
              lineBreak: false,
            });
          } else if (col.key === 'comments') {
            doc.text(r.narrative || '', cellX, cellY, {
              width: cellW,
              height: BODY_H - PAD.top - 2,
              ellipsis: true,
            });
          }
        }
        // Row bottom hairline divider
        doc
          .moveTo(M, yt + BODY_H)
          .lineTo(M + CW, yt + BODY_H)
          .strokeColor(COLOR.borderGray)
          .lineWidth(0.5)
          .stroke();
        yt += BODY_H;
      }

      // Outer table border (top is implicit via header fill; sides + bottom)
      doc
        .rect(M, doc.y - HEADER_H * 0, CW, 0)
        .strokeColor(COLOR.borderGray);
      doc.y = yt + 8;
    };

    drawGroundTable(
      'Ground Observations - Hail',
      `On-the-ground hail observations reported near the property located at ${req.address} (Property)`,
      datedHailRows,
      'hail',
    );
    drawGroundTable(
      'Ground Observations - Wind',
      `On-the-ground damaging wind observations reported near the property located at ${req.address} (Property)`,
      datedWindRows,
      'wind',
    );
  }

  // (Legacy "Storm Summary" cards removed in Phase 7 of the 2026-04-27
  // redesign — STORM PEAK (AREA) and PEAK WIND (AREA) info now lives
  // inside the Hail Impact Details 4×2 table near the top of the report.
  // Single number per cell, no orange-card framing — keeps adjuster
  // attention on the at-property numbers, not the area-wide context.)

  // Consilience prewarm cache still runs backend-side to keep the cap
  // algorithm's verification pipeline warm, but doesn't surface as a
  // section anymore.
  await consiliencePromise;

  // (Legacy "NEXRAD Radar + Hail Footprint Map" wide-map section
  // removed in Phase 5 of the 2026-04-27 redesign. NEXRAD radar imagery
  // moves into the per-warning Severe Weather Warnings section below.
  // The Mercator projector + RenderedPolygon shape + swath polygon
  // pipeline are unwound with that map; the property's hail footprint
  // is communicated via the Hail Impact Details cell + narrative.)

  // (Legacy "Documented Storm Reports" wall-of-events table removed in
  // Phase 4 of the 2026-04-27 redesign — replaced by the focused Ground
  // Observations - Hail / - Wind tables earlier in the document. Reps
  // and adjusters get the same primary-source rows in the new layout
  // with cleaner styling + capped sizes via the per-row VerificationContext.)

  // ── Section 6 — Severe Weather Warnings ──────────────────────────────
  // Per-warning panel matches the target reference PDF: NEXRAD radar
  // image (200×130 left), title + 2×3 KV grid (right), full-width
  // caption + narrative below. Filter to warnings whose polygon
  // CONTAINS the property — adjusters care about coverage, not bbox
  // overlap. Up to 5 chronological warnings.
  //
  // NEXRAD radar fetch budget: 8s per warning (Promise.race), 30s
  // total. Failed fetches leave the radar slot blank (white) per spec
  // — never blocks PDF generation.
  const propWarnings = await fetchNwsWarningsForProperty({
    lat: req.lat,
    lng: req.lng,
    dateOfLoss: req.dateOfLoss,
    bounds,
  }).catch(() => [] as Awaited<ReturnType<typeof fetchNwsWarningsForProperty>>);

  // Cap at 5 warnings (chronological — fetcher already sorts ascending).
  const sortedWarnings = propWarnings.slice(0, 5);

  // Parallel radar fetches with a 30s overall budget. fetchNexradImageForWarning
  // already enforces 8s per call + an LRU cache.
  const radarStart = Date.now();
  const radarPromises = sortedWarnings.map((w) =>
    fetchNexradImageForWarning({
      effectiveIso: w.issueIso,
      lat: req.lat,
      lng: req.lng,
      width: 600,
      height: 400,
    }).catch(() => null),
  );
  const radarResolved: Array<Buffer | null> = await Promise.race([
    Promise.all(radarPromises),
    new Promise<Array<Buffer | null>>((resolve) =>
      setTimeout(() => resolve(sortedWarnings.map(() => null)), 30_000),
    ),
  ]);
  const radarLatency = Date.now() - radarStart;
  if (sortedWarnings.length > 0 && radarLatency > 25_000) {
    console.warn(
      `[reportPdf] warnings radar fetch took ${radarLatency}ms (cap 30s) for ${sortedWarnings.length} warnings`,
    );
  }
  const warningPanels: Array<{
    warn: (typeof sortedWarnings)[number];
    radarBuf: Buffer | null;
  }> = sortedWarnings.map((warn, i) => ({
    warn,
    radarBuf: radarResolved[i] ?? null,
  }));

  if (warningPanels.length > 0) {
    drawSectionBanner('Severe Weather Warnings');
    // Intro paragraph
    doc
      .fillColor(COLOR.bodyText)
      .font('Helvetica')
      .fontSize(9)
      .text(
        `At the approximate time of the hail impact, the property located at ${req.address} was under multiple severe weather warnings issued by the National Weather Service, as follows:`,
        70,
        doc.y + 6,
        { width: 472 },
      );
    doc.moveDown(0.7);

    const phenomenonLabel: Record<string, string> = {
      SV: 'Severe Thunderstorm Warning',
      TO: 'Tornado Warning',
      FF: 'Flash Flood Warning',
      EW: 'Extreme Wind Warning',
    };
    const fmtTime = (iso: string): string => {
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return iso;
      return d.toLocaleString('en-US', {
        timeZone: 'America/New_York',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
        timeZoneName: 'short',
      });
    };
    const fmtDateTime = (iso: string): string => {
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return iso;
      return d.toLocaleString('en-US', {
        timeZone: 'America/New_York',
        month: 'numeric',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
        timeZoneName: 'short',
      });
    };
    const extractHailSize = (product: string | undefined): string => {
      if (!product) return 'n/a';
      const inchMatch = product.match(/(\d+(?:\.\d+)?)\s*(?:in|inch|inches|")/i);
      if (inchMatch) return `${parseFloat(inchMatch[1]).toFixed(2)}"`;
      return 'n/a';
    };
    const extractWindSpeed = (product: string | undefined): string => {
      if (!product) return 'n/a';
      const mphMatch = product.match(/(\d+)\s*(?:mph|miles per hour)/i);
      const ktMatch = product.match(/(\d+)\s*(?:kt|knots)/i);
      if (mphMatch) return `${mphMatch[1]} mph`;
      if (ktMatch) return `${Math.round(parseInt(ktMatch[1], 10) * 1.15078)} mph`;
      return 'n/a';
    };
    const trimNarrative = (product: string | undefined): string => {
      if (!product) return '';
      const cleaned = product.replace(/\r/g, '').replace(/\.{3,}/g, ' ').trim();
      const after = cleaned.split(/HAZARD\.{3}|IMPACT\.{3}/i)[1]?.trim();
      if (after && after.length > 10) return after.slice(0, 240).split('\n')[0];
      const fallback = cleaned.match(
        /[^.\n]*\b(hail|wind|gust|trees|damage|roof|debris)\b[^.\n]{0,200}/i,
      );
      if (fallback) return fallback[0].trim().slice(0, 240);
      return cleaned.slice(0, 200);
    };

    const W = PDF_LAYOUT.warning;
    for (const panel of warningPanels) {
      const w = panel.warn;
      // Page break if next panel won't fit cleanly.
      if (doc.y + W.blockHeight + 12 > BOTTOM) {
        doc.addPage();
        drawSectionBanner('Severe Weather Warnings (continued)');
      }
      const py = doc.y;

      // ── Left column: NEXRAD radar image ──
      // Blank-on-failure: spec says leave the slot WHITE (not dark fill)
      // when the fetch returns null so the PDF doesn't look broken.
      if (panel.radarBuf) {
        try {
          doc.save();
          doc.rect(W.image.x, py, W.image.w, W.image.h).clip();
          doc.image(panel.radarBuf, W.image.x, py, {
            fit: [W.image.w, W.image.h],
            align: 'center',
            valign: 'center',
          });
          doc.restore();
        } catch {
          // Bad image bytes — leave blank slot.
          doc.rect(W.image.x, py, W.image.w, W.image.h).fill(COLOR.white);
        }
      } else {
        doc.rect(W.image.x, py, W.image.w, W.image.h).fill(COLOR.white);
      }
      // Thin border around the image slot for visual definition
      doc
        .rect(W.image.x, py, W.image.w, W.image.h)
        .strokeColor(COLOR.borderGray)
        .lineWidth(0.5)
        .stroke();

      // ── Right column: Title + 2×3 KV grid ──
      const titleText = `${phenomenonLabel[w.phenomenon] ?? w.phenomenon} issued ${fmtTime(w.issueIso)} until ${fmtTime(w.expireIso)} by NOAA Storm Events Database`;
      doc
        .fillColor(COLOR.bodyText)
        .font('Helvetica-Bold')
        .fontSize(W.titleFontSize)
        .text(titleText, W.rightCol.x, py, {
          width: W.rightCol.w,
          lineGap: W.titleLineHeight - W.titleFontSize,
        });

      const gridTopY = py + 32;
      const drawWarningKV = (
        label: string,
        value: string,
        labelX: number,
        valueX: number,
        rowY: number,
      ) => {
        doc
          .fillColor(COLOR.linkRed)
          .font('Helvetica')
          .fontSize(9)
          .text(label, labelX, rowY, { width: 70, lineBreak: false });
        doc
          .fillColor(COLOR.bodyText)
          .font('Helvetica-Bold')
          .fontSize(9)
          .text(value, valueX, rowY, { width: 73, lineBreak: false, ellipsis: true });
      };

      const G = W.grid;
      drawWarningKV('Effective:', fmtTime(w.issueIso), G.col.labelL, G.col.valueL, gridTopY);
      drawWarningKV('Expires:', fmtTime(w.expireIso), G.col.labelR, G.col.valueR, gridTopY);
      drawWarningKV('Hail Size:', extractHailSize(w.product), G.col.labelL, G.col.valueL, gridTopY + G.rowPitch);
      drawWarningKV('Wind Speed:', extractWindSpeed(w.product), G.col.labelR, G.col.valueR, gridTopY + G.rowPitch);
      drawWarningKV('Urgency:', 'Immediate', G.col.labelL, G.col.valueL, gridTopY + G.rowPitch * 2);
      drawWarningKV('Certainty:', 'Observed', G.col.labelR, G.col.valueR, gridTopY + G.rowPitch * 2);

      // ── Below: caption + narrative (full-width) ──
      const captionY = py + W.image.h + 6;
      doc
        .fillColor(COLOR.mutedGray)
        .font('Helvetica')
        .fontSize(W.captionFontSize)
        .text(
          `NEXRAD Radar Image from ${fmtDateTime(w.issueIso)}`,
          M,
          captionY,
          { width: CW, lineBreak: false },
        );
      doc
        .fillColor(COLOR.bodyText)
        .font('Helvetica')
        .fontSize(W.narrativeFontSize)
        .text(
          trimNarrative(w.product) || 'No detailed product narrative available.',
          70,
          captionY + 12,
          { width: 472, align: 'justify' },
        );

      doc.y = py + W.blockHeight;
    }
  }

  // ── Section 7 — Historical Storm Activity (9-col table) ──────────────
  // One row per historical storm date within ~10 mi of the property,
  // sorted newest-first. Pulls from sortedHistRows (built earlier from
  // verified_hail_events + swath_cache injection). Per-band cap values
  // run through displayHailIn with the SAME bandVerification context the
  // legacy hit-history table used — preserves the cap algorithm wiring.
  if (sortedHistRows.length > 0) {
    drawSectionBanner('Historical Storm Activity');
    const H = PDF_LAYOUT.historical;
    const PAD = H.cellPad;

    let yt = doc.y;

    // Header row — gray fill, bold 8pt label gray text
    doc.rect(M, yt, CW, H.headerHeight).fill(COLOR.bannerBg);
    doc
      .fillColor(COLOR.labelGray)
      .font('Helvetica-Bold')
      .fontSize(H.headerFontSize);
    for (const col of H.cols) {
      // Multi-line headers ("Within 10mi") wrap — give them height room.
      doc.text(col.label, col.x + PAD.left, yt + PAD.top, {
        width: col.w - PAD.left * 2,
        height: H.headerHeight - PAD.top - 2,
      });
    }
    // Header thin verticals between columns
    for (let i = 1; i < H.cols.length; i += 1) {
      const x = H.cols[i].x;
      doc
        .moveTo(x, yt)
        .lineTo(x, yt + H.headerHeight)
        .strokeColor(COLOR.borderGray)
        .lineWidth(0.4)
        .stroke();
    }
    yt += H.headerHeight;

    // Index histNceiRows by date so we can derive per-row direction /
    // speed / duration from the actual events on that date.
    const eventsByDate = new Map<
      string,
      Array<{ lat: number; lng: number; timeIso: string; eventType: string }>
    >();
    for (const r of histNceiRows) {
      const dateIso = typeof r.event_date === 'string'
        ? r.event_date.slice(0, 10)
        : String(r.event_date).slice(0, 10);
      const lat = typeof r.lat === 'number' ? r.lat : Number(r.lat);
      const lng = typeof r.lng === 'number' ? r.lng : Number(r.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      if (!r.begin_time_utc) continue;
      if (r.event_type !== 'Hail') continue;
      const list = eventsByDate.get(dateIso) ?? [];
      list.push({
        lat,
        lng,
        timeIso: r.begin_time_utc,
        eventType: r.event_type,
      });
      eventsByDate.set(dateIso, list);
    }

    // For the date of loss, also fold in any live `events` cache that
    // didn't get into verified_hail_events yet — gives Direction/Speed/
    // Duration the same data the Hail Impact Details cell used.
    {
      const dolEvents = filterEventsByEtDate(events, req.dateOfLoss).filter(
        (e) => e.eventType === 'Hail',
      );
      if (dolEvents.length > 0) {
        const list = eventsByDate.get(req.dateOfLoss) ?? [];
        for (const e of dolEvents) {
          list.push({
            lat: e.beginLat,
            lng: e.beginLon,
            timeIso: e.beginDate,
            eventType: e.eventType,
          });
        }
        eventsByDate.set(req.dateOfLoss, list);
      }
    }

    const fmtMdy = (iso: string): string => {
      const d = new Date(`${iso}T12:00:00`);
      if (Number.isNaN(d.getTime())) return iso;
      return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
    };

    const fmtImpactTime = (iso: string, dateIso: string): string => {
      const list = eventsByDate.get(dateIso) ?? [];
      if (list.length === 0) return fmtMdy(dateIso);
      // Earliest event = peak time per spec line 175.
      const sorted = [...list].sort(
        (a, b) => new Date(a.timeIso).getTime() - new Date(b.timeIso).getTime(),
      );
      const t = new Date(sorted[0].timeIso);
      if (Number.isNaN(t.getTime())) return fmtMdy(dateIso);
      const datePart = t.toLocaleDateString('en-US', {
        timeZone: 'America/New_York',
        month: 'numeric',
        day: 'numeric',
        year: 'numeric',
      });
      const timePart = t.toLocaleTimeString('en-US', {
        timeZone: 'America/New_York',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
        timeZoneName: 'short',
      });
      return `${datePart}, ${timePart}`;
    };

    for (let i = 0; i < sortedHistRows.length; i += 1) {
      const r = sortedHistRows[i];

      // Auto-paginate before drawing the row if it won't fit.
      if (yt + H.bodyRowHeight > BOTTOM - 8) {
        doc.addPage();
        drawSectionBanner('Historical Storm Activity (continued)');
        yt = doc.y;
        doc.rect(M, yt, CW, H.headerHeight).fill(COLOR.bannerBg);
        doc.fillColor(COLOR.labelGray).font('Helvetica-Bold').fontSize(H.headerFontSize);
        for (const col of H.cols) {
          doc.text(col.label, col.x + PAD.left, yt + PAD.top, {
            width: col.w - PAD.left * 2,
            height: H.headerHeight - PAD.top - 2,
          });
        }
        for (let j = 1; j < H.cols.length; j += 1) {
          const x = H.cols[j].x;
          doc
            .moveTo(x, yt)
            .lineTo(x, yt + H.headerHeight)
            .strokeColor(COLOR.borderGray)
            .lineWidth(0.4)
            .stroke();
        }
        yt += H.headerHeight;
      }

      // Per-band verification contexts — same calls the legacy hit-
      // history table used. Preserves the cap algorithm wiring.
      const atPropCtx = bandVerification(
        r.primaryAtProperty,
        r.dateIso,
        req.lat,
        req.lng,
      );
      const mi1to3Ctx = bandVerification(
        r.primaryMi1to3,
        r.dateIso,
        req.lat,
        req.lng,
      );
      const mi3to5Ctx = bandVerification(
        r.primaryMi3to5,
        r.dateIso,
        req.lat,
        req.lng,
      );
      const mi5to10Ctx = farBandCtx(
        verificationByDate.get(r.dateIso) ?? UNVERIFIED_CTX,
      );

      // Direction / Speed / Duration from per-date events.
      const dateEvents = eventsByDate.get(r.dateIso) ?? [];
      const dirSpeed = computeDirectionAndSpeedFromPoints(dateEvents);
      let durationMin: number | null = null;
      if (dateEvents.length >= 2) {
        const sorted = [...dateEvents].sort(
          (a, b) => new Date(a.timeIso).getTime() - new Date(b.timeIso).getTime(),
        );
        const minMs = new Date(sorted[0].timeIso).getTime();
        const maxMs = new Date(sorted[sorted.length - 1].timeIso).getTime();
        if (Number.isFinite(minMs) && Number.isFinite(maxMs) && maxMs > minMs) {
          durationMin = Math.round((maxMs - minMs) / 60_000 * 10) / 10;
        }
      }

      // Cell values
      const cellValues: Record<string, string> = {
        mapDate: fmtMdy(r.dateIso),
        impactTime: fmtImpactTime(r.dateIso, r.dateIso),
        direction: dirSpeed.heading,
        speed: dirSpeed.speedMph !== null ? dirSpeed.speedMph.toFixed(1) : '—',
        duration: durationMin !== null ? durationMin.toFixed(1) : '—',
        atLocation: r.atProperty > 0 ? displayHailIn(r.atProperty, atPropCtx) : '—',
        within1mi: r.mi1to3 > 0 ? displayHailIn(r.mi1to3, mi1to3Ctx) : '—',
        within3mi: r.mi3to5 > 0 ? displayHailIn(r.mi3to5, mi3to5Ctx) : '—',
        within10mi: r.mi5to10 > 0 ? displayHailIn(r.mi5to10, mi5to10Ctx) : '—',
      };

      doc.fillColor(COLOR.bodyText).font('Helvetica').fontSize(H.bodyFontSize);
      for (const col of H.cols) {
        const value = cellValues[col.key] ?? '—';
        // Impact Time wraps to 2 lines (date, time); other columns single-line.
        if (col.key === 'impactTime' && value.includes(',')) {
          const [datePart, timePart] = value.split(', ');
          doc.text(datePart, col.x + PAD.left, yt + PAD.top, {
            width: col.w - PAD.left * 2,
            lineBreak: false,
          });
          doc.text(timePart || '', col.x + PAD.left, yt + PAD.top + 11, {
            width: col.w - PAD.left * 2,
            lineBreak: false,
          });
        } else {
          doc.text(value, col.x + PAD.left, yt + PAD.top, {
            width: col.w - PAD.left * 2,
            lineBreak: false,
          });
        }
      }

      // Row bottom hairline
      doc
        .moveTo(M, yt + H.bodyRowHeight)
        .lineTo(M + CW, yt + H.bodyRowHeight)
        .strokeColor(COLOR.borderGray)
        .lineWidth(0.5)
        .stroke();
      yt += H.bodyRowHeight;
    }

    // Outer table left/right border (top/bottom drawn implicitly via
    // header fill + last-row hairline).
    doc.y = yt + 8;

    // Footnote — italic 8pt muted gray
    doc
      .fillColor(COLOR.mutedGray)
      .font('Helvetica-Oblique')
      .fontSize(H.footnoteFontSize)
      .text(
        '* Map dates begin at 6:00 a.m. CST on the indicated day and end at 6:00 a.m. CST the following day.',
        M,
        doc.y,
        { width: CW },
      );
    doc.moveDown(0.6);
  }

  // (Legacy "Field Evidence" section removed in Phase 7 of the
  // 2026-04-27 redesign — out of scope per spec. The req.evidence field
  // is still accepted on the API surface so frontends sending it don't
  // 400; the bytes just aren't rendered. fetchEvidenceImageBytes is
  // dead-code; cleanup pass at the end of this phase.)

  // ── Section 8 — Disclaimer + Copyright ─────────────────────────────
  if (doc.y > 620) doc.addPage();
  drawSectionBanner('Disclaimer');
  doc
    .fillColor(COLOR.bodyText)
    .font('Helvetica')
    .fontSize(8.5)
    .text(
      'Hail Yes Storm Intelligence (HYSI) uses NEXRAD weather radar data and proprietary hail detection algorithms to generate the "Hail Impact" and "Historical Storm Activity" information included in this report. And while Hail Yes attempts to be as accurate as possible, Hail Yes makes no representations or warranties of any kind, including express or implied warranties, that the information on this report is accurate, complete, and / or free from defects. Hail Yes is not responsible for any use of this report or decisions based on the information contained in this report. This report does not constitute a professional roof inspection or engineering assessment. A licensed roofing contractor should perform a physical inspection to confirm the presence and extent of any storm damage.',
      70,
      doc.y + 4,
      { width: 472, align: 'justify', lineGap: 3 },
    );
  doc.moveDown(0.8);

  // Copyright strip — full-bleed gray, centered text. Anchor immediately
  // below the disclaimer paragraph; if there isn't room, push to a new
  // page so the strip doesn't get clipped at the bottom margin.
  const yearStr = String(new Date().getFullYear());
  if (doc.y + PDF_LAYOUT.copyright.height + 8 > BOTTOM) doc.addPage();
  const cpY = doc.y + 8;
  doc.rect(0, cpY, PW, PDF_LAYOUT.copyright.height).fill(COLOR.stripBg);
  doc
    .fillColor(COLOR.bodyText)
    .font('Helvetica')
    .fontSize(PDF_LAYOUT.copyright.fontSize)
    .text(
      `Copyright © ${yearStr} by Hail Yes Storm Intelligence (HYSI)`,
      0,
      cpY + 7,
      { width: PW, align: 'center' },
    );

  doc.end();
  return done;
}
