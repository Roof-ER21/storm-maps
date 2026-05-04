/**
 * Adjuster-grade Storm Impact Analysis PDF.
 *
 * Layout matches the 6-page Storm Report reference:
 *   Page 1  — Cover: title, report#, verification, summary boxes,
 *             Data Sources & Methodology block, property location map.
 *   Page 2  — Storm Impact Summary, Narrative, Documented Hail/Wind tables,
 *             intro to NWS Warnings section.
 *   Page 3+ — One block per active NWS warning (radar-equiv image + details).
 *   Last 2  — Historical Storm Activity table (multi-year), Disclaimer, footer.
 *
 * Generated server-side with PDFKit. Total render time target: ≤ 4s
 * (including 2-3 Static Maps fetches in parallel).
 */
import PDFDocument from "pdfkit";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { resolve as pathResolve, dirname } from "node:path";
import { existsSync } from "node:fs";
import type { Sql } from "../db.js";
import { computeImpact, type ImpactHit } from "./impact.js";
import { fetchPropertyMap, fetchAreaMap } from "./static-map.js";
import { fetchNwsWarningsForDateAndPoint, type NwsWarning } from "./nws-vtec.js";
import { fetchNexradSnapshot, radarCitationLabel, type NexradFetchResult } from "./nexrad-image.js";
import { scoreEvent } from "./consilience.js";
import { formatEtDate, formatEtTime, formatEtDateTime } from "./et-format.js";
import { makeLimiter } from "./concurrency.js";

// ─── Brand palette (Hail Yes parity) ─────────────────────────────────────────
const RED = "#C8102E";          // Roof Docs brand red
const TEXT = "#1A1A1A";
const MUTED = "#666666";
const FAINT = "#8C8C8C";
const BORDER = "#BFBFBF";
const STRIP_BG = "#E8E8E8";
const BANNER_BG = "#D9D9D9";
const BANNER_TEXT = "#4A4A4A";
const ROW_STRIPE = "#F7F7F7";
const NAVY = "#1f3a68";          // retained for tier-section accent only
const NAVY_DARK = "#152849";     // retained for footer
const BG_LIGHT = "#f6f8fb";

// Hail Yes! brand
const HY_ORANGE = "#f97316";
const HY_ORANGE_DARK = "#c2410c";
const HY_PURPLE = "#7c3aed";
const HY_PURPLE_DARK = "#5b21b6";

// ─── Logo asset paths (resolved at module load) ──────────────────────────────
function resolveAsset(name: string): string | null {
  // sa-port keeps assets co-located at ./assets/<name>. Legacy SA paths
  // remain as fallbacks so this exact module also runs unchanged in
  // storm-archive's deploy.
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    pathResolve(here, "assets", name),                                 // hailyes: server/sa-port/assets
    pathResolve(here, "../../assets", name),                           // SA: dist/services → assets
    pathResolve(here, "../../../assets", name),                        // SA: src/services → assets
    pathResolve(process.cwd(), "apps/api/assets", name),
    pathResolve(process.cwd(), "server/sa-port/assets", name),         // hailyes prod: cwd=/app
    pathResolve(process.cwd(), "assets", name),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}
const LOGO_PATH = resolveAsset("roofer-logo.png");
const SEAL_PATH = resolveAsset("hail-yes-seal.png");

// ─── Public types ────────────────────────────────────────────────────────────
export interface PdfBuildInput {
  eventId: number;
  lat: number;
  lng: number;
  address: string | null;
  normalized?: string | null;
  propertyName?: string | null;
}

interface RenderContext {
  hit: ImpactHit;
  allHits: ImpactHit[];
  address: string;
  propertyName: string | null;
  lat: number;
  lng: number;
  reportId: string;
  verificationCode: string;
  generatedAt: Date;
  propertyMap: Buffer | null;
  areaMap: Buffer | null;
  warnings: NwsWarning[];
  warningRadarImages: Map<string, NexradFetchResult | null>;
  /** Default storm-radar frames at ~3 PM and ~5 PM ET on the event date.
   *  Rendered in the "Storm Radar Imagery" section even when no warnings.
   *  basemap is a Google Static Map covering the same bbox as the NEXRAD
   *  PNG; we draw it under the transparent radar so reps see roads,
   *  state outlines, and county lines underneath the reflectivity. */
  defaultRadar: {
    early: NexradFetchResult | null;
    late: NexradFetchResult | null;
    basemap: Buffer | null;
  };
  consilienceConfirmedCount: number;
  consilienceTotalSources: number;
  consilienceTier: string;
  groundReports: ImpactHit["ground_reports_nearby"];
}

export interface BuiltPdf {
  buffer: Buffer;
  reportId: string;
  verificationCode: string;
  /** event_date and state of the matched hit, for the persisted row. */
  eventDate: string;
  state: string;
}

// ─── Public entry point ──────────────────────────────────────────────────────
export async function buildAdjusterPdf(
  sql: Sql,
  input: PdfBuildInput,
): Promise<BuiltPdf> {
  const startedAt = Date.now();
  const impact = await computeImpact(sql, input.lat, input.lng, startedAt, {
    address: input.address,
    lat: input.lat,
    lng: input.lng,
    normalized: input.normalized ?? `${input.lat.toFixed(4)},${input.lng.toFixed(4)}`,
    geocode_provider: null,
  });

  const hit = impact.hits.find((h) =>
    h.event_id === input.eventId ||
    (h.event_ids ?? []).includes(input.eventId),
  );
  if (!hit) {
    throw new Error(`event ${input.eventId} did not match any hit at this property location`);
  }

  const reportId = `${Date.now()}-${Math.floor(Math.random() * 9_000_000) + 1_000_000}`;
  const verificationCode = createHash("sha1")
    .update(`${reportId}|${hit.event_id}|${input.lat.toFixed(5)}|${input.lng.toFixed(5)}`)
    .digest("hex").slice(0, 6);

  // Cap concurrent outbound fetches at 3 across the whole render. A single
  // PDF can otherwise have 4 top-of-render fetches + up to 6 NEXRAD
  // requests in flight = 10 PNG buffers (~700KB each) sitting in memory at
  // once. On a small Railway container under burst load that's a real
  // pressure point. PDFs render ~300ms slower under load but allocate ~1/3
  // the peak.
  const limit = makeLimiter(3);

  const eventIds = hit.event_ids ?? [hit.event_id];
  const [propertyMap, areaMap, warnings, consilience] = await Promise.all([
    limit(() => fetchPropertyMap({
      lat: input.lat, lng: input.lng, zoom: 15, width: 320, height: 240,
    })),
    limit(() => fetchSwathOverlayMap(sql, eventIds, input.lat, input.lng)),
    limit(() => fetchNwsWarningsForDateAndPoint({
      date: hit.event_date, lat: input.lat, lng: input.lng,
    })),
    limit(() => scoreEvent(sql, hit.event_id, {
      lat: input.lat, lng: input.lng, radiusMiles: 15,
    })),
  ]);

  // Fetch NEXRAD reflectivity PNGs. Two paths:
  //   1. One image per active NWS warning at its issuance time
  //   2. ALWAYS fetch a default storm-radar image at 19:00 UTC + 21:00 UTC
  //      on the event date — these get shown in a dedicated "Storm Radar
  //      Imagery" section even when no warnings fired (which is most
  //      property/storm pairs since SBW polygons rarely cover any single
  //      lot exactly).
  const radarEntries = await Promise.all(
    warnings.slice(0, 6).map((w) =>
      limit(async () => {
        const time = w.issued_at || `${hit.event_date}T20:00:00Z`;
        const snap = await fetchNexradSnapshot({
          timeIso: time, lat: input.lat, lng: input.lng, radiusMiles: 30,
          width: 600, height: 400,
        }).catch(() => null);
        return [w.id, snap] as const;
      }),
    ),
  );
  const warningRadarImages = new Map<string, NexradFetchResult | null>(radarEntries);

  // Default radar frames + matching Google Static Map basemap.
  // Basemap covers the same ~30 mi bbox as the NEXRAD frames so we can
  // draw it underneath and the radar reads against state outlines, county
  // lines, and major roads instead of solid white.
  const [stormRadarPm, stormRadarLate, radarBasemap] = await Promise.all([
    limit(() => fetchNexradSnapshot({
      timeIso: `${hit.event_date}T19:00:00Z`,  // 3 PM ET
      lat: input.lat, lng: input.lng, radiusMiles: 30,
      width: 600, height: 400,
    }).catch(() => null)),
    limit(() => fetchNexradSnapshot({
      timeIso: `${hit.event_date}T21:00:00Z`,  // 5 PM ET
      lat: input.lat, lng: input.lng, radiusMiles: 30,
      width: 600, height: 400,
    }).catch(() => null)),
    limit(() => fetchAreaMap({
      lat: input.lat, lng: input.lng,
      zoom: 9,         // ~57mi viewport — close to the 60mi NEXRAD bbox
      width: 600, height: 400,
    }).catch(() => null)),
  ]);
  // Mark areaMap as referenced (used elsewhere if we add a wide-map section)
  void areaMap;

  const ctx: RenderContext = {
    hit,
    allHits: impact.hits,
    address: input.address ?? `${input.lat.toFixed(4)}, ${input.lng.toFixed(4)}`,
    propertyName: input.propertyName ?? null,
    lat: input.lat,
    lng: input.lng,
    reportId,
    verificationCode,
    generatedAt: new Date(),
    propertyMap,
    areaMap,
    warnings,
    warningRadarImages,
    defaultRadar: {
      early: stormRadarPm, late: stormRadarLate, basemap: radarBasemap,
    },
    consilienceConfirmedCount: consilience?.confirmed_count ?? 0,
    consilienceTotalSources: consilience?.total_sources ?? 12,
    consilienceTier: consilience?.tier ?? "low",
    groundReports: hit.ground_reports_nearby,
  };

  const buffer = await renderPdf(ctx);
  return {
    buffer,
    reportId,
    verificationCode,
    eventDate: hit.event_date,
    state: hit.state,
  };
}

