import { Router } from "express";
import { z } from "zod";
import { sql } from "../db.js";
import { geocodeAddress } from "./geocode.js";
import { computeImpact, type ImpactResponse } from "./impact.js";

export const impactRouter = Router();

/**
 * Singleflight: dedupe in-flight cold computes for the same key. When N
 * concurrent requests for an uncached point arrive, the first triggers the
 * heavy DB+algorithm pipeline; the rest await its result. Without this,
 * 20 concurrent requests for the same key cause 20 redundant computes
 * before any can write to cache, blowing p95 to seconds.
 */
const inflight = new Map<string, Promise<{ result: ImpactResponse; serialized: string }>>();
function singleflight(
  key: string,
  fn: () => Promise<{ result: ImpactResponse; serialized: string }>,
): Promise<{ result: ImpactResponse; serialized: string }> {
  const existing = inflight.get(key);
  if (existing) return existing;
  const promise = fn().finally(() => inflight.delete(key));
  inflight.set(key, promise);
  return promise;
}

const ImpactBody = z
  .object({
    address: z.string().min(2).optional(),
    lat: z.number().gte(-90).lte(90).optional(),
    lng: z.number().gte(-180).lte(180).optional(),
  })
  .refine(
    (v) =>
      (typeof v.address === "string" && v.address.length > 0) ||
      (typeof v.lat === "number" && typeof v.lng === "number"),
    { message: "must provide address or both lat and lng" },
  );

/**
 * Send a cached response WITHOUT re-parsing the JSONB blob through V8.
 * postgres.js auto-parses jsonb columns to JS objects; that's expensive
 * on hot paths with 200KB+ blobs and 20 concurrent reads. Pulling as
 * `result::text` keeps it as a string we can stream straight to the wire.
 */
async function tryCacheHit(
  cacheKey: string,
  res: import("express").Response,
): Promise<boolean> {
  const rows = await sql<Array<{ result_text: string }>>`
    SELECT result::text AS result_text
    FROM impact_lookups
    WHERE address_normalized = ${cacheKey} AND expires_at > NOW()
  `;
  if (rows.length === 0) return false;
  const raw = rows[0]!.result_text;
  // The cached blob is a complete ImpactResponse JSON. Append a `,"cached":true`
  // before the closing brace so the client sees the cached flag without us
  // having to parse + reserialize.
  const lastBrace = raw.lastIndexOf("}");
  const withFlag =
    lastBrace > 0 ? `${raw.slice(0, lastBrace)},"cached":true${raw.slice(lastBrace)}` : raw;
  res.set("Content-Type", "application/json; charset=utf-8");
  res.send(withFlag);
  return true;
}

impactRouter.post("/api/impact", async (req, res) => {
  const t0 = Date.now();
  const parse = ImpactBody.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: parse.error.issues });
    return;
  }
  const body = parse.data;

  let lat: number;
  let lng: number;
  let normalized: string;
  let provider: string | null = null;

  if (body.lat != null && body.lng != null) {
    lat = body.lat;
    lng = body.lng;
    normalized = `${lat.toFixed(4)},${lng.toFixed(4)}`;
    const cacheKey = `latlng:${lat.toFixed(4)},${lng.toFixed(4)}`;
    if (await tryCacheHit(cacheKey, res)) return;
  } else if (body.address) {
    if (await tryCacheHit(`addr:${body.address.toLowerCase()}`, res)) return;
    const g = await geocodeAddress(body.address);
    if (!g) {
      res.status(400).json({ error: "geocode failed", address: body.address });
      return;
    }
    lat = g.lat;
    lng = g.lng;
    normalized = g.normalized;
    provider = g.provider;
  } else {
    res.status(400).json({ error: "must provide address or {lat,lng}" });
    return;
  }

  const cacheKey = body.address
    ? `addr:${body.address.toLowerCase()}`
    : `latlng:${lat.toFixed(4)},${lng.toFixed(4)}`;

  const { serialized } = await singleflight(cacheKey, async () => {
    const result = await computeImpact(sql, lat, lng, t0, {
      address: body.address ?? null,
      lat,
      lng,
      normalized,
      geocode_provider: provider,
    });
    const serialized = JSON.stringify(result);
    // Persist via tagged-template form so postgres.js handles the jsonb
    // binding cleanly (it stringifies the object once and casts to jsonb;
    // we then read it back as text on hits to skip the V8 reparse path).
    if (body.address) {
      await sql`
        INSERT INTO impact_lookups (address_normalized, lat, lng, result, expires_at)
        VALUES (${cacheKey}, ${lat}, ${lng}, ${sql.json(result as never)},
                NOW() + INTERVAL '24 hours')
        ON CONFLICT (address_normalized) DO UPDATE SET
          result = EXCLUDED.result,
          lat = EXCLUDED.lat, lng = EXCLUDED.lng,
          expires_at = EXCLUDED.expires_at
      `;
    } else {
      await sql`
        INSERT INTO impact_lookups (address_normalized, lat, lng, result, expires_at)
        VALUES (${cacheKey}, ${lat}, ${lng}, ${sql.json(result as never)},
                NOW() + INTERVAL '1 hour')
        ON CONFLICT (address_normalized) DO UPDATE SET
          result = EXCLUDED.result,
          lat = EXCLUDED.lat, lng = EXCLUDED.lng,
          expires_at = EXCLUDED.expires_at
      `;
    }
    return { result, serialized };
  });

  res.set("Content-Type", "application/json; charset=utf-8");
  res.send(serialized);
});
