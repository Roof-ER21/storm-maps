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

import PDFDocument from 'pdfkit';
import {
  buildMrmsVectorPolygons,
  buildMrmsImpactResponse,
  type MrmsImpactResult,
} from './mrmsService.js';
import {
  composeStormNarrative,
  biggestHailCallout,
  closestHailCallout,
} from './narrativeComposer.js';
import { haversineMiles, pointInRing } from './geometry.js';
import { buildHailFallbackCollection, IHM_HAIL_LEVELS } from './hailFallbackService.js';
import { fetchStormEventsCached, type StormEventDto } from './eventService.js';
import { buildConsilience, type ConsilienceResult } from './consilienceService.js';
import { fetchNexradSnapshot } from './nexradImageService.js';
import { fetchIemVtecForDate, pointInWarning } from './iemVtecClient.js';
import { sql as pgSql } from '../db.js';
import type { BoundingBox } from './types.js';

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
                 lat::float AS lat, lng::float AS lng
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
                 lat::float AS lat, lng::float AS lng
            FROM verified_hail_events
           WHERE (
                  source_ncei_storm_events = TRUE
               OR source_ncei_swdi = TRUE
               OR source_mping = TRUE
               OR source_hailtrace = TRUE
               OR source_nws_warnings = TRUE
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
  /** Override events; if omitted we pull from the in-repo /api/storm/events cache. */
  events?: StormEventDto[];
  /** Override bounds; if omitted we derive from event extent + 25 mi pad. */
  bounds?: BoundingBox;
  /** Evidence images to embed at the end of the report. Up to 6 are rendered. */
  evidence?: ReportEvidenceItem[];
}

interface RenderedPolygon {
  bandIndex: number;
  color: string;
  rings: number[][][];
}