// ─── Helper: fetch swath overlay map for the event ──────────────────────────
async function fetchSwathOverlayMap(
  sql: Sql,
  eventIds: number[],
  lat: number,
  lng: number,
): Promise<Buffer | null> {
  const swaths = await sql<Array<{ geojson: { features: Array<{
    properties: { sizeInches?: number; level?: number };
    geometry: { type: string; coordinates: number[][][][] };
  }> } }>>`
    SELECT geojson
    FROM swaths
    WHERE event_id = ANY(${eventIds}::int[])
      AND kind = 'mrms_hail'
      AND feature_count > 0
    LIMIT 3
  `;

  const overlayCoords: number[][][][] = [];
  let overlayColor = "#FF8800";
  for (const s of swaths) {
    const features = s.geojson?.features ?? [];
    const sorted = [...features].sort(
      (a, b) => (b.properties.level ?? 0) - (a.properties.level ?? 0),
    );
    for (const f of sorted) {
      if ((f.properties.sizeInches ?? 0) < 0.5) continue;
      overlayCoords.push(...(f.geometry.coordinates as number[][][][]));
      if (f.properties.sizeInches != null && f.properties.sizeInches >= 1.0) {
        overlayColor = "#DC2626";
      }
      break;
    }
    if (overlayCoords.length > 0) break;
  }

  return await fetchAreaMap({
    lat, lng,
    swathPolygon: overlayCoords.length > 0 ? overlayCoords : null,
    swathColor: overlayColor,
    zoom: 9,
    width: 480,
    height: 320,
  });
}

// ─── Renderer ────────────────────────────────────────────────────────────────
function renderPdf(ctx: RenderContext): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "LETTER",
      margins: { top: 50, bottom: 50, left: 54, right: 54 },
      info: {
        Title: `Hail Impact Report — ${ctx.address}`,
        Author: "Hail Yes Storm Intelligence",
        Subject: `Hail impact for ${ctx.hit.event_date}`,
        Creator: "Hail Yes Storm Intelligence",
        Producer: "Hail Yes Storm Intelligence (HYSI)",
      },
    });
    const chunks: Buffer[] = [];
    doc.on("data", (c) => chunks.push(c as Buffer));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    drawCoverPage(doc, ctx);
    doc.addPage();
    drawSummaryPage(doc, ctx);
    // Always show NEXRAD radar imagery — most properties don't fall inside
    // an SBW polygon, so the warnings section is often empty. The default
    // 3 PM / 5 PM ET frames give every report at least one radar view.
    if (ctx.defaultRadar.early || ctx.defaultRadar.late) {
      drawDefaultRadarSection(doc, ctx);
    }
    if (ctx.warnings.length > 0) {
      drawWarningsPages(doc, ctx);
    }
    drawHistoricalActivity(doc, ctx);
    drawDisclaimerAndFooter(doc, ctx);

    doc.end();
  });
}

// ─── Page 1: Cover (Hail Yes-style header) ──────────────────────────────────
function drawCoverPage(doc: PDFKit.PDFDocument, ctx: RenderContext): void {
  drawHailYesHeader(doc, ctx);
  // Hero band — Hail Yes! orange→purple gradient with property + storm date
  // big and centered. First thing an adjuster sees after the report ID strip.
  let y = 142;
  drawHeroBand(doc, ctx, y);
  y += 100;

  drawSectionBanner(doc, "Property Information", y);
  y += 30;
  drawPropertyBlock(doc, ctx, y);
  y += 130;

  // Photo strip — HailTrace meteorologist-flagged hail photos near the
  // property. Only renders when we have photos for the storm.
  const photoStripHeight = drawHailtracePhotoStrip(doc, ctx, y);
  if (photoStripHeight > 0) y += photoStripHeight + 10;

  drawSectionBanner(doc, "Data Sources & Methodology", y);
  y += 30;
  drawMethodologyBlock(doc, y);
}

/** Orange-to-purple gradient hero band: address (large bold) + storm date
 *  (medium) + tier pill. The most adjuster-readable element on the report. */
function drawHeroBand(doc: PDFKit.PDFDocument, ctx: RenderContext, y: number): void {
  const PW = doc.page.width;
  const M = 50;
  const W = PW - 2 * M;
  const H = 90;

  // Linear gradient orange → purple (matching favicon + brand)
  const grad = doc.linearGradient(M, y, M + W, y + H);
  grad.stop(0, HY_ORANGE).stop(1, HY_PURPLE);
  doc.roundedRect(M, y, W, H, 8).fill(grad);

  // Address — line 1 of hero. Fixed Y positions on the band mean a long
  // address that wraps to two lines collides with the subline below.
  // Step the font size down (18 → 16 → 14 → 12) until it fits in one
  // line; if even 12pt overflows, hard-truncate with ellipsis so we
  // never paint over the storm-date row.
  const addrLine = ctx.address || `${ctx.lat.toFixed(4)}, ${ctx.lng.toFixed(4)}`;
  doc.fillColor("#fff").font("Helvetica-Bold");
  const maxAddrW = W - 36;
  let addrSize = 18;
  for (const sz of [18, 16, 14, 12]) {
    doc.fontSize(sz);
    if (doc.widthOfString(addrLine) <= maxAddrW) { addrSize = sz; break; }
    addrSize = sz;
  }
  doc.fontSize(addrSize);
  doc.text(addrLine, M + 18, y + 14, {
    width: maxAddrW, align: "left", lineBreak: false, ellipsis: true, height: 24,
  });

  // Storm date + tier pill — line 2
  doc.fillColor("#ffedd5").font("Helvetica").fontSize(11);
  doc.text(
    `STORM IMPACT REPORT  ·  ${formatIsoDateLong(ctx.hit.event_date)}  ·  ${ctx.hit.state}`,
    M + 18, y + 42, { width: W - 36, align: "left", lineBreak: false },
  );

  // Headline metric — strict at-property only. The state peak goes
  // somewhere else in the PDF (history table); putting it here labeled
  // "at property" is a contradiction the user caught: hero said 3.25"
  // while the per-row history said 0.5". Hero now reads the same
  // calibrated/band reading every other section uses.
  const atProperty =
    ctx.hit.hail_calibrated_at_location ??
    ctx.hit.hail_bands.atLocation ??
    ctx.hit.hail_bands.within1mi ??
    null;
  const peakInState = ctx.hit.peak_hail_inches ?? 0;
  // Wind has the same scope trap as hail used to: peak_wind_mph is the
  // statewide max LSR, but the property may have a smaller atLocation
  // band reading. Surface the localized value when present, otherwise
  // label the state peak honestly with its scope.
  const windAtProperty =
    (ctx.hit.wind_bands?.atLocation ?? null) ??
    (ctx.hit.wind_bands?.within1mi ?? null);
  const peakWindInState = ctx.hit.peak_wind_mph ?? 0;
  doc.fillColor("#fff").font("Helvetica-Bold").fontSize(13);
  const parts: string[] = [];
  if (atProperty != null && atProperty >= 0.25) {
    parts.push(`${atProperty.toFixed(2)}" hail at property`);
  } else if (peakInState >= 0.25) {
    // No localized hail reading — surface state peak honestly with its label.
    parts.push(`${peakInState.toFixed(2)}" peak in ${ctx.hit.state}`);
  }
  if (windAtProperty != null && windAtProperty >= 50) {
    parts.push(`${Math.round(windAtProperty)} mph wind at property`);
  } else if (peakWindInState >= 50) {
    parts.push(`${Math.round(peakWindInState)} mph peak wind in ${ctx.hit.state}`);
  }
  const tierLabel = ctx.hit.impact_tier === "direct_hit" ? "DIRECT HIT"
    : ctx.hit.impact_tier === "near_miss" ? "NEAR MISS" : "AREA IMPACT";
  doc.text(
    `${tierLabel}${parts.length ? "  ·  " + parts.join("  ·  ") : ""}`,
    M + 18, y + 62, { width: W - 36, align: "left", lineBreak: false },
  );
}

