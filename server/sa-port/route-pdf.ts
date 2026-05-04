import { Router } from "express";
import { z } from "zod";
import { sql } from "../db.js";
import { buildAdjusterPdf } from "./pdf.js";
import { geocodeAddress } from "./geocode.js";

export const pdfRouter = Router();

const PdfBody = z
  .object({
    event_id: z.coerce.number().int().positive(),
    address: z.string().min(2).optional(),
    lat: z.number().gte(-90).lte(90).optional(),
    lng: z.number().gte(-180).lte(180).optional(),
  })
  .refine(
    (v) =>
      typeof v.address === "string" ||
      (typeof v.lat === "number" && typeof v.lng === "number"),
    { message: "must provide address or both lat and lng" },
  );

pdfRouter.post("/api/events/:id/pdf", async (req, res, next) => {
  try {
    const eventId = parseInt(req.params.id ?? "0", 10);
    if (!Number.isFinite(eventId) || eventId <= 0) {
      res.status(400).json({ error: "bad event id" });
      return;
    }
    const parse = PdfBody.safeParse({ ...req.body, event_id: eventId });
    if (!parse.success) {
      res.status(400).json({ error: parse.error.issues });
      return;
    }
    const body = parse.data;

    let lat: number, lng: number, address: string | null = body.address ?? null;
    let normalized: string | null = null;

    if (body.lat != null && body.lng != null) {
      lat = body.lat;
      lng = body.lng;
    } else if (body.address) {
      const g = await geocodeAddress(body.address);
      if (!g) {
        res.status(400).json({ error: "geocode failed", address: body.address });
        return;
      }
      lat = g.lat;
      lng = g.lng;
      normalized = g.normalized;
    } else {
      res.status(400).json({ error: "must provide address or {lat,lng}" });
      return;
    }

    const built = await buildAdjusterPdf(sql, {
      eventId,
      lat,
      lng,
      address,
      normalized,
    });

    // Persist the report so /api/reports/verify?id=&code= can confirm
    // it later. Use INSERT ... ON CONFLICT so re-running an idempotent
    // PDF render doesn't crash on duplicate report_id (vanishingly rare
    // — the ID combines Date.now() + random — but the upsert is cheap).
    const clientId = req.header("x-client-id") ?? null;
    // Use text-cast jsonb to avoid postgres.js v3.4.8 sql.json() bind
    // edge case (see route-impact.ts comment).
    await sql.unsafe(
      `
        INSERT INTO pdf_reports
          (report_id, verification_code, event_id, event_date, state,
           lat, lng, address, generated_by_user, client_id, payload)
        VALUES ($1, $2, $3, $4::date, $5, $6, $7, $8, $9, $10, $11::jsonb)
        ON CONFLICT (report_id) DO NOTHING
      `,
      [
        built.reportId, built.verificationCode, eventId,
        built.eventDate, built.state,
        lat, lng, address ?? null,
        req.user?.id ?? null, clientId,
        JSON.stringify({ normalized }),
      ],
    );

    const filename = `storm-impact-${eventId}-${Date.now()}.pdf`;
    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": built.buffer.length.toString(),
      "Cache-Control": "private, no-cache",
      // Surface the IDs in response headers so the frontend can show a
      // toast like "Saved as report #..., verification ..."
      "x-report-id": built.reportId,
      "x-verification-code": built.verificationCode,
    });
    res.end(built.buffer);
  } catch (err) {
    next(err);
  }
});

// ─── Adjuster-PDF by date (frontend-friendly) ────────────────────────────────
// The Hail Yes! frontend works in (date, lat/lng) terms — the StormDate
// model doesn't surface event_id. This route accepts the rep's
// {date, lat, lng, address} and resolves event_id internally before
// delegating to buildAdjusterPdf.
const AdjusterPdfBody = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD"),
  address: z.string().min(2).optional(),
  lat: z.number().gte(-90).lte(90),
  lng: z.number().gte(-180).lte(180),
});
pdfRouter.post("/api/adjuster-pdf", async (req, res, next) => {
  try {
    const parse = AdjusterPdfBody.safeParse(req.body);
    if (!parse.success) {
      res.status(400).json({ error: parse.error.issues });
      return;
    }
    const { date, address, lat, lng } = parse.data;
    // Pick the highest-tier event on that date — same heuristic the
    // /api/events/by-date endpoint uses, but inlined to avoid a second
    // HTTP hop. Higher tier + bigger peak hail wins.
    const events = await sql<Array<{ id: number }>>`
      SELECT id FROM events
       WHERE event_date = ${date}::date
       ORDER BY tier DESC, peak_hail_inches DESC NULLS LAST, state
       LIMIT 1
    `;
    if (events.length === 0) {
      res.status(404).json({ error: `no events catalogued on ${date}` });
      return;
    }
    const eventId = events[0]!.id;
    const built = await buildAdjusterPdf(sql, {
      eventId,
      lat,
      lng,
      address: address ?? null,
      normalized: null,
    });
    const clientId = req.header("x-client-id") ?? null;
    await sql.unsafe(
      `
        INSERT INTO pdf_reports
          (report_id, verification_code, event_id, event_date, state,
           lat, lng, address, generated_by_user, client_id, payload)
        VALUES ($1, $2, $3, $4::date, $5, $6, $7, $8, $9, $10, $11::jsonb)
        ON CONFLICT (report_id) DO NOTHING
      `,
      [
        built.reportId, built.verificationCode, eventId,
        built.eventDate, built.state,
        lat, lng, address ?? null,
        req.user?.id ?? null, clientId,
        JSON.stringify({ via: "adjuster-pdf-by-date" }),
      ],
    );
    const filename = `adjuster-report-${date}.pdf`;
    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": built.buffer.length.toString(),
      "Cache-Control": "private, no-cache",
      "x-report-id": built.reportId,
      "x-verification-code": built.verificationCode,
    });
    res.end(built.buffer);
  } catch (err) {
    next(err);
  }
});
// Need buildAdjusterPdf import
// (already imported at top via "./pdf.js")

// ─── Public verification endpoint ────────────────────────────────────────────
// Adjuster pastes the report# + 6-char verification code into the
// public /verify page. Endpoint returns the matched record (or 404)
// so they can confirm the PDF in their hand was issued by us.
const VerifyQuery = z.object({
  id: z.string().min(8).max(64),
  code: z.string().regex(/^[0-9a-f]{6}$/i),
});
pdfRouter.get("/api/reports/verify", async (req, res) => {
  const parse = VerifyQuery.safeParse(req.query);
  if (!parse.success) {
    res.status(400).json({ error: parse.error.issues });
    return;
  }
  const rows = await sql<Array<{
    report_id: string; event_id: number; event_date: string; state: string;
    address: string | null; lat: number; lng: number;
    generated_at: string;
  }>>`
    SELECT report_id, event_id, event_date::text AS event_date, state,
      address, lat::float8 AS lat, lng::float8 AS lng,
      generated_at::text AS generated_at
    FROM pdf_reports
    WHERE report_id = ${parse.data.id}
      AND verification_code = ${parse.data.code.toLowerCase()}
  `;
  if (rows.length === 0) {
    res.status(404).json({
      verified: false,
      error: "no report found for that ID + verification code",
    });
    return;
  }
  res.set("Cache-Control", "no-store");
  res.json({ verified: true, report: rows[0] });
});
// Phase 5: env-pickup redeploy
