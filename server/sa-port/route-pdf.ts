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