/** Render up to 4 HailTrace meteorologist photos as a horizontal strip with
 *  street-corner captions. Returns the strip height (0 if no photos). */
function drawHailtracePhotoStrip(doc: PDFKit.PDFDocument, ctx: RenderContext, y: number): number {
  const photos = (ctx.groundReports ?? [])
    .filter((g) => g.source === "hailtrace_meteo" && (g as { photo_url?: string | null }).photo_url)
    .slice(0, 4) as Array<{ photo_url?: string; photo_text?: string | null; distance_miles: number }>;
  if (photos.length === 0) return 0;

  const PW = doc.page.width;
  const M = 50;
  const W = PW - 2 * M;
  const photoW = (W - (photos.length - 1) * 8) / photos.length;
  const photoH = 80;

  // Section label
  doc.fillColor(MUTED).font("Helvetica-Bold").fontSize(8);
  doc.text("METEOROLOGIST-FLAGGED HAIL PHOTOS NEAR PROPERTY", M, y, {
    width: W, characterSpacing: 0.6, lineBreak: false,
  });
  y += 14;

  // We'd embed JPGs from the hailtrace_photos table here, but the PDF
  // pipeline doesn't have a synchronous bytes fetch for them yet — fall
  // back to placeholder boxes that link out to the local URL. Future
  // pass: prefetch buffers in PdfBuildInput so doc.image can embed.
  for (let i = 0; i < photos.length; i++) {
    const p = photos[i]!;
    const x = M + i * (photoW + 8);
    doc.roundedRect(x, y, photoW, photoH, 4).fill("#f3f4f6").stroke(HY_ORANGE);
    doc.fillColor(MUTED).font("Helvetica").fontSize(7);
    doc.text("📷 photo", x + 4, y + photoH / 2 - 4, { width: photoW - 8, align: "center", lineBreak: false });
    if (p.photo_text) {
      doc.fillColor(TEXT).font("Helvetica-Bold").fontSize(7);
      doc.text(p.photo_text.slice(0, 32), x + 4, y + photoH + 2, {
        width: photoW - 8, lineBreak: false, ellipsis: true,
      });
    }
    doc.fillColor(MUTED).font("Helvetica").fontSize(6.5);
    doc.text(`${p.distance_miles.toFixed(2)} mi from property`, x + 4, y + photoH + 12, {
      width: photoW - 8, lineBreak: false, ellipsis: true,
    });
  }
  return photoH + 22;
}

function formatIsoDateLong(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  const months = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const year = parseInt(m[1]!, 10);
  const month = parseInt(m[2]!, 10) - 1;
  const day = parseInt(m[3]!, 10);
  return `${months[month]} ${day}, ${year}`;
}

/**
 * Three-band header matching the Hail Yes adjuster PDF reference:
 *   • Top thin gray strip: "Storm Impact Report #: <id>"
 *   • Three columns: Roof Docs logo | Rep contact | Report meta | Hail Yes seal
 *   • Bottom verification strip with red+bold+underlined code
 */
function drawHailYesHeader(doc: PDFKit.PDFDocument, ctx: RenderContext): void {
  const PW = doc.page.width;

  // 1. Top strip
  doc.rect(0, 0, PW, 22).fill(STRIP_BG);
  doc.fillColor(MUTED).font("Helvetica").fontSize(9.5);
  doc.text(`Hail Impact Report #: ${ctx.reportId}`, 0, 6, { width: PW, align: "center" });

  // 2. Three-column row (y = 35..95)
  // Roof Docs (left) — they're the contractor delivering this to the
  // adjuster; Hail Yes! Storm Intelligence is the data brand (right
  // seal + hero band). Both marks present so the partnership is clear:
  // "Hail Yes! intel, prepared by Roof Docs for [carrier]."
  if (LOGO_PATH) {
    try {
      doc.image(LOGO_PATH, 50, 35, { fit: [140, 60], align: "center", valign: "center" });
    } catch (_) { drawLogoFallback(doc); }
  } else {
    drawLogoFallback(doc);
  }

  // Rep contact column
  doc.fillColor(TEXT).font("Helvetica-Bold").fontSize(9);
  doc.text("Ahmed Mahmoud", 220, 47, { width: 100, lineBreak: false });
  doc.fillColor(TEXT).font("Helvetica").fontSize(8.5);
  doc.text("(703) 239-3738", 220, 57, { width: 100, lineBreak: false });
  doc.fillColor(RED).font("Helvetica").fontSize(8.5);
  doc.text("ahmed.mahmoud@theroofdocs.com", 220, 67, {
    width: 130, lineBreak: false, underline: true,
    link: "mailto:ahmed.mahmoud@theroofdocs.com",
  });

  // Report meta column
  doc.fillColor(TEXT).font("Helvetica-Bold").fontSize(11);
  doc.text("Hail Impact Report", 360, 42, { width: 150, lineBreak: false });
  doc.fillColor(TEXT).font("Helvetica").fontSize(8.5);
  doc.text(`Report #: ${ctx.reportId}`, 360, 55, { width: 150, lineBreak: false });
  doc.text(`Date: ${formatDateTime(ctx.generatedAt)}`, 360, 65, { width: 150, lineBreak: false });
  doc.text("Hail Yes Storm Intelligence", 360, 75, { width: 150, lineBreak: false });

  // Right seal/badge
  if (SEAL_PATH) {
    try {
      doc.image(SEAL_PATH, 510, 38, { fit: [52, 52], align: "center", valign: "center" });
    } catch (_) { drawSealFallback(doc); }
  } else {
    drawSealFallback(doc);
  }

  // 3. Verification strip (full-bleed gray) — two lines so adjusters
  //    have an actionable URL, not just numbers.
  const verifyUrl = process.env.PUBLIC_BASE_URL ?? "https://storm-archive-web-production.up.railway.app";
  doc.rect(0, 102, PW, 30).fill(STRIP_BG);

  // Line 1: "You can verify… Verification Code: <code>"
  const prefix = `Verify this report at ${verifyUrl}/verify  ·  Report #: ${ctx.reportId}  ·  Code: `;
  doc.fillColor(TEXT).font("Helvetica").fontSize(8.5);
  const prefixW = doc.widthOfString(prefix);
  doc.font("Helvetica-Bold");
  const codeW = doc.widthOfString(ctx.verificationCode);
  const totalW = prefixW + codeW;
  const startX = Math.max(50, (PW - totalW) / 2);
  doc.fillColor(TEXT).font("Helvetica").fontSize(8.5);
  doc.text(prefix, startX, 107, { lineBreak: false, width: prefixW + 1 });
  doc.fillColor(RED).font("Helvetica-Bold").fontSize(8.5);
  doc.text(ctx.verificationCode, startX + prefixW, 107, {
    lineBreak: false, width: codeW + 4, underline: true,
  });

  // Line 2: "Adjusters: paste the Report# and Code into the verify page
  //          to confirm we issued this exact report for this property."
  doc.fillColor(MUTED).font("Helvetica").fontSize(7.5);
  doc.text(
    "Adjusters: paste the Report # and Code into the verify page above to confirm Hail Yes Storm Intelligence issued this exact report.",
    0, 119, { width: PW, align: "center", lineBreak: false },
  );
}

function drawLogoFallback(doc: PDFKit.PDFDocument): void {
  doc.fillColor(RED).font("Helvetica-Bold").fontSize(22);
  doc.text("ROOFER", 50, 49, { width: 140, align: "left" });
  doc.fillColor(RED).font("Helvetica-Bold").fontSize(8);
  doc.text("THE ROOF DOCS", 50, 79, { width: 140, align: "left", characterSpacing: 1 });
}

function drawSealFallback(doc: PDFKit.PDFDocument): void {
  // HY orange→purple gradient seal — matches in-app + favicon brand
  const grad = doc.linearGradient(510, 38, 562, 90);
  grad.stop(0, HY_ORANGE).stop(1, HY_PURPLE);
  doc.roundedRect(510, 38, 52, 52, 6).fill(grad);
  doc.fillColor("#fff").font("Helvetica-Bold").fontSize(22);
  doc.text("HY", 510, 51, { width: 52, align: "center", lineBreak: false });
}

/** Banner heading bar matching Hail Yes — gray fill, centered, NOT bold. */
function drawSectionBanner(doc: PDFKit.PDFDocument, title: string, y: number): void {
  const M = 50;
  doc.rect(M, y, doc.page.width - 2 * M, 22).fill(BANNER_BG);
  doc.fillColor(BANNER_TEXT).font("Helvetica").fontSize(13);
  doc.text(title, M, y + 5, { width: doc.page.width - 2 * M, align: "center" });
}

// drawSummaryBoxes + drawBox were never called — dead code with stale
// labels that would mislead future edits. Removed during 2026-05-03
// audit. Active fact box is drawTwoColumnFacts below.

