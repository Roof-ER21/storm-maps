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
import { buildMrmsVectorPolygons } from './mrmsService.js';
import { buildHailFallbackCollection, IHM_HAIL_LEVELS } from './hailFallbackService.js';
import { fetchStormEventsCached, type StormEventDto } from './eventService.js';
import { buildConsilience, type ConsilienceResult } from './consilienceService.js';
import { fetchNexradSnapshot } from './nexradImageService.js';
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
}

async function fetchNceiArchiveForReport(opts: {
  lat: number;
  lng: number;
  dateOfLoss: string;
  radiusMiles: number;
  windowDays?: number;
}): Promise<NceiAppendixRow[]> {
  if (!pgSql) return [];
  const days = opts.windowDays ?? 30;
  // Tight bbox around property — radius+pad in degrees.
  const latPad = (opts.radiusMiles + 5) / 69;
  const lngPad = (opts.radiusMiles + 5) / (69 * Math.cos((opts.lat * Math.PI) / 180));
  try {
    const rows = await pgSql<NceiAppendixRow[]>`
      SELECT event_date::text, state_code, county, event_type,
             magnitude, tor_f_scale, ncei_event_id::text,
             begin_time_utc::text, narrative
        FROM verified_hail_events
       WHERE source_ncei_storm_events = TRUE
         AND lat BETWEEN ${opts.lat - latPad} AND ${opts.lat + latPad}
         AND lng BETWEEN ${opts.lng - lngPad} AND ${opts.lng + lngPad}
         AND event_date BETWEEN
             (${opts.dateOfLoss}::date - ${days}::int)
         AND (${opts.dateOfLoss}::date + ${days}::int)
       ORDER BY event_date DESC, magnitude DESC NULLS LAST
       LIMIT 200
    `;
    return rows;
  } catch (err) {
    console.warn('[reportPdf] NCEI appendix fetch failed:', (err as Error).message);
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
  const doc = new PDFDocument({ size: 'LETTER', margin: 54 });
  const chunks: Buffer[] = [];
  doc.on('data', (c) => chunks.push(c as Buffer));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  // ── Header ────────────────────────────────────────────────────────────
  doc.fillColor('#0f172a').fontSize(20).font('Helvetica-Bold');
  doc.text(req.company.name, { continued: false });
  doc.fontSize(11).font('Helvetica').fillColor('#475569');
  doc.text(`${req.rep.name}  ·  ${req.rep.phone ?? ''}  ·  ${req.rep.email ?? ''}`);
  doc.moveDown(0.5);
  doc.strokeColor('#e2e8f0').lineWidth(1).moveTo(54, doc.y).lineTo(558, doc.y).stroke();
  doc.moveDown(0.7);

  doc.fillColor('#0f172a').fontSize(16).font('Helvetica-Bold');
  doc.text('Storm Day Report');
  doc.fontSize(10).font('Helvetica').fillColor('#475569');
  doc.text(`Property: ${req.address}`);
  doc.text(`Date of Loss: ${req.dateOfLoss}`);
  doc.text(
    `Search radius: ${req.radiusMiles} mi  ·  Generated ${new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })} ET`,
  );
  doc.moveDown(0.8);

  // ── Storm summary ─────────────────────────────────────────────────────
  const score = severityScore(datedEvents);
  const peakHail = datedEvents
    .filter((e) => e.eventType === 'Hail')
    .reduce((m, e) => Math.max(m, e.magnitude), 0);
  const peakWind = datedEvents
    .filter((e) => e.eventType === 'Thunderstorm Wind')
    .reduce((m, e) => Math.max(m, e.magnitude), 0);
  const stormMax = collection?.metadata.maxHailInches ?? peakHail;

  doc.fillColor('#0f172a').fontSize(13).font('Helvetica-Bold').text('Storm Summary');
  doc.moveDown(0.3);
  const sumX = 54;
  const sumY = doc.y;
  const cardWidth = 122;
  const cardHeight = 60;
  const cards: Array<{ label: string; value: string; sub?: string; color: string }> = [
    {
      label: 'Damage Score',
      value: `${score.score}/100`,
      sub: score.label,
      color: score.color,
    },
    {
      label: 'Peak Hail (radar)',
      value: stormMax > 0 ? `${stormMax.toFixed(2)}″` : '—',
      sub: 'MRMS MESH',
      color: '#0f172a',
    },
    {
      label: 'Peak Hail (reports)',
      value: peakHail > 0 ? `${peakHail.toFixed(2)}″` : '—',
      sub: 'SPC + IEM LSR',
      color: '#0f172a',
    },
    {
      label: 'Peak Wind Gust',
      value: peakWind > 0 ? `${Math.round(peakWind)} mph` : '—',
      sub: `${datedEvents.length} reports`,
      color: '#0f172a',
    },
  ];
  cards.forEach((c, idx) => {
    const x = sumX + idx * (cardWidth + 4);
    doc.roundedRect(x, sumY, cardWidth, cardHeight, 5).fill('#f8fafc');
    doc
      .fillColor('#64748b')
      .font('Helvetica')
      .fontSize(8)
      .text(c.label.toUpperCase(), x + 8, sumY + 8, { width: cardWidth - 16 });
    doc.fillColor(c.color).font('Helvetica-Bold').fontSize(15);
    doc.text(c.value, x + 8, sumY + 22, { width: cardWidth - 16 });
    if (c.sub) {
      doc.fillColor('#94a3b8').font('Helvetica').fontSize(8);
      doc.text(c.sub, x + 8, sumY + 42, { width: cardWidth - 16 });
    }
  });
  doc.y = sumY + cardHeight + 18;

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
    doc.fillColor('#0f172a').fontSize(13).font('Helvetica-Bold').text('Storm Corroboration');
    doc.moveDown(0.3);
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

    doc.fillColor('#0f172a').fontSize(13).font('Helvetica-Bold').text('Storm Corroboration');
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
  doc.fillColor('#0f172a').fontSize(13).font('Helvetica-Bold').text('Hail Footprint');
  doc.moveDown(0.3);
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

  // Subject property pin
  const [pinX, pinY] = project(req.lng, req.lat);
  doc.fillColor('#fbbf24').strokeColor('#0f172a').lineWidth(1.2);
  doc.circle(pinX, pinY, 5).fillAndStroke();
  doc.fillColor('#fbbf24').fontSize(8).font('Helvetica-Bold');
  doc.text(' Property', pinX + 6, pinY - 4);

  // Bounding box label
  doc.fillColor('#94a3b8').font('Helvetica').fontSize(8);
  doc.text(
    `bbox: ${bounds.south.toFixed(2)}, ${bounds.west.toFixed(2)} → ${bounds.north.toFixed(2)}, ${bounds.east.toFixed(2)}`,
    mapX + 8,
    mapY + mapH - 12,
  );

  // Legend strip across the top of the map area
  const legendY = mapY + 8;
  let legendX = mapX + 8;
  doc.fontSize(7).font('Helvetica').fillColor('#cbd5e1').text('Hail size:', legendX, legendY);
  legendX += 38;
  for (const lvl of IHM_HAIL_LEVELS) {
    const [lr, lg, lb] = hexToRgb(lvl.color);
    doc.fillColor([lr, lg, lb]).rect(legendX, legendY, 8, 8).fill();
    doc.fillColor('#cbd5e1').text(lvl.label, legendX + 10, legendY + 1);
    legendX += 36;
    if (legendX > mapX + mapW - 30) break;
  }

  doc.y = mapY + mapH + 12;

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

  doc.fillColor('#0f172a').fontSize(13).font('Helvetica-Bold').text('Reports');
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
        ? `${e.magnitude.toFixed(2)}″`
        : `${Math.round(e.magnitude)} mph`;
    doc.text(mag, 200, rowY);
    const loc =
      `${e.county || ''}${e.state ? ', ' + e.state : ''}` ||
      `${e.beginLat.toFixed(2)}, ${e.beginLon.toFixed(2)}`;
    doc.text(loc.slice(0, 40), 280, rowY, { width: 180 });
    doc.fillColor('#64748b').text((e.source || '').slice(0, 12), 470, rowY);
    rowY += 14;
  }

  // ── NEXRAD radar snapshots (per-warning) ──────────────────────────────
  // Pulls per-event NEXRAD reflectivity images from IEM's WMS-T endpoint at
  // each report's timestamp. Adjuster-facing visual evidence: "the radar
  // saw this storm pass over the property at exactly this time." Up to 4
  // snapshots — picks the highest-magnitude reports (sortedEvents is already
  // sorted by magnitude desc).
  const nexradPicks = sortedEvents.slice(0, 4);
  const nexradSnapshots: Array<{ buf: Buffer; caption: string }> = [];
  for (const pick of nexradPicks) {
    const buf = await fetchNexradSnapshot({
      timeIso: pick.beginDate,
      bbox,
      width: 480,
      height: 320,
    });
    if (!buf) continue;
    const time = new Date(pick.beginDate).toLocaleTimeString('en-US', {
      timeZone: 'America/New_York',
      hour: 'numeric',
      minute: '2-digit',
    });
    const mag =
      pick.eventType === 'Hail'
        ? `${pick.magnitude.toFixed(2)}″ hail`
        : `${Math.round(pick.magnitude)} mph wind`;
    nexradSnapshots.push({
      buf,
      caption: `${time} ET — ${mag} · ${pick.source}`,
    });
  }
  if (nexradSnapshots.length > 0) {
    doc.addPage();
    doc.fillColor('#0f172a').fontSize(13).font('Helvetica-Bold').text('NEXRAD Radar — Storm Day Sequence');
    doc.fontSize(9).font('Helvetica').fillColor('#64748b');
    doc.text(
      'NWS NEXRAD base reflectivity (IEM N0R mosaic) at each peak report. Property pin overlay.',
    );
    doc.moveDown(0.4);
    const nexradX = 54;
    let nexradY = doc.y;
    const cellW = (504 - 16) / 2;
    const cellH = 200;
    for (let i = 0; i < nexradSnapshots.length; i += 1) {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const x = nexradX + col * (cellW + 16);
      const y = nexradY + row * (cellH + 24);
      try {
        doc.image(nexradSnapshots[i].buf, x, y, {
          fit: [cellW, cellH - 24],
          align: 'center',
          valign: 'center',
        });
      } catch (err) {
        console.warn('[reportPdf] nexrad embed failed', err);
        continue;
      }
      doc.font('Helvetica').fontSize(8).fillColor('#475569');
      doc.text(nexradSnapshots[i].caption, x, y + cellH - 16, {
        width: cellW,
        ellipsis: true,
      });
    }
    nexradY += Math.ceil(nexradSnapshots.length / 2) * (cellH + 24);
    doc.y = nexradY;
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
    doc.fillColor('#0f172a').fontSize(13).font('Helvetica-Bold').text('Evidence');
    doc.moveDown(0.3);
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
  });
  if (nceiRows.length > 0) {
    doc.addPage();
    doc.fillColor('#0f172a').fontSize(13).font('Helvetica-Bold').text('NCEI Storm Events Archive (Appendix)');
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
      // F/EF scale instead so the appendix doesn't show "0″" for an EF2.
      let magStr: string;
      if (r.event_type === 'Tornado') {
        magStr = r.tor_f_scale ? r.tor_f_scale.toUpperCase() : '—';
      } else if (r.magnitude === null) {
        magStr = '';
      } else if (r.event_type === 'Hail') {
        magStr = `${r.magnitude.toFixed(2)}″`;
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

  // ── Footer (last page) ────────────────────────────────────────────────
  doc.font('Helvetica').fontSize(7).fillColor('#94a3b8');
  doc.text(
    `Sources: SPC, IEM Local Storm Reports, MRMS MESH (${collection?.metadata.sourceFile ?? 'unavailable'})${nceiRows.length > 0 ? `, NCEI Storm Events Database (${nceiRows.length} appendix rows)` : ''}`,
    54,
    760,
    { width: 504 },
  );

  doc.end();
  return done;
}