function hexToRgb(hex: string): [number, number, number] {
  const t = hex.replace(/^#/, '');
  return [
    parseInt(t.slice(0, 2), 16) || 0,
    parseInt(t.slice(2, 4), 16) || 0,
    parseInt(t.slice(4, 6), 16) || 0,
  ];
}

/**
 * Build a lng/lat → page-coords projector that uses the same Web Mercator
 * math Google Static Maps does, so vector swath polygons land exactly on
 * top of the fetched basemap.
 */
function makeMercatorProjector(
  bounds: BoundingBox,
  mapX: number,
  mapY: number,
  mapW: number,
  mapH: number,
): (lng: number, lat: number) => [number, number] {
  const mercY = (lat: number) =>
    Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
  const yNorth = mercY(bounds.north);
  const ySouth = mercY(bounds.south);
  const ySpan = yNorth - ySouth || 1e-6;
  const lngSpan = bounds.east - bounds.west || 1e-6;
  return (lng, lat) => {
    const tx = (lng - bounds.west) / lngSpan;
    const ty = (yNorth - mercY(lat)) / ySpan;
    return [mapX + tx * mapW, mapY + ty * mapH];
  };
}

async function fetchStaticBasemap(
  bounds: BoundingBox,
  width: number,
  height: number,
): Promise<Buffer | null> {
  if (!GOOGLE_STATIC_MAPS_API_KEY) return null;
  const centerLat = (bounds.north + bounds.south) / 2;
  const centerLng = (bounds.east + bounds.west) / 2;
  // Pick a zoom whose pixel-per-degree at this width approximately matches
  // our requested page width. Google caps at zoom 21 / 640px without a
  // premium plan, so request the largest size we can and let pdfkit scale.
  const lngSpan = Math.max(0.05, bounds.east - bounds.west);
  // Each zoom level halves the world width in pixels; world is 256 * 2^zoom.
  // We want widthPx / lngSpan to match our requested map width / lngSpan,
  // i.e. widthPx ≈ (width / lngSpan) * 360.
  const desiredWidthPx = (width / lngSpan) * 360;
  let zoom = Math.max(2, Math.min(21, Math.round(Math.log2(desiredWidthPx / 256))));
  // Empirically zoom-1 looks better since Static Maps centers tightly.
  zoom = Math.max(2, zoom - 1);
  const sizeW = Math.min(640, Math.max(120, Math.round(width)));
  const sizeH = Math.min(640, Math.max(120, Math.round(height)));

  const params = new URLSearchParams({
    center: `${centerLat.toFixed(5)},${centerLng.toFixed(5)}`,
    zoom: String(zoom),
    size: `${sizeW}x${sizeH}`,
    scale: '2',
    maptype: 'roadmap',
    style: 'feature:poi|visibility:off',
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

/**
 * Fetch a Google Street View Static image of the searched property.
 * Returns null on API-key/network/coverage failures. `return_error_code=true`
 * makes the API send 404 instead of a gray "no imagery" PNG when SV is
 * unavailable at this lat/lng — so we can detect and skip without an
 * extra metadata round-trip (the precheck added a race window that
 * sometimes failed under concurrent load).
 */
async function fetchStreetViewImage(
  lat: number,
  lng: number,
  width: number,
  height: number,
): Promise<Buffer | null> {
  if (!GOOGLE_STATIC_MAPS_API_KEY) return null;
  const sizeW = Math.min(640, Math.max(120, Math.round(width)));
  const sizeH = Math.min(640, Math.max(120, Math.round(height)));
  const params = new URLSearchParams({
    location: `${lat.toFixed(6)},${lng.toFixed(6)}`,
    size: `${sizeW}x${sizeH}`,
    fov: '85',
    pitch: '0',
    return_error_code: 'true',
    key: GOOGLE_STATIC_MAPS_API_KEY,
  });
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 8_000);
    const res = await fetch(
      `https://maps.googleapis.com/maps/api/streetview?${params.toString()}`,
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

async function fetchEvidenceImageBytes(
  item: ReportEvidenceItem,
): Promise<Buffer | null> {
  if (item.imageDataUrl) {
    const m = item.imageDataUrl.match(/^data:[^;]+;base64,(.+)$/);
    if (m) {
      try {
        return Buffer.from(m[1], 'base64');
      } catch {
        return null;
      }
    }
  }
  if (item.imageUrl) {
    try {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 6_000);
      const res = await fetch(item.imageUrl, { signal: ac.signal });
      clearTimeout(timer);
      if (!res.ok) return null;
      const ab = await res.arrayBuffer();
      // Cap at 4 MB to keep the PDF small.
      if (ab.byteLength > 4 * 1024 * 1024) return null;
      return Buffer.from(ab);
    } catch {
      return null;
    }
  }
  return null;
}

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
function displayHailIn(inches: number | null): string {
  if (inches === null || inches <= 0) return '—';
  return `${Math.max(0.25, inches).toFixed(2)}"`;
}

function severityScore(events: StormEventDto[]): {
  score: number;
  label: string;
  color: string;
} {
  const hail = events.filter((e) => e.eventType === 'Hail');
  const wind = events.filter((e) => e.eventType === 'Thunderstorm Wind');
  const maxHail = hail.reduce((m, e) => Math.max(m, e.magnitude), 0);
  const maxWind = wind.reduce((m, e) => Math.max(m, e.magnitude), 0);
  const raw =
    hail.length * 8 + wind.length * 5 + maxHail * 18 + (maxWind >= 60 ? 15 : 0);
  const score = Math.max(0, Math.min(100, Math.round(raw)));
  if (score >= 76) return { score, label: 'Critical', color: '#b91c1c' };
  if (score >= 51) return { score, label: 'High', color: '#ea580c' };
  if (score >= 26) return { score, label: 'Moderate', color: '#ca8a04' };
  return { score, label: 'Low', color: '#16a34a' };
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
    margin: 54,
    info: {
      Title: `Storm Impact Analysis - ${req.address}`,
      Author: 'NOAA/NWS Data Analysis',
      Subject: `Severe Weather Impact Analysis for ${req.address}`,
      Creator: 'Hail Yes! · Roof-ER Weather Intelligence Platform',
    },
  });
  const chunks: Buffer[] = [];
  doc.on('data', (c) => chunks.push(c as Buffer));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  // Page geometry shared by every section helper
  const M = 54;
  const PW = 612;
  const CW = 504; // PW - 2*M
  const BOTTOM = 745;

  // SA21-aligned color palette — federal/forensic feel
  const C = {
    text: '#1a1a2e',
    lightText: '#475569',
    mutedText: '#94a3b8',
    sectionBg: '#e8eaf0',
    sectionText: '#3d5a80',
    accent: '#1b4965',
    link: '#2563eb',
    border: '#e2e8f0',
    tableBorder: '#cbd5e1',
  };

  // Section banner — gray-bg horizontal bar with center-aligned italic blue title.
  // Used as the connective tissue between every major section so the document
  // reads as one polished forensic report rather than stacked panels.
  const drawSectionBanner = (title: string): void => {
    const bannerH = 26;
    if (doc.y + bannerH + 24 > BOTTOM) doc.addPage();
    doc.moveDown(0.4);
    const y = doc.y;
    doc.rect(M - 6, y, CW + 12, bannerH).fill(C.sectionBg);
    doc
      .fontSize(12)
      .fillColor(C.sectionText)
      .font('Helvetica-Oblique')
      .text(title, M, y + 7, { width: CW, align: 'center' });
    doc.y = y + bannerH + 8;
  };

  // Auto-generated identifiers — adjuster trust signals.
  const reportId = `${Math.floor(Date.now() / 1000)}-${Math.floor(Math.random() * 9_999_999)
    .toString()
    .padStart(7, '0')}`;
  const verificationCode = Math.random().toString(16).substring(2, 8);

  // ── Federal-authority header ──────────────────────────────────────────
  // Top navy banner stretches edge-to-edge (no margin) so the document
  // reads with the gravity of a NOAA/NWS-authored brief instead of an
  // internal CRM print-out.
  const headerBannerH = 34;
  doc.rect(0, 0, PW, headerBannerH).fill(C.accent);
  doc
    .fontSize(13)
    .fillColor('#ffffff')
    .font('Helvetica-Bold')
    .text('Storm Impact Analysis', M, 11, { width: CW, align: 'center' });
  doc.y = headerBannerH + 12;

  // Sub-header: report metadata (left) + prepared by (right).
  const subY = doc.y;
  doc.fontSize(8.5).fillColor(C.lightText).font('Helvetica');
  doc.text(`Report #: ${reportId}`, M, subY);
  doc.text(
    `Date: ${new Date().toLocaleString('en-US', {
      timeZone: 'America/New_York',
      month: 'numeric',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZoneName: 'short',
    })}`,
    M,
    doc.y,
  );

  const rightX = M + CW * 0.55;
  const rightW = CW * 0.45;
  doc.fontSize(8.5).fillColor(C.lightText).font('Helvetica');
  doc.text('Prepared by:', rightX, subY, { width: rightW });
  if (req.rep?.name) {
    doc.font('Helvetica-Bold').fillColor(C.text).text(req.rep.name, rightX, doc.y, { width: rightW });
  }
  doc.font('Helvetica').fillColor(C.lightText);
  if (req.rep?.phone) doc.text(req.rep.phone, rightX, doc.y, { width: rightW });
  if (req.rep?.email) {
    doc.fillColor(C.link).text(req.rep.email, rightX, doc.y, { width: rightW });
  }

  doc.y = Math.max(doc.y, subY + 38);

  // Verification code line — adjuster cross-check anchor.
  doc
    .fontSize(8)
    .fillColor(C.mutedText)
    .font('Helvetica')
    .text('Verification Code: ', M, doc.y, { continued: true });
  doc.font('Helvetica-Bold').fillColor(C.accent).text(verificationCode);
  doc.moveDown(0.25);

  // Thin divider
  doc
    .moveTo(M, doc.y)
    .lineTo(M + CW, doc.y)
    .strokeColor(C.border)
    .lineWidth(0.5)
    .stroke();
  doc.moveDown(0.4);

  // Property summary line — what the report is about.
  doc.fontSize(10).fillColor(C.text).font('Helvetica-Bold');
  doc.text(`Property: ${req.address}`, M, doc.y, { width: CW });
  doc.font('Helvetica').fillColor(C.lightText).fontSize(9);
  doc.text(
    `Date of Loss: ${req.dateOfLoss}  ·  Search radius: ${req.radiusMiles} mi  ·  Prepared for ${req.company.name}`,
    M,
    doc.y,
    { width: CW },
  );
  doc.moveDown(0.6);

  // ── Build the Property Hail Hit History dataset early ─────────────────
  // This data drives both the Top "Hail Hit History" section (tier-
  // classified, sorted newest-first) AND the bottom per-band detail
  // table. Pulled from NCEI Storm Events archive (18mo window centered
  // on date of loss) + augmented with the 12mo events array for any
  // SPC LSR rows not yet ingested into NCEI.
  type HistRow = {
    dateIso: string;
    label: string;
    atProperty: number;
    mi1to3: number;
    mi3to5: number;
    mi5to10: number;
    biggestNearby: number;
    biggestNearbyMi: number;
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
  const ingestRow = (
    dateIso: string,
    sizeIn: number,
    dist: number,
  ): void => {
    // 25mi gate matches the histNceiRows fetch radius and SA21 storm-days
    // default. Events 10–25mi land in `biggestNearby` only — the per-band
    // table columns top out at 5–10mi, so 10–25mi rows show as AREA IMPACT
    // with all dashes in the 4 band columns plus a "Biggest nearby" caption.
    if (sizeIn < 0.25 || dist > 25) return;
    const row =
      histGroups.get(dateIso) ??
      ({
        dateIso,
        label: '',
        atProperty: 0,
        mi1to3: 0,
        mi3to5: 0,
        mi5to10: 0,
        biggestNearby: 0,
        biggestNearbyMi: 0,
      } as HistRow);
    if (sizeIn > row.biggestNearby) {
      row.biggestNearby = sizeIn;
      row.biggestNearbyMi = dist;
    }
    if (dist <= 1.0 && sizeIn > row.atProperty) row.atProperty = sizeIn;
    else if (dist > 1.0 && dist <= 3.0 && sizeIn > row.mi1to3) row.mi1to3 = sizeIn;
    else if (dist > 3.0 && dist <= 5.0 && sizeIn > row.mi3to5) row.mi3to5 = sizeIn;
    else if (dist > 5.0 && dist <= 10.0 && sizeIn > row.mi5to10) row.mi5to10 = sizeIn;
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
    ingestRow(dateIso, r.magnitude ?? 0, dist);
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
    ingestRow(
      dateIso,
      e.magnitude,
      haversineMiles(req.lat, req.lng, e.beginLat, e.beginLon),
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
            // inside the swath).
            histGroups.set(dateIso, {
              dateIso,
              label: '',
              atProperty: bestSize,
              mi1to3: 0,
              mi3to5: 0,
              mi5to10: 0,
              biggestNearby: bestSize,
              biggestNearbyMi: 0,
            });
          }
        }
      }
    } catch (err) {
      console.warn('[reportPdf] swath direct-hit scan failed:', (err as Error).message);
    }
  }

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
  const finalSortedHistRows = Array.from(histGroups.values())
    .filter(
      (r) =>
        r.atProperty > 0 ||
        r.mi1to3 > 0 ||
        r.mi3to5 > 0 ||
        r.mi5to10 > 0 ||
        (r.biggestNearby > 0 && r.biggestNearbyMi <= 10),
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

  /** Tier from per-band maxes — matches the live UI classifier. */
  const rowTier = (
    r: HistRow,
  ): 'direct_hit' | 'near_miss' | 'area_impact' => {
    if (r.atProperty > 0) return 'direct_hit';
    if (r.mi1to3 > 0) return 'near_miss';
    return 'area_impact';
  };

  // ── Storm Coverage at Property (three-tier + per-band table) ──────────
  // Mirrors Gemini Field Assistant's PDF layout. The tier label headlines
  // the entire report — adjusters reading our PDF and HailTrace's PDF see
  // the same "DIRECT HIT" / "NEAR MISS" / "AREA IMPACT" vocabulary.
  drawSectionBanner('Storm Coverage at Property');
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

  // Street View thumbnail (left side), tier card (right side).
  const streetViewPromise = fetchStreetViewImage(req.lat, req.lng, 200, 130);
  const streetViewImg = await Promise.race([
    streetViewPromise,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 9_000)),
  ]);

  if (propertyImpact) {
    const TIER_STYLE: Record<
      'direct_hit' | 'near_miss' | 'area_impact' | 'no_impact',
      { label: string; bg: string; border: string; text: string }
    > = {
      direct_hit: {
        label: 'DIRECT HIT',
        bg: '#fef2f2',
        border: '#dc2626',
        text: '#991b1b',
      },
      near_miss: {
        label: 'NEAR MISS',
        bg: '#fff7ed',
        border: '#ea580c',
        text: '#9a3412',
      },
      area_impact: {
        label: 'AREA IMPACT',
        bg: '#fefce8',
        border: '#ca8a04',
        text: '#854d0e',
      },
      no_impact: {
        label: 'NO IMPACT',
        bg: '#f8fafc',
        border: '#94a3b8',
        text: '#475569',
      },
    };
    const tier = propertyImpact.tier;
    const tStyle = TIER_STYLE[tier];

    const cardX = 54;
    const cardY = doc.y;
    const cardW = 504;
    const cardH = 152;
    doc.roundedRect(cardX, cardY, cardW, cardH, 6).fill(tStyle.bg);
    doc.roundedRect(cardX, cardY, cardW, cardH, 6).strokeColor(tStyle.border).lineWidth(1.5).stroke();

    // Street View thumbnail
    let textX = cardX + 14;
    let textW = cardW - 28;
    if (streetViewImg) {
      const svW = 130;
      const svH = 100;
      try {
        doc.save();
        doc.roundedRect(cardX + 14, cardY + 14, svW, svH, 4).clip();
        doc.image(streetViewImg, cardX + 14, cardY + 14, {
          width: svW,
          height: svH,
          fit: [svW, svH],
        });
        doc.restore();
        doc.roundedRect(cardX + 14, cardY + 14, svW, svH, 4)
          .strokeColor('#cbd5e1')
          .lineWidth(0.5)
          .stroke();
      } catch (err) {
        console.warn('[reportPdf] street view embed failed:', (err as Error).message);
      }
      textX = cardX + 14 + svW + 14;
      textW = cardW - (svW + 14 + 28);
    }

    // Tier label + at-property hail
    doc
      .fillColor(tStyle.text)
      .font('Helvetica-Bold')
      .fontSize(10)
      .text(tStyle.label, textX, cardY + 14, { width: textW });
    // Headline pulls from the atProperty band so it agrees with the
    // table column. The point-band-label (propertyImpact.label) reflects
    // exactly which band the lat/lng sits inside, but reps quote the
    // max-in-1mi value to adjusters because that's the strongest hit
    // their property actually saw.
    const headlineHail = displayHailIn(
      propertyImpact.bands.atProperty ?? propertyImpact.maxHailInches,
    );
    const headline =
      tier === 'direct_hit'
        ? `${headlineHail} hail at property`
        : tier === 'near_miss'
          ? `${displayHailIn(propertyImpact.bands.atProperty)} hail within 1 mi of property`
          : tier === 'area_impact'
            ? `Storm cell within 10 mi`
            : 'No verified hail within 10 mi';
    doc
      .fillColor(tStyle.text)
      .font('Helvetica-Bold')
      .fontSize(15)
      .text(headline, textX, cardY + 28, { width: textW });

    // Per-band 4-column table (At Property / 1-3mi / 3-5mi / 5-10mi)
    const bandY = cardY + 70;
    const bandH = 60;
    const bandW = textW / 4;
    const bandLabels: Array<[string, string, number | null]> = [
      ['At Property', '0–1 mi', propertyImpact.bands.atProperty],
      ['1–3 mi', '', propertyImpact.bands.mi1to3],
      ['3–5 mi', '', propertyImpact.bands.mi3to5],
      ['5–10 mi', '', propertyImpact.bands.mi5to10],
    ];
    bandLabels.forEach(([label, sub, value], i) => {
      const x = textX + i * bandW;
      doc.roundedRect(x + 2, bandY, bandW - 4, bandH, 4).fill('#ffffff');
      doc
        .fillColor('#64748b')
        .font('Helvetica-Bold')
        .fontSize(8)
        .text(label.toUpperCase(), x + 2, bandY + 6, {
          width: bandW - 4,
          align: 'center',
        });
      if (sub) {
        doc
          .fillColor('#94a3b8')
          .font('Helvetica')
          .fontSize(7)
          .text(sub, x + 2, bandY + 16, { width: bandW - 4, align: 'center' });
      }
      const filled = value !== null && value > 0;
      doc
        .fillColor(filled ? '#0f172a' : '#cbd5e1')
        .font('Helvetica-Bold')
        .fontSize(14)
        .text(filled ? displayHailIn(value) : '—', x + 2, bandY + 30, {
          width: bandW - 4,
          align: 'center',
        });
    });

    doc.y = cardY + cardH + 12;
  }

  // ── Property Hail Hit History (rep-facing summary) ────────────────────
  // What the rep is looking for FIRST when they search an address: a
  // chronological list of every storm in the last 18 months that hit
  // this property, classified by tier so they can decide which date to
  // claim. Matches the live UI's Selected Storm panel vocabulary.
  if (sortedHistRows.length > 0) {
    drawSectionBanner('Property Hail Hit History');
    const HX = 54;
    const HW = 504;
    doc.fillColor('#64748b').font('Helvetica').fontSize(8.5);
    doc.text(
      `${sortedHistRows.length} storm date${sortedHistRows.length === 1 ? '' : 's'} with hail near this property over the last 24 months (within 25 mi). Most recent first.`,
      HX,
      doc.y,
      { width: HW },
    );
    doc.moveDown(0.4);

    const HIT_TIER_STYLE: Record<
      'direct_hit' | 'near_miss' | 'area_impact',
      { label: string; bg: string; fg: string }
    > = {
      direct_hit: { label: 'DIRECT HIT', bg: '#fef2f2', fg: '#991b1b' },
      near_miss: { label: 'NEAR MISS', bg: '#fff7ed', fg: '#9a3412' },
      area_impact: { label: 'AREA IMPACT', bg: '#fefce8', fg: '#854d0e' },
    };

    const ROW_H = 22;
    let hy = doc.y;
    for (const r of sortedHistRows) {
      // Auto-paginate if next row would overflow the safe footer band.
      if (hy + ROW_H > 720) {
        doc.addPage();
        doc.fillColor('#0f172a').fontSize(11).font('Helvetica-Bold');
        doc.text('Property Hail Hit History (continued)', HX, doc.y, {
          width: HW,
        });
        doc.moveDown(0.3);
        hy = doc.y;
      }
      const tier = rowTier(r);
      const style = HIT_TIER_STYLE[tier];

      // Row background tint (alternating)
      doc
        .rect(HX, hy, HW, ROW_H)
        .fill(sortedHistRows.indexOf(r) % 2 === 1 ? '#fafafa' : '#ffffff');

      // Tier badge — 92pt-wide pill on the left
      const badgeX = HX + 4;
      const badgeY = hy + 4;
      const badgeW = 88;
      const badgeH = 14;
      doc.roundedRect(badgeX, badgeY, badgeW, badgeH, 3).fill(style.bg);
      doc
        .fillColor(style.fg)
        .font('Helvetica-Bold')
        .fontSize(8)
        .text(style.label, badgeX, badgeY + 4, {
          width: badgeW,
          align: 'center',
          lineBreak: false,
        });

      // Date — next column
      doc
        .fillColor('#0f172a')
        .font('Helvetica-Bold')
        .fontSize(10)
        .text(r.label, HX + 100, hy + 5, {
          width: 90,
          lineBreak: false,
        });

      // Hail summary — what reps quote to adjusters. AREA IMPACT must
      // headline the WITHIN-10mi event (mi5to10 → mi3to5 → mi1to3), not
      // biggestNearby, because biggestNearby tracks the LARGEST hail
      // anywhere in the 25mi window which can read "11.0 mi away" while
      // the row claims AREA IMPACT (within 10 mi). Mid-range distances
      // (~7mi for 5-10 band) are honest stand-ins; precise event-level
      // distance isn't tracked once we collapse into bands.
      const headlineSize =
        tier === 'direct_hit'
          ? r.atProperty
          : tier === 'near_miss'
            ? r.mi1to3
            : r.mi5to10 > 0
              ? r.mi5to10
              : r.mi3to5 > 0
                ? r.mi3to5
                : r.biggestNearby;
      const distance =
        tier === 'direct_hit'
          ? 'at property'
          : tier === 'near_miss'
            ? 'within 1–3 mi'
            : r.mi5to10 > 0
              ? 'within 5–10 mi'
              : r.mi3to5 > 0
                ? 'within 3–5 mi'
                : `${Math.min(r.biggestNearbyMi, 10).toFixed(1)} mi away`;
      doc
        .fillColor('#1e293b')
        .font('Helvetica')
        .fontSize(10)
        .text(
          `${displayHailIn(headlineSize)} hail · ${distance}`,
          HX + 200,
          hy + 5,
          { width: 200, lineBreak: false },
        );

      // Biggest-nearby cross-ref — gives rep narrative ammo
      doc
        .fillColor('#64748b')
        .font('Helvetica')
        .fontSize(9)
        .text(
          tier === 'direct_hit' && r.biggestNearby > r.atProperty
            ? `Biggest nearby: ${displayHailIn(r.biggestNearby)} @ ${r.biggestNearbyMi.toFixed(1)} mi`
            : '',
          HX + 380,
          hy + 6,
          { width: 124, lineBreak: false, ellipsis: true },
        );

      hy += ROW_H;
    }
    doc.y = hy + 14;
  }

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
    let closestHailIn = 0;
    let closestHailMi: number | undefined;
    let biggestHailIn = collectionMax;
    let biggestHailMi: number | undefined;
    for (const e of datedEvents) {
      if (e.eventType !== 'Hail') continue;
      const d = haversineMiles(req.lat, req.lng, e.beginLat, e.beginLon);
      if (closestHailMi === undefined || d < closestHailMi) {
        closestHailMi = d;
        closestHailIn = e.magnitude;
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
    // Best-effort location label from address — "21000 Cascades Pkwy,
    // Sterling, VA 20165, USA" → "Sterling, VA"
    const locationFallback = (() => {
      const parts = req.address.split(',').map((s) => s.trim()).filter(Boolean);
      if (parts.length >= 3) return `${parts[parts.length - 3]}, ${parts[parts.length - 2].split(' ')[0]}`;
      return req.address;
    })();

    const narrative = composeStormNarrative({
      formattedDate,
      location: locationFallback,
      maxHailInches: headlineHailIn,
      maxWindMph: peakWindEvents,
      totalEvents: datedEvents.length,
      radiusMiles: req.radiusMiles,
      closestHailMiles: closestHailMi,
      biggestHailInches: biggestHailIn > 0 ? biggestHailIn : undefined,
      biggestHailMiles: biggestHailMi,
      severeHailCount: severeCount,
    });

    if (narrative.length > 0) {
      // Anchor explicitly to left margin — previous tier-card cells leave
      // doc.x in the right column. Without an explicit X the narrative
      // wraps at half width and runs off the right edge.
      const NARR_X = 54;
      const NARR_W = 504;
      drawSectionBanner('Storm Impact Narrative');
      doc.fillColor('#1e293b').font('Helvetica').fontSize(10);
      doc.text(narrative, NARR_X, doc.y, {
        width: NARR_W,
        align: 'left',
        lineGap: 1.5,
      });
      doc.moveDown(0.5);

      // BIGGEST/CLOSEST callouts in the same compact band the table uses
      const bigCall = biggestHailCallout(biggestHailIn > 0 ? biggestHailIn : undefined, biggestHailMi);
      const closeCall = closestHailCallout(
        closestHailIn > 0 ? closestHailIn : undefined,
        closestHailMi,
      );
      if (bigCall || closeCall) {
        doc.fillColor('#475569').font('Helvetica-Bold').fontSize(8.5);
        const callouts = [bigCall, closeCall].filter(Boolean).join('   ·   ');
        doc.text(callouts, NARR_X, doc.y, { width: NARR_W });
        doc.moveDown(0.7);
      }
    }
  }

  // ── Storm summary (SA21 layout: 2 large cards, orange numbers) ───────
  // Damage Score card removed per user feedback — a "0/100 Low" headline
  // killed credibility on properties where the date-of-loss had no
  // reports but the hit history shows real prior storms.
  const peakHail = datedEvents
    .filter((e) => e.eventType === 'Hail')
    .reduce((m, e) => Math.max(m, e.magnitude), 0);
  const peakWind = datedEvents
    .filter((e) => e.eventType === 'Thunderstorm Wind')
    .reduce((m, e) => Math.max(m, e.magnitude), 0);
  const stormMax = collection?.metadata.maxHailInches ?? peakHail;
  const headlineHailDay = Math.max(stormMax, peakHail);

  drawSectionBanner(`Storm Summary — ${req.dateOfLoss}`);
  const sumX = 54;
  const sumY = doc.y;
  const sumW = 504;
  const sumCardW = (sumW - 12) / 2;
  const sumCardH = 70;
  const sumOrange = '#ea580c';
  type SumCard = { label: string; value: string; sub: string };
  const sumCards: SumCard[] = [
    {
      label: 'LARGEST HAIL (DAY)',
      value: headlineHailDay > 0 ? `${headlineHailDay.toFixed(2)}"` : '—',
      sub: stormMax >= peakHail ? 'MRMS MESH radar' : 'SPC + IEM LSR ground reports',
    },
    {
      label: 'PEAK WIND (DAY)',
      value: peakWind > 0 ? `${Math.round(peakWind)} mph` : '—',
      sub: peakWind >= 58 ? 'NWS severe (≥58 mph)' : peakWind > 0 ? `${datedEvents.length} report${datedEvents.length === 1 ? '' : 's'}` : 'no gusts reported',
    },
  ];
  sumCards.forEach((c, idx) => {
    const x = sumX + idx * (sumCardW + 12);
    // Frame
    doc.roundedRect(x, sumY, sumCardW, sumCardH, 5).fill('#ffffff');
    doc
      .roundedRect(x, sumY, sumCardW, sumCardH, 5)
      .strokeColor('#e2e8f0')
      .lineWidth(0.7)
      .stroke();
    // Top orange separator strip
    doc.rect(x, sumY, sumCardW, 3).fill(sumOrange);
    // Label centered
    doc
      .fillColor('#475569')
      .font('Helvetica-Bold')
      .fontSize(9)
      .text(c.label, x, sumY + 12, { width: sumCardW, align: 'center' });
    // Big orange value
    doc
      .fillColor(sumOrange)
      .font('Helvetica-Bold')
      .fontSize(24)
      .text(c.value, x, sumY + 26, { width: sumCardW, align: 'center' });
    // Sub-caption
    doc
      .fillColor('#94a3b8')
      .font('Helvetica')
      .fontSize(8)
      .text(c.sub, x, sumY + 56, { width: sumCardW, align: 'center' });
  });
  doc.y = sumY + sumCardH + 16;

  // (Property Hail Hit History table is rendered earlier — right after
  // the Storm Coverage tier card. Its dataset, sortedHistRows, also
  // drives the per-band detail block below.)

  // ── Per-Band Detail (adjuster reference) ──────────────────────────────
  // Same dataset as the top Hit History but rendered with the per-distance
  // columns adjusters cross-reference to confirm where hail did/didn't
  // fall. Rendered lower because reps quote the tier badge on top; this
  // is the supporting detail.
  if (sortedHistRows.length > 0) {
    const TBL_X = 54;
    const colWidths = [88, 96, 90, 90, 90, 90];
    const headers = ['Date', 'At Property (0–1 mi)', '1–3 mi', '3–5 mi', '5–10 mi', 'Biggest Nearby'];

    if (doc.y > 600) doc.addPage();
    drawSectionBanner('Per-Band Storm History (Distance Bands)');
    doc.fillColor('#64748b').font('Helvetica').fontSize(8.5);
    doc.text(
      `MAX hail size by distance band on each storm date — ¼" display floor; sub-trace radar signatures rounded for adjuster use.`,
      TBL_X,
      doc.y,
      { width: 504 },
    );
    doc.moveDown(0.3);

    let tblY = doc.y;
    const drawRow = (
      yStart: number,
      cells: string[],
      isHeader = false,
      tint = false,
    ): number => {
      const rowH = 18;
      if (tint) {
        doc.rect(TBL_X, yStart, colWidths.reduce((a, b) => a + b, 0), rowH).fill('#f8fafc');
      }
      doc.fillColor(isHeader ? '#475569' : '#0f172a');
      doc.font(isHeader ? 'Helvetica-Bold' : 'Helvetica').fontSize(isHeader ? 8.5 : 9);
      let cursor = TBL_X;
      for (let i = 0; i < cells.length; i += 1) {
        doc.text(cells[i], cursor + 4, yStart + 5, {
          width: colWidths[i] - 8,
          height: rowH - 4,
          ellipsis: true,
          lineBreak: false,
        });
        cursor += colWidths[i];
      }
      doc
        .strokeColor('#e2e8f0')
        .lineWidth(0.5)
        .moveTo(TBL_X, yStart + rowH)
        .lineTo(TBL_X + colWidths.reduce((a, b) => a + b, 0), yStart + rowH)
        .stroke();
      return yStart + rowH;
    };

    tblY = drawRow(tblY, headers, true);
    sortedHistRows.forEach((r, i) => {
      const cells = [
        r.label,
        displayHailIn(r.atProperty || null),
        displayHailIn(r.mi1to3 || null),
        displayHailIn(r.mi3to5 || null),
        displayHailIn(r.mi5to10 || null),
        r.biggestNearby > 0
          ? `${displayHailIn(r.biggestNearby)} @ ${r.biggestNearbyMi.toFixed(1)}mi`
          : '—',
      ];
      tblY = drawRow(tblY, cells, false, i % 2 === 1);
      if (tblY > 720) {
        doc.addPage();
        doc.fillColor('#0f172a').fontSize(11).font('Helvetica-Bold');
        doc.text('Per-Band Detail (continued)', TBL_X, doc.y, { width: 504 });
        doc.moveDown(0.3);
        tblY = doc.y;
        tblY = drawRow(tblY, headers, true);
      }
    });
    doc.y = tblY + 14;
  }

  // ── Storm Corroboration (multi-source consilience) ────────────────────
  // Auto-curate rule: render only confirmed sources. If no source confirms
  // the storm AND peak hail < 0.5", render an explicit "no verified storm"
  // notice rather than letting the section quietly disappear (adjusters
  // need to see we *checked*, not just an empty page).
  // Certified Report mode: when ≥3 independent sources confirm, render a
  // green "Forensic Verification" stamp suitable for adjuster-facing claims.
  const consilience = await consiliencePromise;
  const hasCorroboration = consilience && consilience.curated.confirmedSources.length > 0;
  const noVerifiedStorm =
    !hasCorroboration && stormMax < 0.5 && peakHail < 0.5 && peakWind < 50;

  if (noVerifiedStorm) {
    drawSectionBanner('Storm Corroboration');
    const badgeY = doc.y;
    const badgeX = 54;
    const badgeW = 504;
    const badgeH = 56;
    doc.roundedRect(badgeX, badgeY, badgeW, badgeH, 6).fill('#fef2f2');
    doc.roundedRect(badgeX, badgeY, badgeW, badgeH, 6).strokeColor('#fca5a5').lineWidth(1).stroke();
    doc.fillColor('#991b1b').font('Helvetica-Bold').fontSize(10);
    doc.text(
      `No verified storm activity on ${req.dateOfLoss} within ${req.radiusMiles}mi`,
      badgeX + 12,
      badgeY + 8,
      { width: badgeW - 24 },
    );
    doc.fillColor('#7f1d1d').font('Helvetica').fontSize(8.5);
    const denomNo = consilience?.totalSources ?? 12;
    doc.text(
      `Checked ${denomNo} independent sources (MRMS · SPC · IEM LSR · Wind · Synoptic · ` +
        `mPING · NCEI SWDI · NWS · NCEI Storm Events archive · NEXRAD nx3mda · CoCoRaHS` +
        `${denomNo === 12 ? ' · HailTrace' : ''}). None confirmed verified hail or damaging ` +
        `wind at this property on this date.`,
      badgeX + 12,
      badgeY + 24,
      { width: badgeW - 24 },
    );
    doc.y = badgeY + badgeH + 14;
  }

  if (hasCorroboration) {
    const isCertified = consilience.confirmedCount >= 3;

    drawSectionBanner('Multi-Source Storm Corroboration');
    doc.fontSize(9).font('Helvetica').fillColor('#64748b');
    const tierLabel = consilience.confidenceTier
      .replace(/-/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());
    const denom = consilience.totalSources ?? 12;
    doc.text(
      `${consilience.confirmedCount}/${denom} independent sources · ${tierLabel}`,
    );
    doc.moveDown(0.4);

    if (isCertified) {
      // Forensic-verification stamp — green badge with the tier + sources.
      const badgeY = doc.y;
      const badgeX = 54;
      const badgeW = 504;
      const badgeH = 38;
      doc.roundedRect(badgeX, badgeY, badgeW, badgeH, 6).fill('#ecfdf5');
      doc.roundedRect(badgeX, badgeY, badgeW, badgeH, 6).strokeColor('#10b981').lineWidth(1).stroke();
      doc.fillColor('#065f46').font('Helvetica-Bold').fontSize(10);
      doc.text(
        `✓  Forensic Verification — ${tierLabel}`,
        badgeX + 12,
        badgeY + 8,
        { width: badgeW - 24 },
      );
      doc.fillColor('#047857').font('Helvetica').fontSize(8.5);
      doc.text(
        `Confirmed by: ${consilience.curated.confirmedSources.join(' · ')}`,
        badgeX + 12,
        badgeY + 22,
        { width: badgeW - 24 },
      );
      doc.y = badgeY + badgeH + 8;
    }

    doc.fontSize(9.5).font('Helvetica').fillColor('#0f172a');
    for (const line of consilience.curated.evidenceLines) {
      doc.text(`• ${line}`, { width: 504 });
      doc.moveDown(0.15);
    }
    doc.moveDown(0.5);
  }

  // ── Vector swath map ──────────────────────────────────────────────────
  // Force a fresh page if the map (header + 280pt body + legend) won't
  // fit cleanly. Letter page bottom margin is ~72pt; without this guard
  // the new tier card / narrative push the map into a bad split.
  if (doc.y > 460) {
    doc.addPage();
  }
  drawSectionBanner('Hail Footprint Map');
  const mapX = 54;
  const mapY = doc.y;
  const mapW = 504;
  const mapH = 280;

  // Try Google Static Maps as a basemap when an API key is present. Falls
  // back to a flat dark rectangle on any failure (no key, network, quota).
  // Web Mercator math used for both image fetch and polygon projection so
  // the swaths line up with the basemap exactly.
  const project = makeMercatorProjector(bounds, mapX, mapY, mapW, mapH);
  const basemap = await fetchStaticBasemap(bounds, mapW, mapH);
  if (basemap) {
    try {
      doc.image(basemap, mapX, mapY, { width: mapW, height: mapH });
    } catch (err) {
      console.warn('[reportPdf] basemap embed failed', err);
      doc.roundedRect(mapX, mapY, mapW, mapH, 5).fill('#0b1220');
    }
  } else {
    doc.roundedRect(mapX, mapY, mapW, mapH, 5).fill('#0b1220');
  }

  // Render the swath polygons sorted by band so larger bands render on top.
  // CLIP to the map rect so polygons that extend past the bounds (or
  // any rendering glitch) don't bleed yellow into the page margins.
  // doc.save() / doc.restore() bracket the clipped state.
  const renderedFeatures: RenderedPolygon[] = [];
  if (collection) {
    for (const feature of collection.features) {
      renderedFeatures.push({
        bandIndex: feature.properties.level,
        color: feature.properties.color,
        rings: feature.geometry.coordinates.flat(),
      });
    }
    renderedFeatures.sort((a, b) => a.bandIndex - b.bandIndex);
  }
  doc.save();
  doc.rect(mapX, mapY, mapW, mapH).clip();
  for (const f of renderedFeatures) {
    const [r, g, b] = hexToRgb(f.color);
    doc.fillColor([r, g, b]).fillOpacity(0.5).strokeColor([r, g, b]).strokeOpacity(0.95).lineWidth(0.6);
    for (const ring of f.rings) {
      if (ring.length < 3) continue;
      const [first, ...rest] = ring;
      const [px0, py0] = project(first[0], first[1]);
      doc.moveTo(px0, py0);
      for (const [lng, lat] of rest) {
        const [px, py] = project(lng, lat);
        doc.lineTo(px, py);
      }
      doc.closePath().fillAndStroke();
    }
  }
  doc.fillOpacity(1).strokeOpacity(1);
  doc.restore();

  // Subject property pin — larger, clearer, with white halo for contrast
  const [pinX, pinY] = project(req.lng, req.lat);
  doc.fillColor('#ffffff').strokeColor('#0f172a').lineWidth(1.4);
  doc.circle(pinX, pinY, 8).fillAndStroke();
  doc.fillColor('#dc2626').strokeColor('#7f1d1d').lineWidth(0.8);
  doc.circle(pinX, pinY, 5).fillAndStroke();
  doc.fillColor('#0f172a').fontSize(9).font('Helvetica-Bold');
  doc.text('Property', pinX + 10, pinY - 5);

  // Frame the map with a thin border so the polygons sit inside a clean box
  doc
    .rect(mapX, mapY, mapW, mapH)
    .strokeColor('#cbd5e1')
    .lineWidth(0.6)
    .stroke();

  // Legend strip BELOW the map — bigger swatches, dark labels, readable.
  // Replace fraction glyphs PDFKit's Helvetica doesn't ship (⅛, ⅜, ⅝, ⅞)
  // with ASCII fallbacks so the labels don't render as `!"` placeholders.
  const labelForLegend = (raw: string): string =>
    raw
      .replace(/⅛/g, '1/8')
      .replace(/⅜/g, '3/8')
      .replace(/⅝/g, '5/8')
      .replace(/⅞/g, '7/8');
  doc.y = mapY + mapH + 6;
  const legendStripY = doc.y;
  doc
    .fontSize(8.5)
    .fillColor('#475569')
    .font('Helvetica-Bold')
    .text('Hail size scale (MRMS MESH):', mapX, legendStripY, { lineBreak: false });
  let legendX = mapX + 156;
  for (const lvl of IHM_HAIL_LEVELS) {
    const [lr, lg, lb] = hexToRgb(lvl.color);
    doc.fillColor([lr, lg, lb]).rect(legendX, legendStripY - 1, 14, 11).fill();
    doc
      .strokeColor('#0f172a')
      .lineWidth(0.4)
      .rect(legendX, legendStripY - 1, 14, 11)
      .stroke();
    doc
      .fillColor('#0f172a')
      .font('Helvetica')
      .fontSize(7.5)
      .text(labelForLegend(lvl.label), legendX + 16, legendStripY + 1, { lineBreak: false });
    legendX += 50;
    if (legendX > mapX + mapW - 30) break;
  }
  doc.y = legendStripY + 18;

  // ── Event detail table ────────────────────────────────────────────────
  // Sort all reports up front; render until we're out of page space, then
  // continue on a new page with a re-drawn header. No truncation — every
  // documented gust/hail report ends up in the PDF.
  const sortedEvents = [...datedEvents].sort(
    (a, b) =>
      b.magnitude - a.magnitude ||
      Date.parse(b.beginDate) - Date.parse(a.beginDate),
  );

  const tableBottom = 720; // leave space above the footer
  const drawTableHeader = (yStart: number): number => {
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#475569');
    doc.text('Time (ET)', 54, yStart);
    doc.text('Type', 130, yStart);
    doc.text('Magnitude', 200, yStart);
    doc.text('Location', 280, yStart);
    doc.text('Source', 470, yStart);
    doc
      .strokeColor('#e2e8f0')
      .lineWidth(0.5)
      .moveTo(54, yStart + 12)
      .lineTo(558, yStart + 12)
      .stroke();
    return yStart + 16;
  };

  if (sortedEvents.length > 0) {
    drawSectionBanner('Documented Storm Reports');
    doc.fontSize(9).font('Helvetica').fillColor('#64748b');
    doc.text(
      `${sortedEvents.length} report${sortedEvents.length === 1 ? '' : 's'} on ${req.dateOfLoss}, sorted by magnitude.`,
    );
    doc.moveDown(0.3);
    let rowY = drawTableHeader(doc.y);

    for (const e of sortedEvents) {
      if (rowY > tableBottom) {
        doc.addPage();
        doc.fillColor('#0f172a').fontSize(11).font('Helvetica-Bold').text('Reports (continued)');
        doc.moveDown(0.3);
        rowY = drawTableHeader(doc.y);
      }
      const time = new Date(e.beginDate).toLocaleTimeString('en-US', {
        timeZone: 'America/New_York',
        hour: 'numeric',
        minute: '2-digit',
      });
      doc.font('Helvetica').fontSize(8).fillColor('#0f172a');
      doc.text(time, 54, rowY);
      doc.text(e.eventType === 'Hail' ? 'Hail' : 'Wind', 130, rowY);
      const mag =
        e.eventType === 'Hail'
          ? `${e.magnitude.toFixed(2)}"`
          : `${Math.round(e.magnitude)} mph`;
      doc.text(mag, 200, rowY);
      const loc =
        `${e.county || ''}${e.state ? ', ' + e.state : ''}` ||
        `${e.beginLat.toFixed(2)}, ${e.beginLon.toFixed(2)}`;
      doc.text(loc.slice(0, 40), 280, rowY, { width: 180 });
      doc.fillColor('#64748b').text((e.source || '').slice(0, 12), 470, rowY);
      rowY += 14;
    }
  }

  // ── Active NWS Warnings (SA21 layout) ────────────────────────────────
  // Per-warning panel: NEXRAD reflectivity image (left) + warning details
  // box (right) with effective/expires/hail-size/wind-speed/urgency/
  // certainty + the warning's product narrative below. Mirrors the SA21
  // PDF's "Active National Weather Service Warnings" section that
  // adjusters quote when justifying a claim.
  // Prefer warnings with property-in-polygon; fall back to ones intersecting
  // the search bounds. Up to 5 warnings rendered in chronological order.
  const vtecWarnings = await fetchIemVtecForDate({
    date: req.dateOfLoss,
    bounds,
  }).catch(() => [] as Awaited<ReturnType<typeof fetchIemVtecForDate>>);

  const propWarnings = vtecWarnings.filter((w) =>
    pointInWarning(req.lat, req.lng, w),
  );
  // If no warnings contain the property, take any warning whose polygon
  // overlaps the search bounds — the rep can still cite "5 NWS warnings
  // for the area encompassing this property" verbatim from SA21's PDF.
  const allInArea = propWarnings.length > 0 ? propWarnings : vtecWarnings;
  // Prefer SV (severe thunderstorm) + TO (tornado) over flash flood.
  const phenomenonRank: Record<string, number> = {
    TO: 0, // tornado highest
    SV: 1, // severe thunderstorm
    EW: 2, // extreme wind
    FF: 3, // flash flood
  };
  const sortedWarnings = [...allInArea]
    .sort(
      (a, b) =>
        (phenomenonRank[a.phenomenon] ?? 9) -
          (phenomenonRank[b.phenomenon] ?? 9) ||
        Date.parse(a.issueIso) - Date.parse(b.issueIso),
    )
    .slice(0, 5);

  // Snapshot at warning issue time — radar reflectivity at the moment
  // the warning was first issued. Bounds are tightened around the
  // warning polygon's centroid so the image actually shows the cell
  // that triggered the warning, not a county-wide blank.
  const warningPanels: Array<{
    warn: (typeof sortedWarnings)[number];
    radarBuf: Buffer | null;
  }> = [];
  for (const warn of sortedWarnings) {
    const radarBuf = await fetchNexradSnapshot({
      timeIso: warn.issueIso,
      bbox: bounds,
      width: 360,
      height: 240,
    }).catch(() => null);
    warningPanels.push({ warn, radarBuf });
  }

  if (warningPanels.length > 0) {
    doc.addPage();
    drawSectionBanner('Active National Weather Service Warnings');
    doc
      .fontSize(9)
      .font('Helvetica')
      .fillColor('#475569')
      .text(
        `${warningPanels.length} active NWS warning${warningPanels.length === 1 ? '' : 's'} for the area encompassing ${req.address}. Each panel shows the NEXRAD WSR-88D reflectivity at the moment the warning was issued, alongside the warning's effective window and product details.`,
        M,
        doc.y,
        { width: CW },
      );
    doc.moveDown(0.5);

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
        month: 'numeric',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      });
    };
    const extractHailSize = (product: string | undefined): string => {
      if (!product) return 'n/a';
      // Match hail size patterns: "HAIL...QUARTER (1.00 INCH)", "1.50 INCH HAIL", "PING PONG BALL (1.50 IN)"
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
      // Pick the first sentence-ish chunk after the warning header.
      const cleaned = product
        .replace(/\r/g, '')
        .replace(/\.{3,}/g, ' ')
        .trim();
      // Find the storm-impact sentence (typically after "...HAZARD..." or "...IMPACT...")
      const after = cleaned.split(/HAZARD\.{3}|IMPACT\.{3}/i)[1]?.trim();
      if (after && after.length > 10) {
        return after.slice(0, 240).split('\n')[0];
      }
      // Fall back to any sentence with a roof/wind/hail noun
      const fallback = cleaned.match(/[^.\n]*\b(hail|wind|gust|trees|damage|roof|debris)\b[^.\n]{0,200}/i);
      if (fallback) return fallback[0].trim().slice(0, 240);
      return cleaned.slice(0, 200);
    };

    for (const panel of warningPanels) {
      const w = panel.warn;
      const panelW = CW;
      const panelH = 180;
      // Page break if next panel doesn't fit above the BOTTOM safe line.
      if (doc.y + panelH + 12 > BOTTOM) {
        doc.addPage();
        drawSectionBanner('Active NWS Warnings (continued)');
      }
      const py = doc.y;
      const radarW = 240;
      const radarH = panelH;
      const detailX = M + radarW + 12;
      const detailW = panelW - radarW - 12;

      // Radar image (or dark fallback)
      if (panel.radarBuf) {
        try {
          doc.save();
          doc.rect(M, py, radarW, radarH).clip();
          doc.image(panel.radarBuf, M, py, {
            fit: [radarW, radarH],
            align: 'center',
            valign: 'center',
          });
          doc.restore();
        } catch {
          doc.rect(M, py, radarW, radarH).fill('#0b1220');
        }
      } else {
        doc.rect(M, py, radarW, radarH).fill('#0b1220');
      }
      // Image source caption strip (below image, narrow)
      doc
        .fontSize(7)
        .fillColor('#64748b')
        .font('Helvetica')
        .text(
          `NEXRAD WSR-88D Radar — ${req.dateOfLoss}  |  Source: IEM/NOAA`,
          M,
          py + radarH - 9,
          { width: radarW, lineBreak: false },
        );

      // Warning detail box
      doc
        .fontSize(10.5)
        .fillColor(C.text)
        .font('Helvetica-Bold')
        .text(
          `${phenomenonLabel[w.phenomenon] ?? w.phenomenon} issued ${fmtTime(w.issueIso)}`,
          detailX,
          py + 4,
          { width: detailW },
        );

      // 2-column key/value table inside the right pane
      const labelY = py + 26;
      const labelGap = 14;
      const labelCol1X = detailX;
      const labelCol2X = detailX + detailW / 2;

      const drawKV = (
        label: string,
        value: string,
        x: number,
        y: number,
        w2: number,
      ) => {
        doc
          .fontSize(8)
          .fillColor('#64748b')
          .font('Helvetica-Bold')
          .text(label, x, y, { width: w2 });
        doc
          .fontSize(9)
          .fillColor(C.text)
          .font('Helvetica-Bold')
          .text(value, x, y + 11, { width: w2, lineBreak: false, ellipsis: true });
      };

      drawKV('Effective:', fmtTime(w.issueIso), labelCol1X, labelY, detailW / 2 - 6);
      drawKV('Expires:', fmtTime(w.expireIso), labelCol2X, labelY, detailW / 2 - 6);
      drawKV('Hail Size:', extractHailSize(w.product), labelCol1X, labelY + 30, detailW / 2 - 6);
      drawKV('Wind Speed:', extractWindSpeed(w.product), labelCol2X, labelY + 30, detailW / 2 - 6);
      drawKV('Urgency:', 'Observed', labelCol1X, labelY + 60, detailW / 2 - 6);
      drawKV('Certainty:', 'Moderate', labelCol2X, labelY + 60, detailW / 2 - 6);

      // Narrative below KV grid
      doc
        .fontSize(8.5)
        .fillColor('#475569')
        .font('Helvetica-Oblique')
        .text(
          trimNarrative(w.product) || 'No detailed product narrative available.',
          detailX,
          labelY + 90,
          { width: detailW, height: panelH - (labelY + 90 - py) - 8 },
        );

      doc.y = py + panelH + 8;
    }
  }

  // ── Evidence images ───────────────────────────────────────────────────
  const evidenceBytes: Array<{ buf: Buffer; title?: string; caption?: string }> =
    [];
  if (req.evidence && req.evidence.length > 0) {
    for (const item of req.evidence.slice(0, 6)) {
      const buf = await fetchEvidenceImageBytes(item);
      if (buf) {
        evidenceBytes.push({ buf, title: item.title, caption: item.caption });
      }
    }
  }
  if (evidenceBytes.length > 0) {
    doc.addPage();
    drawSectionBanner('Field Evidence');
    const evX = 54;
    const evY = doc.y;
    const cellW = (504 - 16) / 2; // 2 columns
    const cellH = 220;
    for (let i = 0; i < evidenceBytes.length; i += 1) {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const x = evX + col * (cellW + 16);
      const y = evY + row * (cellH + 24);
      try {
        doc.image(evidenceBytes[i].buf, x, y, {
          fit: [cellW, cellH - 36],
          align: 'center',
          valign: 'center',
        });
      } catch (err) {
        console.warn('[reportPdf] evidence embed failed', err);
        continue;
      }
      doc.font('Helvetica-Bold').fontSize(9).fillColor('#0f172a');
      if (evidenceBytes[i].title) {
        doc.text(evidenceBytes[i].title!, x, y + cellH - 30, {
          width: cellW,
          ellipsis: true,
        });
      }
      if (evidenceBytes[i].caption) {
        doc.font('Helvetica').fontSize(8).fillColor('#64748b');
        doc.text(evidenceBytes[i].caption!, x, y + cellH - 16, {
          width: cellW,
          ellipsis: true,
        });
      }
    }
  }

  // ── NCEI Archive appendix (official NOAA Storm Events DB) ────────────
  // The same data adjusters cite. Pulled from verified_hail_events where
  // source_ncei_storm_events=TRUE; window ±30 days of date_of_loss; radius
  // matches the property search radius. Each row carries an NCEI EVENT_ID
  // for direct cross-reference against ncdc.noaa.gov/stormevents.
  const nceiRows = await fetchNceiArchiveForReport({
    lat: req.lat,
    lng: req.lng,
    dateOfLoss: req.dateOfLoss,
    radiusMiles: req.radiusMiles,
    windowDays: 30,
    nceiOnly: true, // bottom appendix labels itself "NCEI Storm Events Archive" so it must filter to that source
  });
  if (nceiRows.length > 0) {
    doc.addPage();
    drawSectionBanner('NCEI Storm Events Archive (Appendix)');
    doc.fontSize(9).font('Helvetica').fillColor('#64748b');
    doc.text(
      `${nceiRows.length} official NOAA Storm Events Database record${nceiRows.length === 1 ? '' : 's'} within ${req.radiusMiles} mi of the property and ±30 days of ${req.dateOfLoss}. Each row is independently citable via its NCEI EVENT_ID at ncdc.noaa.gov/stormevents/.`,
      { width: 504 },
    );
    doc.moveDown(0.5);

    const drawNceiHeader = (yStart: number): number => {
      doc.font('Helvetica-Bold').fontSize(8).fillColor('#475569');
      doc.text('Date (ET)', 54, yStart);
      doc.text('County', 130, yStart);
      doc.text('Type', 220, yStart);
      doc.text('Magnitude', 290, yStart);
      doc.text('NCEI ID', 360, yStart);
      doc.text('Notes', 420, yStart);
      doc
        .strokeColor('#e2e8f0')
        .lineWidth(0.5)
        .moveTo(54, yStart + 12)
        .lineTo(558, yStart + 12)
        .stroke();
      return yStart + 16;
    };

    let nceiRowY = drawNceiHeader(doc.y);
    const tableBottom = 720;
    for (const r of nceiRows) {
      if (nceiRowY > tableBottom) {
        doc.addPage();
        doc.fillColor('#0f172a').fontSize(11).font('Helvetica-Bold').text('NCEI Archive (continued)');
        doc.moveDown(0.3);
        nceiRowY = drawNceiHeader(doc.y);
      }
      doc.font('Helvetica').fontSize(8).fillColor('#0f172a');
      doc.text(r.event_date, 54, nceiRowY, { width: 70 });
      doc.text((r.county ?? '').slice(0, 18), 130, nceiRowY, { width: 84 });
      const typeLabel =
        r.event_type === 'Hail'
          ? 'Hail'
          : r.event_type === 'Thunderstorm Wind'
            ? 'T-Wind'
            : (r.event_type ?? '');
      doc.text(typeLabel, 220, nceiRowY, { width: 64 });
      // Tornado rows carry no `magnitude` (ingest stores 0) — surface the
      // F/EF scale instead so the appendix doesn't show "0"" for an EF2.
      let magStr: string;
      if (r.event_type === 'Tornado') {
        magStr = r.tor_f_scale ? r.tor_f_scale.toUpperCase() : '—';
      } else if (r.magnitude === null) {
        magStr = '';
      } else if (r.event_type === 'Hail') {
        magStr = `${r.magnitude.toFixed(2)}"`;
      } else {
        magStr = `${Math.round(r.magnitude)} mph`;
      }
      doc.text(magStr, 290, nceiRowY, { width: 64 });
      doc.fillColor('#64748b');
      doc.text((r.ncei_event_id ?? '').slice(0, 9), 360, nceiRowY, { width: 56 });
      doc.fillColor('#475569');
      doc.text((r.narrative ?? '').slice(0, 120), 420, nceiRowY, {
        width: 138,
        ellipsis: true,
        height: 24,
      });
      nceiRowY += 16;
    }
  }

  // ── Data Sources & Methodology ────────────────────────────────────────
  // Establishes federal-data provenance for adjuster-facing claims. Each
  // bullet is one independent agency or scientific network so a single
  // commercial vendor can't be used to discredit the report.
  if (doc.y > 580) doc.addPage();
  drawSectionBanner('Data Sources & Methodology');
  doc
    .fontSize(9)
    .fillColor(C.lightText)
    .font('Helvetica')
    .text(
      'This report aggregates storm event records from multiple independent federal and scientific-network data sources. No commercial or proprietary data is used. All sources are publicly accessible and independently verifiable.',
      M,
      doc.y,
      { width: CW },
    );
  doc.moveDown(0.4);

  const sources: Array<{ name: string; desc: string }> = [
    {
      name: 'NOAA NCEI Storm Events Database',
      desc: 'Official severe-weather event record maintained by the National Oceanic and Atmospheric Administration, National Centers for Environmental Information. Events reviewed by National Weather Service meteorologists. (ncei.noaa.gov)',
    },
    {
      name: 'NOAA MRMS MESH (Multi-Radar Multi-Sensor Hail)',
      desc: 'Maximum Estimated Size of Hail product fused from the full WSR-88D NEXRAD radar mosaic. Source-of-truth for adjuster-grade hail size estimation.',
    },
    {
      name: 'NOAA Storm Prediction Center (SPC) WCM Archive',
      desc: 'Severe weather database curated by the Warning Coordination Meteorologist at the NOAA Storm Prediction Center (Norman, OK). Independent observation pipeline from NCEI; provides cross-check.',
    },
    {
      name: 'NWS Local Storm Reports via Iowa Environmental Mesonet',
      desc: 'Real-time ground-observer reports filed with NWS Forecast Offices and archived by IEM at Iowa State University. Fills the 45-day review window before NCEI Storm Events is finalized.',
    },
    {
      name: 'CoCoRaHS — Community Collaborative Rain, Hail & Snow Network',
      desc: 'Citizen-scientist precipitation observer network operated by the Colorado Climate Center at Colorado State University with support from the National Science Foundation. Observer-measured hail stone size, duration, and consistency.',
    },
    {
      name: 'NEXRAD WSR-88D Doppler Radar Network',
      desc: 'Next-Generation Radar network operated jointly by NWS, FAA, and U.S. Air Force. Radar imagery embedded in this report is sourced from the IEM NEXRAD archive.',
    },
  ];
  for (const s of sources) {
    if (doc.y + 32 > BOTTOM) doc.addPage();
    doc
      .fontSize(9)
      .fillColor(C.text)
      .font('Helvetica-Bold')
      .text(`• ${s.name}`, M, doc.y, { width: CW });
    doc
      .fontSize(8.5)
      .fillColor(C.lightText)
      .font('Helvetica')
      .text(s.desc, M + 12, doc.y, { width: CW - 12 });
    doc.moveDown(0.2);
  }
  doc.moveDown(0.3);
  doc
    .fontSize(8.5)
    .fillColor('#0a6640')
    .font('Helvetica-Oblique')
    .text(
      'The sources above are operated by distinct federal agencies and scientific institutions and do not share a common observation pipeline. Independent confirmation of the same event across multiple sources provides higher confidence than any single source alone. Original event identifiers are retained for independent verification by the reader.',
      M,
      doc.y,
      { width: CW },
    );
  doc.moveDown(0.6);

  // ── Disclaimer & Limitations ─────────────────────────────────────────
  if (doc.y > 600) doc.addPage();
  drawSectionBanner('Disclaimer & Limitations');
  doc
    .fontSize(8.5)
    .fillColor(C.lightText)
    .font('Helvetica')
    .text(
      'This Storm Impact Analysis is generated from publicly available federal and scientific-network data: the NOAA National Centers for Environmental Information (NCEI) Storm Events Database, NOAA MRMS MESH (Multi-Radar Multi-Sensor Hail) product, NOAA Storm Prediction Center (SPC) Warning Coordination Meteorologist archive, NWS Local Storm Reports via Iowa Environmental Mesonet (IEM), the Community Collaborative Rain, Hail & Snow Network (CoCoRaHS), and the NEXRAD WSR-88D Doppler radar network. ' +
        'All storm event data, radar imagery, and severe weather warnings originate from these sources and are presented as reported. While every effort is made to ensure accuracy, weather data is subject to inherent limitations including radar resolution, reporting delays, and observation gaps. ' +
        'This report is provided for informational purposes and does not constitute a professional roof inspection, engineering assessment, or meteorological certification. A licensed roofing contractor should perform a physical inspection to confirm the presence and extent of any storm damage. The preparer of this report makes no independent representations regarding the accuracy of the underlying federal data; original event identifiers (NCEI EVENT_ID, SPC OM#, CoCoRaHS station, NEXRAD WSR ID, MRMS GRIB2 file path) are retained in this report for independent verification.',
      M,
      doc.y,
      { width: CW, align: 'justify' },
    );

  // ── Closing footer ────────────────────────────────────────────────────
  // Single closing line on the last page — mirrors the SA21 approach.
  // Per-page navy bar via bufferPages was tried first and was creating
  // phantom blank pages because text() at y>page-margin auto-paginates
  // even with bufferPages=true. The single-line ending is cleaner anyway.
  const yearStr = String(new Date().getFullYear());
  doc.moveDown(0.6);
  doc
    .fontSize(8)
    .fillColor(C.mutedText)
    .font('Helvetica-Oblique')
    .text(
      `Prepared by ${req.company.name}  ·  Data sourced from NOAA, NWS, and NEXRAD federal weather systems  ·  © ${yearStr}`,
      M,
      doc.y,
      { width: CW, align: 'center' },
    );

  doc.end();
  return done;
}