function drawMethodologyBlock(doc: PDFKit.PDFDocument, yStart: number): void {
  const left = 54, right = doc.page.width - 54;
  doc.font("Helvetica").fontSize(9).fillColor(TEXT);
  doc.text(
    "This report aggregates storm event records from multiple independent federal and " +
    "scientific-network data sources. No commercial or proprietary data is used. All sources " +
    "are publicly accessible and independently verifiable.",
    left, yStart, { width: right - left },
  );

  const sources = [
    { name: "NOAA NCEI Storm Events Database",
      desc: "Official severe-weather event record maintained by the National Oceanic and Atmospheric Administration, National Centers for Environmental Information. Events reviewed by National Weather Service meteorologists. (ncei.noaa.gov)" },
    { name: "NCEI Severe Weather Data Inventory (SWDI) — NX3HAIL",
      desc: "NEXRAD-derived hail signatures produced by the NOAA/NSSL Hail Detection Algorithm, archived by NCEI. Each record is an independent radar observation with timestamp, maximum expected hail size, and reporting WSR-88D radar site." },
    { name: "MRMS — Multi-Radar Multi-Sensor (NSSL)",
      desc: "NOAA National Severe Storms Lab gridded hail product (MESH_Max_1440min). Independent radar data pipeline; archived by Iowa Environmental Mesonet." },
    { name: "NWS Local Storm Reports via Iowa Environmental Mesonet",
      desc: "Real-time ground-observer reports filed with NWS Forecast Offices and archived by IEM at Iowa State University. Fills the 45-day review cycle before NCEI Storm Events is finalized." },
    { name: "NWS VTEC Watches & Warnings Archive (via IEM)",
      desc: "Severe Thunderstorm, Tornado, and Flash Flood warnings issued by NWS WFOs. Polygon geometry confirms whether the property was inside an official severe-weather warning area." },
    { name: "Synoptic Data API (MADIS)",
      desc: "Surface-station ground-truth network (CWOP, METAR, ASOS, mesonet) aggregated through NOAA's Meteorological Assimilation Data Ingest System. Free public token; same data Wunderground licenses commercially." },
  ];
  let y = yStart + 38;
  for (const s of sources) {
    doc.font("Helvetica-Bold").fontSize(9).fillColor(NAVY);
    doc.text(`• ${s.name}`, left, y);
    doc.font("Helvetica").fontSize(8.5).fillColor(MUTED);
    doc.text(s.desc, left + 14, y + 12, { width: right - left - 14 });
    y = doc.y + 4;
  }
}

function drawPropertyBlock(doc: PDFKit.PDFDocument, ctx: RenderContext, yStart: number): void {
  const left = 54;
  if (ctx.propertyMap) {
    try {
      doc.image(ctx.propertyMap, left, yStart, { width: 200, height: 140 });
    } catch (_) { /* corrupt — skip */ }
  } else {
    doc.roundedRect(left, yStart, 200, 140, 4).fill(BG_LIGHT);
    doc.font("Helvetica").fontSize(9).fillColor(MUTED);
    doc.text("(map unavailable)", left, yStart + 65, { width: 200, align: "center" });
  }

  doc.fillColor(TEXT).font("Helvetica-Bold").fontSize(10);
  doc.text("Property Address:", 270, yStart);
  doc.font("Helvetica").fontSize(10);
  doc.text(ctx.address, 270, yStart + 14, { width: doc.page.width - 270 - 54 });
  if (ctx.propertyName) {
    doc.fillColor(MUTED).fontSize(9);
    doc.text(`(${ctx.propertyName})`, 270, doc.y + 2);
  }
  doc.fillColor(MUTED).font("Helvetica").fontSize(8);
  doc.text(`Coordinates: ${ctx.lat.toFixed(5)}, ${ctx.lng.toFixed(5)}`, 270, doc.y + 8);
}

// ─── Page 2: Storm Summary + Narrative + Hail/Wind tables ────────────────────
function drawFederalCitations(doc: PDFKit.PDFDocument, ctx: RenderContext, yStart: number): number {
  const fc = ctx.hit.federal_citations;
  let y = yStart;
  const W = doc.page.width - 108;
  // Verification URLs — every citation is clickable in the PDF and
  // Google-discoverable from the printed text. NCEI exposes per-event
  // detail pages keyed on event_id; FEMA exposes per-disaster pages
  // keyed on disaster_number; PCS goes to a Verisk press search since
  // their cat# database is carrier-only.
  const nceiEventUrl = (eid: string | number) =>
    `https://www.ncdc.noaa.gov/stormevents/eventdetails.jsp?id=${eid}`;
  const femaUrl = (dn: number) => `https://www.fema.gov/disaster/${dn}`;
  const pcsUrl = (cat: string) =>
    `https://www.google.com/search?q=%22PCS+catastrophe+${encodeURIComponent(cat)}%22+verisk`;

  // PCS catastrophes — the carrier-system key
  for (const p of fc.pcs) {
    if (y > doc.page.height - 200) doc.addPage();
    doc.rect(54, y, W, 22).fillAndStroke("#f3f4f6", "#1f2937");
    doc.fillColor("#1f2937").font("Helvetica-Bold").fontSize(8.5);
    doc.text("PCS CATASTROPHE", 60, y + 6, { width: 110, lineBreak: false });
    doc.font("Helvetica-Bold").fontSize(11).fillColor("#0e7490");
    doc.text(`#${p.cat_number}`, 175, y + 5, {
      width: 60, lineBreak: false, link: pcsUrl(p.cat_number), underline: true,
    });
    doc.font("Helvetica").fontSize(9).fillColor(TEXT);
    doc.text(p.description, 240, y + 7, { width: W - 200, lineBreak: false });
    y += 26;
  }

  // FEMA disaster declarations
  for (const f of fc.fema) {
    if (y > doc.page.height - 200) doc.addPage();
    doc.rect(54, y, W, 22).fillAndStroke("#fff1f2", "#be123c");
    doc.fillColor("#be123c").font("Helvetica-Bold").fontSize(8.5);
    doc.text("FEMA DISASTER", 60, y + 6, { width: 110, lineBreak: false });
    doc.font("Helvetica-Bold").fontSize(11).fillColor("#0e7490");
    doc.text(`DR-${f.disaster_number}`, 175, y + 5, {
      width: 60, lineBreak: false, link: femaUrl(f.disaster_number), underline: true,
    });
    doc.font("Helvetica").fontSize(9).fillColor(TEXT);
    const desc = `${f.declaration_title} · ${f.state}${f.county_name ? " · " + f.county_name : ""}`;
    doc.text(desc, 240, y + 7, { width: W - 200, lineBreak: false, ellipsis: true });
    y += 26;
  }

  // NCEI Storm Events — forecaster narrative blocks
  for (const n of fc.ncei.slice(0, 3)) {
    if (y > doc.page.height - 200) doc.addPage();
    // Header strip
    doc.rect(54, y, W, 18).fillAndStroke("#fff7ed", "#ea580c");
    doc.fillColor("#ea580c").font("Helvetica-Bold").fontSize(8.5);
    doc.text("NCEI STORM EVENT", 60, y + 4, { width: 120, lineBreak: false });
    doc.font("Helvetica-Bold").fontSize(10).fillColor("#0e7490");
    doc.text(`#${n.event_id}`, 185, y + 4, {
      width: 70, lineBreak: false, link: nceiEventUrl(n.event_id), underline: true,
    });
    if (n.wfo) {
      doc.font("Helvetica").fontSize(8).fillColor("#5b21b6");
      doc.text(`NWS ${n.wfo} office`, 260, y + 5, { width: W - 220, lineBreak: false });
    }
    y += 22;
    if (n.narrative) {
      doc.font("Helvetica-Oblique").fontSize(9).fillColor(TEXT);
      doc.text(`"${n.narrative}"`, 60, y, { width: W - 12, align: "justify", lineGap: 1 });
      y = doc.y + 8;
    }
  }

  // Plain-text verification URLs at the bottom — adjusters who print
  // the PDF can copy-paste these into a browser even when the link
  // metadata isn't available. Same URLs as the inline links above.
  if (fc.pcs.length || fc.fema.length || fc.ncei.length) {
    if (y > doc.page.height - 120) doc.addPage();
    y += 6;
    doc.fillColor(MUTED).font("Helvetica-Bold").fontSize(8);
    doc.text("Verification URLs (copy-paste into browser, or click in this PDF):", 60, y, {
      width: W - 12, lineBreak: false,
    });
    y += 12;
    doc.font("Helvetica").fontSize(7.5).fillColor("#0e7490");
    for (const n of fc.ncei.slice(0, 3)) {
      const url = nceiEventUrl(n.event_id);
      doc.text(`• NCEI Event #${n.event_id}: ${url}`, 60, y, {
        width: W - 12, lineBreak: false, link: url, underline: false,
      });
      y += 11;
    }
    for (const f of fc.fema) {
      const url = femaUrl(f.disaster_number);
      doc.text(`• FEMA DR-${f.disaster_number}: ${url}`, 60, y, {
        width: W - 12, lineBreak: false, link: url, underline: false,
      });
      y += 11;
    }
    for (const p of fc.pcs) {
      const url = pcsUrl(p.cat_number);
      doc.text(`• PCS Cat #${p.cat_number}: ${url}`, 60, y, {
        width: W - 12, lineBreak: false, link: url, underline: false,
      });
      y += 11;
    }
    y += 4;
  }
  return y;
}

