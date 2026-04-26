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
import type { BoundingBox } from './types.js';

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

  // ── Vector swath map ──────────────────────────────────────────────────
  doc.fillColor('#0f172a').fontSize(13).font('Helvetica-Bold').text('Hail Footprint');
  doc.moveDown(0.3);
  const mapX = 54;
  const mapY = doc.y;
  const mapW = 504;
  const mapH = 280;
  doc.roundedRect(mapX, mapY, mapW, mapH, 5).fill('#0b1220');

  // Project lat/lng into the map rectangle. Equirectangular is fine at the
  // small bbox sizes we use — VA/MD/PA storms are <300 mi across.
  const project = (lng: number, lat: number): [number, number] => {
    const tx = (lng - bounds.west) / Math.max(1e-6, bounds.east - bounds.west);
    const ty = 1 - (lat - bounds.south) / Math.max(1e-6, bounds.north - bounds.south);
    return [mapX + tx * mapW, mapY + ty * mapH];
  };

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
  doc.fillColor('#0f172a').fontSize(13).font('Helvetica-Bold').text('Top Reports');
  doc.moveDown(0.3);
  const headerY = doc.y;
  doc.font('Helvetica-Bold').fontSize(8).fillColor('#475569');
  doc.text('Time (ET)', 54, headerY);
  doc.text('Type', 130, headerY);
  doc.text('Magnitude', 200, headerY);
  doc.text('Location', 280, headerY);
  doc.text('Source', 470, headerY);
  doc.strokeColor('#e2e8f0').lineWidth(0.5).moveTo(54, headerY + 12).lineTo(558, headerY + 12).stroke();
  let rowY = headerY + 16;
  const sortedEvents = [...datedEvents]
    .sort((a, b) => b.magnitude - a.magnitude || Date.parse(b.beginDate) - Date.parse(a.beginDate))
    .slice(0, 20);
  for (const e of sortedEvents) {
    if (rowY > 720) break;
    const time = new Date(e.beginDate).toLocaleTimeString('en-US', {
      timeZone: 'America/New_York',
      hour: 'numeric',
      minute: '2-digit',
    });
    doc.font('Helvetica').fontSize(8).fillColor('#0f172a');
    doc.text(time, 54, rowY);
    doc.text(e.eventType === 'Hail' ? 'Hail' : 'Wind', 130, rowY);
    const mag = e.eventType === 'Hail'
      ? `${e.magnitude.toFixed(2)}″`
      : `${Math.round(e.magnitude)} mph`;
    doc.text(mag, 200, rowY);
    const loc = `${e.county || ''}${e.state ? ', ' + e.state : ''}` || `${e.beginLat.toFixed(2)}, ${e.beginLon.toFixed(2)}`;
    doc.text(loc.slice(0, 40), 280, rowY, { width: 180 });
    doc.fillColor('#64748b').text((e.source || '').slice(0, 12), 470, rowY);
    rowY += 14;
  }

  // ── Footer ────────────────────────────────────────────────────────────
  doc.font('Helvetica').fontSize(7).fillColor('#94a3b8');
  doc.text(
    `Sources: SPC, IEM Local Storm Reports, MRMS MESH (${collection?.metadata.sourceFile ?? 'unavailable'})`,
    54,
    760,
    { width: 504 },
  );

  doc.end();
  return done;
}