function drawSummaryPage(doc: PDFKit.PDFDocument, ctx: RenderContext): void {
  let y = 50;
  drawSectionHeading(doc, "Storm Impact Summary", y);
  y += 28;
  drawTwoColumnFacts(doc, ctx, y);
  y += 82;   // 3 rows × 22 px row height + small margin (was 60 for 2 rows)

  // Federal Citation Block — surface BEFORE the narrative so it's the
  // first thing an adjuster reads after the property summary. Adjuster-
  // grade authoritative records: PCS Cat# (carrier claim system key),
  // FEMA disaster declaration, NCEI forecaster narrative.
  const fc = ctx.hit.federal_citations;
  if (fc && (fc.pcs.length > 0 || fc.fema.length > 0 || fc.ncei.length > 0)) {
    drawSectionHeading(doc, "Federal Recognition", y);
    y += 24;
    y = drawFederalCitations(doc, ctx, y);
    y += 12;
  }

  drawSectionHeading(doc, "Storm Impact Narrative", y);
  y += 28;
  doc.font("Helvetica").fontSize(10).fillColor(TEXT);
  const narrative = buildNarrative(ctx);
  doc.text(narrative, 54, y, {
    width: doc.page.width - 108, align: "justify", lineGap: 2,
  });
  y = doc.y + 16;

  // The Documented Hail/Wind tables render the STATEWIDE peak. If the
  // state peak is null/0 the row would show '—' across every column
  // and the section reads as blank/empty (what reps were reporting).
  // Per-property hail/wind is already in the Storm Impact Summary box
  // above, so skipping this section on wind-only or hail-only storms
  // is a clean cut, not a data loss.
  const hasHail = ctx.hit.peak_hail_inches != null && ctx.hit.peak_hail_inches > 0;
  if (hasHail) {
    drawSectionHeading(doc, "Documented Hail Events", y);
    y += 28;
    drawHailEventsTable(doc, ctx, y);
    y = doc.y + 18;
  }
  const hasWind = ctx.hit.peak_wind_mph != null && ctx.hit.peak_wind_mph >= 30;
  if (hasWind) {
    drawSectionHeading(doc, "Documented Wind Events", y);
    y += 28;
    drawWindEventsTable(doc, ctx, y);
    y = doc.y + 18;
  }

  if (ctx.warnings.length > 0) {
    drawSectionHeading(doc, "Active National Weather Service Warnings", y);
    y += 28;
    doc.font("Helvetica").fontSize(9.5).fillColor(TEXT);
    doc.text(
      `${ctx.warnings.length} active NWS warning${ctx.warnings.length === 1 ? "" : "s"} for the area encompassing ${ctx.address}:`,
      54, y, { width: doc.page.width - 108 },
    );
  }
}

function drawTwoColumnFacts(doc: PDFKit.PDFDocument, ctx: RenderContext, yStart: number): void {
  const cellH = 22;
  const left = 54, right = doc.page.width - 54, mid = (left + right) / 2;
  const labelColor = MUTED, valueColor = TEXT;

  function row(y: number, lLabel: string, lValue: string, rLabel: string, rValue: string): void {
    doc.font("Helvetica").fontSize(9).fillColor(labelColor);
    doc.text(lLabel, left, y);
    doc.font("Helvetica-Bold").fontSize(10).fillColor(valueColor);
    doc.text(lValue, left + 130, y - 2);
    doc.font("Helvetica").fontSize(9).fillColor(labelColor);
    doc.text(rLabel, mid + 8, y);
    doc.font("Helvetica-Bold").fontSize(10).fillColor(valueColor);
    doc.text(rValue, mid + 130, y - 2);
    doc.moveTo(left, y + cellH - 4).lineTo(right, y + cellH - 4)
      .strokeColor(BORDER).lineWidth(0.4).stroke();
  }

  // 3 rows × 2 cols. The previous single-row "Verified Observations:
  // 0 within 5 mi · 6 of 12 sources" line confused reps because it
  // packed two unrelated numbers (ground-report distance count + federal
  // source consensus) into one phrase. Split them out so each cell
  // answers exactly one question.
  const tierLabel = ctx.hit.impact_tier === "direct_hit" ? "DIRECT HIT"
    : ctx.hit.impact_tier === "near_miss"  ? "NEAR MISS · 1–3 mi"
    : ctx.hit.impact_tier === "area_impact" ? "AREA IMPACT · 3–10 mi"
    : "—";
  const groundCount = ctx.groundReports.length;
  const groundText = groundCount === 0
    ? "None within 5 mi"
    : `${groundCount} within 5 mi`;
  // "Hail Size at Property" must use ONLY localized readings — never
  // fall back to the state peak, or the box reads 3.25" while the
  // history table for the same row reads 0.5". Same hierarchy as the
  // hero band: calibrated → atLocation band → within-1mi band → "—".
  const atProperty =
    ctx.hit.hail_calibrated_at_location ??
    ctx.hit.hail_bands.atLocation ??
    ctx.hit.hail_bands.within1mi ??
    null;
  // "Max Hail within 10 mi" still uses the broader bands — it's a
  // legitimate area-impact metric, just not at-property.
  const within10 = ctx.hit.hail_bands.within10mi ?? ctx.hit.hail_bands.within3mi ?? atProperty;
  row(yStart,
    "Date of Storm Impact:", formatIsoDate(ctx.hit.event_date),
    "Max Hail within 10 mi:",
    within10 != null ? `${within10.toFixed(2)}"` : "—");
  row(yStart + cellH,
    "Hail Size at Property:",
    atProperty != null && atProperty > 0 ? `${atProperty.toFixed(2)}"` : "—",
    "Property Impact:", tierLabel);
  row(yStart + cellH * 2,
    "Federal Source Consensus:",
    `${ctx.consilienceConfirmedCount} of ${ctx.consilienceTotalSources} confirmed`,
    "Nearby Ground Reports:", groundText);
}

function drawHailEventsTable(doc: PDFKit.PDFDocument, ctx: RenderContext, yStart: number): void {
  doc.font("Helvetica").fontSize(8.5).fillColor(MUTED);
  doc.text(
    "Each row is one storm day, consolidated across all sources. Max Hail is the largest verified size for that day; " +
    "Closest is the distance to the nearest confirmed observation; Obs is how many source records confirm the day. " +
    "IDs (NCEI/SPC/Radar site/WFO) can be independently verified.",
    54, yStart, { width: doc.page.width - 108, lineGap: 1 },
  );
  yStart = doc.y + 6;

  // Column header was just "Max Hail" — adjuster reads as at-property,
  // but this column renders peak_hail_inches which is the statewide max.
  // Renamed to spell the scope out: "Max in {state}".
  const cols = [
    { label: "Storm Date", w: 80 },
    { label: "Sources", w: 130 },
    { label: `Max in ${ctx.hit.state}`, w: 80 },
    { label: "Closest", w: 50 },
    { label: "Obs", w: 40 },
    { label: "Traceability ID", w: 120 },
  ];
  drawTableHeader(doc, cols, 54, yStart);
  const y = yStart + 18;

  const sourcesPresent: string[] = [];
  if (ctx.hit.sources.ncei) sourcesPresent.push("NEXRAD");
  if (ctx.hit.sources.swdi) sourcesPresent.push("SWDI");
  if (ctx.hit.sources.iem) sourcesPresent.push("IEM");
  if (ctx.hit.sources.hailtrace) sourcesPresent.push("Hailtrace");
  if (ctx.hit.sources.ihm) sourcesPresent.push("IHM");
  const sourcesCol = sourcesPresent.length > 0 ? sourcesPresent.join(" + ") : "—";

  const closestHail = ctx.hit.ground_reports_nearby
    .filter((g) => g.hail_size_inches != null && g.hail_size_inches >= 0.25)
    .sort((a, b) => a.distance_miles - b.distance_miles)[0];
  const closest = closestHail ? `${closestHail.distance_miles.toFixed(1)} mi` : "—";

  const obs = ctx.hit.source_records.reduce((sum, s) => sum + (s.record_count ?? 0), 0);
  const trace = ctx.hit.event_ids?.length
    ? `Event IDs: ${ctx.hit.event_ids.slice(0, 3).join(", ")}`
    : `Event ID: ${ctx.hit.event_id}`;

  drawTableRow(doc, 54, y, cols, [
    formatIsoDate(ctx.hit.event_date),
    sourcesCol,
    // Suppress "0.00\"" for peak=0 (wind-only events) — show "—" instead.
    ctx.hit.peak_hail_inches != null && ctx.hit.peak_hail_inches > 0
      ? `${ctx.hit.peak_hail_inches.toFixed(2)}"`
      : "—",
    closest,
    obs > 0 ? String(obs) : "—",
    trace,
  ]);
  doc.y = y + 22;
}

function drawWindEventsTable(doc: PDFKit.PDFDocument, ctx: RenderContext, yStart: number): void {
  doc.font("Helvetica").fontSize(8.5).fillColor(MUTED);
  doc.text(
    "Each row is one storm day, consolidated across ground-report sources (NWS/NOAA spotters, ASOS stations). " +
    "Peak Wind is the highest verified gust that day; Closest is the nearest observation; Obs counts confirming records.",
    54, yStart, { width: doc.page.width - 108, lineGap: 1 },
  );
  yStart = doc.y + 6;

  // Wind table column header was just "Peak Wind" — same scope-lying
  // pattern as the hail table. peak_wind_mph is the statewide LSR max,
  // not at-property. Renamed to spell scope explicit.
  const cols = [
    { label: "Storm Date", w: 80 },
    { label: "Sources", w: 130 },
    { label: `Max in ${ctx.hit.state}`, w: 80 },
    { label: "Closest", w: 50 },
    { label: "Obs", w: 40 },
    { label: "Traceability ID", w: 120 },
  ];
  drawTableHeader(doc, cols, 54, yStart);
  const y = yStart + 18;

  const closestWind = ctx.hit.ground_reports_nearby
    .filter((g) => g.wind_mph != null && g.wind_mph >= 30)
    .sort((a, b) => a.distance_miles - b.distance_miles)[0];
  const closest = closestWind ? `${closestWind.distance_miles.toFixed(1)} mi` : "—";

  drawTableRow(doc, 54, y, cols, [
    formatIsoDate(ctx.hit.event_date),
    ctx.hit.peak_wind_mph != null ? "NOAA + IEM LSR" : "—",
    ctx.hit.peak_wind_mph != null ? `${Math.round(ctx.hit.peak_wind_mph)} mph` : "—",
    closest,
    "—",
    `Event ID: ${ctx.hit.event_id}`,
  ]);
  doc.y = y + 22;
}

// ─── Storm Radar Imagery — always shown when any frame is available ────────
// Most properties never fall inside an active NWS warning polygon (warnings
// cover townships, not lots), so the per-warning radar section is usually
// empty. This block always renders 1–2 NEXRAD reflectivity frames at the
// classic afternoon convective hours (3 PM ET and 5 PM ET) so adjusters
// see what the storm actually looked like passing over the area.
function drawDefaultRadarSection(doc: PDFKit.PDFDocument, ctx: RenderContext): void {
  if (doc.y > doc.page.height - 320) doc.addPage();
  drawSectionBanner(doc, "Storm Radar Imagery", doc.y);
  doc.y += 30;

  const frames: Array<[NexradFetchResult | null, string]> = [
    [ctx.defaultRadar.early, "3:00 PM"],
    [ctx.defaultRadar.late, "5:00 PM"],
  ];
  const present = frames.filter((f) => f[0] != null);
  if (present.length === 0) {
    doc.fillColor(MUTED).font("Helvetica").fontSize(9.5);
    doc.text("NEXRAD imagery not yet available for this date.", 50, doc.y, {
      width: doc.page.width - 100, align: "center",
    });
    doc.y += 30;
    return;
  }

  // Side-by-side if 2 frames, single centered if 1
  const left = 50, right = doc.page.width - 50;
  const top = doc.y;
  if (present.length === 2) {
    const colW = (right - left - 20) / 2;
    const imgH = 200;
    drawRadarFrame(doc, ctx, present[0]![0]!, present[0]![1]!, left, top, colW, imgH);
    drawRadarFrame(doc, ctx, present[1]![0]!, present[1]![1]!, left + colW + 20, top, colW, imgH);
    doc.y = top + imgH + 30;
  } else {
    const imgW = 360, imgH = 240;
    const x = left + ((right - left) - imgW) / 2;
    drawRadarFrame(doc, ctx, present[0]![0]!, present[0]![1]!, x, top, imgW, imgH);
    doc.y = top + imgH + 30;
  }

  // Caption explaining what the rep is looking at
  doc.fillColor(MUTED).font("Helvetica").fontSize(8.5);
  doc.text(
    "NEXRAD WSR-88D base reflectivity composite from the Iowa Environmental Mesonet archive of NOAA radar mosaics. " +
    "The red marker indicates the property location; warmer colors (red/orange/yellow) indicate stronger radar returns " +
    "consistent with hail and heavy precipitation.",
    50, doc.y, { width: doc.page.width - 100, lineGap: 1.5, align: "justify" },
  );
  doc.y += 8;
}

function drawRadarFrame(
  doc: PDFKit.PDFDocument, ctx: RenderContext, frame: NexradFetchResult,
  caption: string, x: number, y: number, w: number, h: number,
): void {
  // Layer order, bottom up:
  //   1. Google Static Map basemap (state outlines, roads, county lines)
  //   2. NEXRAD reflectivity PNG (transparent — only the radar return shows)
  //   3. Property pin
  // Falls back to a black background if the basemap fetch failed, so the
  // colored reflectivity still pops; previously we used white which
  // washed everything out.
  if (ctx.defaultRadar.basemap) {
    try {
      doc.image(ctx.defaultRadar.basemap, x, y, { width: w, height: h });
    } catch (_) {
      doc.rect(x, y, w, h).fill("#0a0e14");
    }
  } else {
    doc.rect(x, y, w, h).fill("#0a0e14");
  }
  try {
    doc.image(frame.buffer, x, y, { width: w, height: h });
  } catch (_) { /* skip */ }
  doc.rect(x, y, w, h).strokeColor(BORDER).lineWidth(0.5).stroke();
  // Property pin overlay (white halo so it reads on either basemap or radar)
  doc.circle(x + w / 2, y + h / 2, 5).fill("#FFFFFF");
  doc.circle(x + w / 2, y + h / 2, 4).fill(RED);
  // Caption + citation
  doc.fillColor(FAINT).font("Helvetica").fontSize(8);
  doc.text(`${formatEtDate(ctx.hit.event_date)}, ~${caption} ET`, x, y + h + 4, { width: w });
  doc.fillColor(TEXT).font("Helvetica").fontSize(8);
  doc.text(radarCitationLabel(frame.snappedIso), x, y + h + 14, { width: w });
}

// ─── Pages 3+: NWS Warnings ─────────────────────────────────────────────────
function drawWarningsPages(doc: PDFKit.PDFDocument, ctx: RenderContext): void {
  for (const w of ctx.warnings.slice(0, 6)) {
    drawWarningBlock(doc, ctx, w);
  }
}

function drawWarningBlock(doc: PDFKit.PDFDocument, ctx: RenderContext, w: NwsWarning): void {
  if (doc.y > doc.page.height - 220) doc.addPage();
  const left = 50, right = doc.page.width - 50, top = doc.y + 4;

  // ── Left column: NEXRAD radar image (Hail Yes parity) ─────────────────────
  const imgX = left, imgY = top + 6, imgW = 200, imgH = 130;
  const radarHit = ctx.warningRadarImages.get(w.id);
  if (radarHit) {
    // Same layered treatment as drawRadarFrame: basemap underneath so the
    // rep can read the radar against state outlines + county lines.
    if (ctx.defaultRadar.basemap) {
      try { doc.image(ctx.defaultRadar.basemap, imgX, imgY, { width: imgW, height: imgH }); }
      catch (_) { doc.rect(imgX, imgY, imgW, imgH).fill("#0a0e14"); }
    } else {
      doc.rect(imgX, imgY, imgW, imgH).fill("#0a0e14");
    }
    try {
      doc.image(radarHit.buffer, imgX, imgY, { width: imgW, height: imgH });
    } catch (_) { /* skip */ }
    doc.rect(imgX, imgY, imgW, imgH).strokeColor(BORDER).lineWidth(0.5).stroke();
    // Property pin
    doc.circle(imgX + imgW / 2, imgY + imgH / 2, 5).fill("#FFFFFF");
    doc.circle(imgX + imgW / 2, imgY + imgH / 2, 4).fill(RED);
  } else {
    doc.rect(imgX, imgY, imgW, imgH).fill(BG_LIGHT);
    doc.fillColor(MUTED).font("Helvetica").fontSize(9);
    doc.text("(NEXRAD image unavailable)", imgX, imgY + 60, { width: imgW, align: "center" });
  }
  // Caption + product citation under image (Hail Yes-style)
  const captionTime = radarHit ? formatTimePart(radarHit.snappedIso) : formatTimePart(w.issued_at);
  doc.fillColor(FAINT).font("Helvetica").fontSize(8);
  doc.text(`NEXRAD Radar Image from ${formatIsoDate(ctx.hit.event_date)}, ${captionTime}`,
    imgX, imgY + imgH + 4, { width: imgW });
  doc.fillColor(TEXT).font("Helvetica").fontSize(8);
  const citation = radarHit
    ? radarCitationLabel(radarHit.snappedIso, w.wfo)
    : `${(w.issued_at ?? "").replace(/[-:T.Z]/g, "").slice(0, 12)}-K${w.wfo}-NEXRAD-N0R`;
  doc.text(citation, imgX, imgY + imgH + 14, { width: imgW });

  // ── Right column: warning title + key/value grid + narrative ──────────────
  const detX = imgX + imgW + 18, detW = right - detX;
  doc.fillColor(TEXT).font("Helvetica-Bold").fontSize(10);
  doc.text(
    `${w.title} issued ${formatTimePart(w.issued_at)} until ${formatTimePart(w.expires_at)} by NOAA / NWS`,
    detX, top + 6, { width: detW, lineGap: 1.5 },
  );

  let cy = doc.y + 8;
  function kv(lLabel: string, lValue: string, rLabel: string, rValue: string): void {
    const colW = (detW - 6) / 2;
    doc.fillColor(MUTED).font("Helvetica").fontSize(8.5);
    doc.text(lLabel, detX, cy);
    doc.fillColor(TEXT).font("Helvetica-Bold").fontSize(9);
    doc.text(lValue, detX + 70, cy, { width: colW - 70, lineBreak: false });
    doc.fillColor(MUTED).font("Helvetica").fontSize(8.5);
    doc.text(rLabel, detX + colW, cy);
    doc.fillColor(TEXT).font("Helvetica-Bold").fontSize(9);
    doc.text(rValue, detX + colW + 70, cy, { width: colW - 70, lineBreak: false });
    cy += 18;
  }
  kv("Effective:", formatTimePart(w.issued_at), "Expires:", formatTimePart(w.expires_at));
  kv(
    "Hail Size:", w.hail_size_inches != null ? `${w.hail_size_inches.toFixed(2)}"` : "n/a",
    "Wind Speed:", w.wind_mph != null ? `${Math.round(w.wind_mph)} mph` : "n/a",
  );
  kv("Urgency:", "Immediate", "Certainty:", w.tornado_damage ? "Damage Threat" : "Observed");
  if (w.narrative) {
    doc.fillColor(MUTED).font("Helvetica").fontSize(8);
    doc.text(w.narrative, detX, cy + 4, { width: detW, lineGap: 1 });
  }

  doc.y = Math.max(doc.y, imgY + imgH + 22);
  doc.moveDown(0.5);
}

// ─── Historical Storm Activity ──────────────────────────────────────────────
function drawHistoricalActivity(doc: PDFKit.PDFDocument, ctx: RenderContext): void {
  if (doc.y > doc.page.height - 240) doc.addPage();
  let y = doc.y + 12;
  drawSectionHeading(doc, "Historical Storm Activity", y);
  y += 28;

  const directs = ctx.allHits.filter((h) => h.impact_tier === "direct_hit").length;
  const nears = ctx.allHits.filter((h) => h.impact_tier === "near_miss").length;
  const within3to5 = ctx.allHits.filter((h) =>
    h.hail_bands.within3mi != null || h.hail_bands.within10mi != null
  ).length;
  doc.font("Helvetica").fontSize(9).fillColor(TEXT);
  doc.text(
    `${directs} day${directs === 1 ? "" : "s"} with hail ½" or larger at property  •  ` +
    `${nears} day${nears === 1 ? "" : "s"} with hail 1–3 mi away  •  ` +
    `${within3to5} day${within3to5 === 1 ? "" : "s"} with hail 3–10 mi away`,
    54, y, { width: doc.page.width - 108 },
  );
  y = doc.y + 12;

  // "Hit" column dropped — every row in this table is a hit by
  // definition, so the column was always "DIRECT HIT" (or in rare
  // cases "1-3 mi" repeating the band columns), which read as broken.
  // Direction / Speed columns dropped too — we don't have storm-track
  // vectors per event, so they were always "—".
  // Column labels match the actual band semantics in impact.ts:
  //   atLocation:  inside polygon OR ≤ 0.9 mi
  //   within1mi:   1.0–2.5 mi
  //   within3mi:   3.0–5.0 mi
  //   within10mi:  5.0–10.0 mi
  // Old labels said "1–3 mi" for the within1mi band which is actually
  // 1.0–2.5 mi. Honest labels now.
  const cols = [
    { label: "Map Date*", w: 80 },
    { label: "At Property", w: 80 },
    { label: "1–2.5 mi", w: 60 },
    { label: "3–5 mi", w: 60 },
    { label: "5–10 mi", w: 60 },
  ];
  drawTableHeader(doc, cols, 54, y);
  y += 18;

  const rows = ctx.allHits.slice(0, 15);
  for (const h of rows) {
    if (y > doc.page.height - 80) {
      doc.addPage();
      y = 50;
      drawTableHeader(doc, cols, 54, y);
      y += 18;
    }
    // "At Property" column uses the same calibrated/at-location hierarchy
    // as the hero band so the front-page reading and this table never
    // contradict each other. Raw MRMS pixel (atLocation) feeds in but the
    // calibrated value (after federal-consistency + ground-report
    // blending) takes precedence when present.
    const rowAtProperty =
      h.hail_calibrated_at_location ??
      h.hail_bands.atLocation ??
      h.hail_bands.within1mi ??
      null;
    drawTableRow(doc, 54, y, cols, [
      formatIsoDate(h.event_date),
      rowAtProperty != null ? `${rowAtProperty.toFixed(2)}"` : "—",
      h.hail_bands.within1mi != null ? `${h.hail_bands.within1mi.toFixed(2)}"` : "—",
      h.hail_bands.within3mi != null ? `${h.hail_bands.within3mi.toFixed(2)}"` : "—",
      h.hail_bands.within10mi != null ? `${h.hail_bands.within10mi.toFixed(2)}"` : "—",
    ]);
    y += 22;
  }

  doc.y = y + 4;
  doc.font("Helvetica-Oblique").fontSize(7).fillColor(MUTED);
  doc.text(
    `* "At Property" = inside hail polygon OR within 0.9 mi. Distance columns (1–2.5, 3–5, 5–10 mi) are mutually exclusive — ` +
    `each observation is assigned to one band, showing max hail in that band. Gaps at 0.9–1.0 mi and 2.5–3.0 mi are intentionally unbinned. ` +
    `"DIRECT HIT" = ½" or larger at property; sub-¼" values are suppressed. See "Disclaimer & Limitations" below.`,
    54, doc.y, { width: doc.page.width - 108, lineGap: 1 },
  );
}

// ─── Disclaimer + Footer ─────────────────────────────────────────────────────
// Renders compact ~7pt italic disclaimer in the page-bottom margin area
// so it never claims its own page. Must fit in ≤140pt of vertical space
// (above the navy footer band at page.height-32). If the prior section
// pushed us past that floor, we add a page and re-anchor — but in
// practice that only triggers on extreme 15-row history tables.
function drawDisclaimerAndFooter(doc: PDFKit.PDFDocument, ctx: RenderContext): void {
  // Anchor disclaimer in the bottom band of the CURRENT page so we never
  // get a half-empty page 5 with just the copyright. Layout from bottom
  // up: footer band 32pt, disclaimer body fixed-height 96pt above it,
  // heading 12pt above that. Total ~140pt reserved.
  //
  // CRITICAL: PDFKit auto-paginates whenever cursor crosses the bottom
  // margin during ANY draw operation. Drop bottom margin to 0 around
  // the disclaimer block so absolute-positioned text in the bottom band
  // doesn't trigger an unwanted page-break, then restore it after.
  const savedBottomMargin = doc.page.margins.bottom;
  doc.page.margins.bottom = 0;

  const footY = doc.page.height - 32;
  const bodyHeight = 96;
  const bodyY = footY - bodyHeight - 6;
  const headingY = bodyY - 14;
  if (headingY < doc.y + 4) {
    doc.addPage();
    doc.page.margins.bottom = 0; // re-apply on new page
  }
  // Heading
  doc.font("Helvetica-Bold").fontSize(9).fillColor(MUTED);
  doc.text("Disclaimer & Limitations", 54, footY - bodyHeight - 20,
    { width: doc.page.width - 108, lineBreak: false });
  // Body — height-capped so PDFKit can never auto-paginate past the footer
  doc.font("Helvetica-Oblique").fontSize(6.5).fillColor(MUTED);
  doc.text(
    "Hail Yes Storm Intelligence (HYSI) generates this Hail Impact Report from publicly available federal and " +
    "scientific-network data: NOAA NCEI Storm Events Database, NCEI SWDI NEXRAD WSR-88D radar hail signatures, " +
    "NOAA NSSL MRMS gridded hail product, NWS Local Storm Reports via IEM, NWS VTEC warning archive, and " +
    "Synoptic Data API surface observations (MADIS). All storm event data, radar imagery, and severe weather " +
    "warnings originate from these sources and are presented as reported. While Hail Yes attempts to be as " +
    "accurate as possible, Hail Yes makes no representations or warranties of any kind, including express or " +
    "implied warranties, that the information on this report is accurate, complete, or free from defects. " +
    "Hail Yes is not responsible for any use of this report or decisions based on it. This report does not " +
    "constitute a professional roof inspection. A licensed roofing contractor should perform a physical " +
    "inspection. Original event identifiers (NCEI EVENT_ID, SPC OM#, NEXRAD WSR ID) are retained for " +
    "independent verification.",
    54, footY - bodyHeight,
    {
      width: doc.page.width - 108,
      height: bodyHeight - 4,
      align: "justify",
      lineGap: 0.3,
      ellipsis: false,
    },
  );

  // Copyright lives within the disclaimer band, ABOVE the page bottom
  // margin, so PDFKit doesn't auto-paginate. Sits 6pt below the body's
  // bottom edge. Bottom margin is 50pt by default → render at footY-30.
  doc.y = 50; // safe cursor; absolute positioning below
  doc.font("Helvetica").fontSize(7).fillColor(MUTED);
  doc.text(
    `Hail Yes Storm Intelligence (HYSI) © ${ctx.generatedAt.getFullYear()}  ·  Data sourced from NOAA NCEI, NWS, IEM, and federal radar archives`,
    0, footY - 8,
    { width: doc.page.width, align: "center", lineBreak: false },
  );

  doc.page.margins.bottom = savedBottomMargin;
}

// ─── Drawing primitives ──────────────────────────────────────────────────────
/**
 * Section heading — alias to Hail Yes-style gray banner so every section
 * gets the same visual treatment. Pre-rewrite this used a navy bar; kept
 * the function name for compatibility with existing call sites.
 */
function drawSectionHeading(doc: PDFKit.PDFDocument, label: string, y: number): void {
  drawSectionBanner(doc, label, y);
}

interface Col { label: string; w: number; }

function drawTableHeader(doc: PDFKit.PDFDocument, cols: Col[], x: number, y: number): void {
  doc.rect(x, y, cols.reduce((s, c) => s + c.w, 0), 16).fill(BG_LIGHT);
  doc.font("Helvetica-Bold").fontSize(8).fillColor(MUTED);
  let cx = x + 4;
  for (const c of cols) {
    doc.text(c.label, cx, y + 4, { width: c.w - 8 });
    cx += c.w;
  }
}

function drawTableRow(doc: PDFKit.PDFDocument, x: number, y: number, cols: Col[], values: string[]): void {
  doc.font("Helvetica").fontSize(9).fillColor(TEXT);
  let cx = x + 4;
  for (let i = 0; i < cols.length; i += 1) {
    doc.text(values[i] ?? "—", cx, y + 4, { width: cols[i]!.w - 8 });
    cx += cols[i]!.w;
  }
  const totalW = cols.reduce((s, c) => s + c.w, 0);
  doc.moveTo(x, y + 18).lineTo(x + totalW, y + 18).strokeColor(BORDER).lineWidth(0.3).stroke();
}

// ─── Narrative + word formatters ─────────────────────────────────────────────
function buildNarrative(ctx: RenderContext): string {
  // Anchor at noon ET so the weekday is unambiguous regardless of server TZ.
  const dayName = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", weekday: "long",
  }).format(new Date(`${ctx.hit.event_date}T16:00:00Z`));
  const datePretty = formatIsoDate(ctx.hit.event_date);
  const statePeak = ctx.hit.peak_hail_inches;          // statewide max
  const atProperty =                                   // localized reading
    ctx.hit.hail_calibrated_at_location ??
    ctx.hit.hail_bands.atLocation ??
    ctx.hit.hail_bands.within1mi ??
    null;
  const wind = ctx.hit.peak_wind_mph;
  const windAtProperty =                               // localized wind LSR
    (ctx.hit.wind_bands?.atLocation ?? null) ??
    (ctx.hit.wind_bands?.within1mi ?? null);

  const groundCount = ctx.groundReports.length;
  const closeReports = ctx.groundReports.filter((g) => g.distance_miles <= 1).length;

  const parts: string[] = [];
  parts.push(`On ${dayName}, ${datePretty}, a severe weather system impacted the ${ctx.address} area, `);
  // Lead with the at-property reading so the narrative number matches the
  // hero band + "Hail Size at Property" + history table. Mention the state
  // peak only as labeled context — never as the de facto property number.
  if (atProperty != null && atProperty >= 0.25) {
    const localWord = hailSizeWord(atProperty).toLowerCase();
    parts.push(`producing ${localWord}-sized hail measuring up to ${atProperty.toFixed(2)}" at the property`);
    if (statePeak != null && statePeak > atProperty + 0.25) {
      parts.push(` (peak in ${ctx.hit.state} on this date: ${statePeak.toFixed(2)}")`);
    }
    if (wind != null && wind >= 50) parts.push(` alongside documented damaging wind`);
    parts.push(`. `);
  } else if (statePeak != null && statePeak >= 0.25) {
    // No localized reading available — be explicit that the size is the
    // state peak, not at the property.
    const stateWord = hailSizeWord(statePeak).toLowerCase();
    parts.push(`with ${stateWord}-sized hail recorded across ${ctx.hit.state} (peak ${statePeak.toFixed(2)}")`);
    if (wind != null && wind >= 50) parts.push(` and documented damaging wind`);
    parts.push(`. `);
  } else if (windAtProperty != null && windAtProperty >= 50) {
    parts.push(`producing damaging wind gusts up to ${Math.round(windAtProperty)} mph at the property`);
    if (wind != null && wind > windAtProperty + 5) {
      parts.push(` (peak in ${ctx.hit.state} on this date: ${Math.round(wind)} mph)`);
    }
    parts.push(`. `);
  } else if (wind != null && wind >= 50) {
    // No localized wind reading — be explicit that mph is statewide max.
    parts.push(`with damaging wind gusts up to ${Math.round(wind)} mph recorded across ${ctx.hit.state}. `);
  } else {
    parts.push(`producing severe weather. `);
  }
  if (groundCount > 0) {
    parts.push(`A total of ${groundCount} verified storm event${groundCount === 1 ? " was" : "s were"} documented within a 5-mile radius of the subject property at ${ctx.address}. `);
  }
  if (closeReports > 0) {
    parts.push(`${closeReports} storm report${closeReports === 1 ? " was" : "s were"} documented within 1 mile of the property. `);
  }
  if (atProperty != null && atProperty >= 0.5) {
    parts.push(`Hail of this magnitude is capable of causing potential damage to roof surfaces, especially aged or compromised roofing materials and progressive wear to exterior components over the course of the event. `);
  }
  parts.push(`Based on the documented storm activity, a thorough property inspection is recommended to assess potential damage to roofing, siding, gutters, windows, and other exterior components.`);
  return parts.join("");
}

function sourceXrefBadges(ctx: RenderContext): string {
  const badges: string[] = [];
  if (ctx.hit.sources.ncei || ctx.hit.sources.swdi) badges.push("NEXRAD");
  if (ctx.hit.sources.iem) badges.push("IEM LSR");
  if (ctx.hit.sources.ncei) badges.push("NCEI");
  if (ctx.warnings.length > 0) badges.push("NWS Warnings");
  if (ctx.consilienceConfirmedCount >= 6) badges.push("Synoptic");
  return badges.length > 0 ? badges.join(" • ") : "Multiple federal sources";
}

function hailSizeWord(inches: number | null): string {
  if (inches == null) return "—";
  if (inches < 0.25) return "Trace";
  if (inches < 0.5) return "Pea / Marble";
  if (inches < 0.75) return "Penny";
  if (inches < 1.0) return "Nickel";
  if (inches < 1.25) return "Quarter";
  if (inches < 1.5) return "Half-Dollar";
  if (inches < 1.75) return "Walnut";
  if (inches < 2.0) return "Golf Ball";
  if (inches < 2.5) return "Tennis Ball";
  if (inches < 2.75) return "Baseball";
  if (inches < 3.0) return "Tea Cup";
  if (inches < 4.0) return "Softball";
  return "Grapefruit+";
}

// ─── Date formatters — Eastern Time, DST-aware ───────────────────────────────
// All user-facing dates and times in this PDF render in America/New_York
// with EDT/EST suffix picked dynamically. DB stays in UTC; only display
// converts. See apps/api/src/lib/et-format.ts.
const formatIsoDate = formatEtDate;
const formatDateTime = formatEtDateTime;     // "MM/DD/YYYY, h:mm AM/PM EDT"
const formatTimePart = formatEtTime;          // "h:mm AM/PM EDT"
