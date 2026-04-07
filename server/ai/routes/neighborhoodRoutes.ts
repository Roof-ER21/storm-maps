import { Router } from "express";
import { eq } from "drizzle-orm";
import { db } from "../../db.js";
import { propertyAnalyses } from "../schema.js";
import { findNearbyBuildings } from "../services/neighborhoodService.js";
import { classifyProperty } from "../services/aiClassificationService.js";
import {
  getBuildingInsights,
  estimateReplacementCost,
  areaToSquares,
} from "../services/solarApiService.js";

const router = Router();

const getConfig = () => ({
  googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY || "",
  geminiApiKey: process.env.GEMINI_API_KEY || "",
});

// GET /api/neighborhood?lat=...&lng=...&radius=200
router.get("/", async (req, res) => {
  try {
    const lat = parseFloat(req.query.lat as string);
    const lng = parseFloat(req.query.lng as string);
    const radius = Math.min(500, parseInt(req.query.radius as string) || 200);

    if (isNaN(lat) || isNaN(lng)) {
      res.status(400).json({ error: "lat and lng are required" });
      return;
    }

    const buildings = await findNearbyBuildings(lat, lng, radius, 30);
    res.json({ buildings, center: { lat, lng }, radius });
  } catch (error) {
    console.error("Neighborhood error:", error);
    res.status(500).json({ error: "Failed to find nearby buildings" });
  }
});

/** Fetch a single satellite image buffer directly (no Street View) */
async function fetchSatelliteOnly(
  lat: number,
  lng: number,
  zoom: number,
  apiKey: string
): Promise<Buffer | null> {
  const url = new URL("https://maps.googleapis.com/maps/api/staticmap");
  url.searchParams.set("center", `${lat},${lng}`);
  url.searchParams.set("zoom", String(zoom));
  url.searchParams.set("size", "640x640");
  url.searchParams.set("maptype", "satellite");
  url.searchParams.set("scale", "2");
  url.searchParams.set("key", apiKey);

  try {
    const res = await fetch(url.toString(), {
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}

/** Check Street View metadata for date + availability */
async function checkStreetView(
  lat: number,
  lng: number,
  apiKey: string
): Promise<{ available: boolean; date: string | null }> {
  const url = new URL(
    "https://maps.googleapis.com/maps/api/streetview/metadata"
  );
  url.searchParams.set("location", `${lat},${lng}`);
  url.searchParams.set("key", apiKey);

  try {
    const res = await fetch(url.toString(), {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return { available: false, date: null };
    const data = await res.json();
    return { available: data.status === "OK", date: data.date || null };
  } catch {
    return { available: false, date: null };
  }
}

// POST /api/neighborhood/quick-scan
router.post("/quick-scan", async (req, res) => {
  try {
    const { lat, lng, address } = req.body;
    if (!lat || !lng) {
      res.status(400).json({ error: "lat and lng are required" });
      return;
    }

    const config = getConfig();
    if (!config.googleMapsApiKey || !config.geminiApiKey) {
      res.status(500).json({ error: "API keys not configured" });
      return;
    }

    const parsedLat = parseFloat(lat);
    const parsedLng = parseFloat(lng);
    const placeId = `quick_${parsedLat.toFixed(5)}_${parsedLng.toFixed(5)}`;

    // Check cache
    const existing = await db.query.propertyAnalyses.findFirst({
      where: eq(propertyAnalyses.placeId, placeId),
    });
    if (existing?.status === "completed") {
      res.json(existing);
      return;
    }

    // Create record
    const [record] = await db
      .insert(propertyAnalyses)
      .values({
        inputAddress: address || `${lat}, ${lng}`,
        normalizedAddress: address,
        lat: parsedLat,
        lng: parsedLng,
        placeId,
        status: "fetching_images",
      })
      .onConflictDoNothing()
      .returning();

    if (!record) {
      const found = await db.query.propertyAnalyses.findFirst({
        where: eq(propertyAnalyses.placeId, placeId),
      });
      if (found) { res.json(found); return; }
      res.status(500).json({ error: "Failed to create record" });
      return;
    }

    try {
      // Fetch satellite + Street View metadata + Solar API in parallel
      const [satellite, svCoverage, solarInsights] = await Promise.all([
        fetchSatelliteOnly(parsedLat, parsedLng, 20, config.googleMapsApiKey),
        checkStreetView(parsedLat, parsedLng, config.googleMapsApiKey),
        getBuildingInsights(parsedLat, parsedLng, config.googleMapsApiKey).catch(() => null),
      ]);

      // Build display URLs
      const satDisplayUrl = `/api/images/satellite?lat=${parsedLat}&lng=${parsedLng}`;

      let svDisplayUrl: string | null = null;
      if (svCoverage.available) {
        svDisplayUrl = `/api/images/streetview?lat=${parsedLat}&lng=${parsedLng}`;
      }

      await db
        .update(propertyAnalyses)
        .set({
          satelliteUrl: satDisplayUrl,
          streetViewUrl: svDisplayUrl,
          streetViewAvailable: svCoverage.available,
          streetViewDate: svCoverage.date,
          status: "analyzing",
        })
        .where(eq(propertyAnalyses.id, record.id));

      if (!satellite) {
        await db
          .update(propertyAnalyses)
          .set({ status: "failed", errorMessage: "No satellite imagery" })
          .where(eq(propertyAnalyses.id, record.id));
        res.json(
          await db.query.propertyAnalyses.findFirst({
            where: eq(propertyAnalyses.id, record.id),
          })
        );
        return;
      }

      // Build geographic context
      const geoContext = [
        address ? `Address: ${address}` : `Location: ${parsedLat}, ${parsedLng}`,
        solarInsights?.hasData
          ? `Google Solar API: roof pitch ${solarInsights.avgPitchDegrees}deg, ${solarInsights.segmentCount} segments, ${Math.round(solarInsights.totalRoofAreaMeters2)}m2, type=${solarInsights.roofType}`
          : null,
      ]
        .filter(Boolean)
        .join(". ");

      // AI classification (satellite only for quick scan)
      const classification = await classifyProperty(
        null,
        satellite,
        geoContext,
        config.geminiApiKey
      );

      // Prospect score
      let score = 0;
      if (classification.roofType === "three_tab_shingle") score += 25;
      if (classification.roofAgeEstimate >= 20) score += 30;
      else if (classification.roofAgeEstimate >= 15) score += 20;
      else if (classification.roofAgeEstimate >= 10) score += 10;
      if (
        classification.roofCondition === "poor" ||
        classification.roofCondition === "critical"
      )
        score += 25;
      else if (classification.roofCondition === "fair") score += 15;
      if (classification.isAluminumSiding) score += 20;
      score += Math.min(classification.damageIndicators.length * 5, 20);
      if (classification.roofConfidence < 0.5) score -= 15;
      score = Math.max(0, Math.min(100, score));

      // Cost estimate from Solar data
      const roofAreaM2 = solarInsights?.totalRoofAreaMeters2 || 0;
      const costEstimate = estimateReplacementCost(roofAreaM2, classification.roofType);

      await db
        .update(propertyAnalyses)
        .set({
          roofType: classification.roofType as any,
          roofCondition: classification.roofCondition as any,
          roofAgeEstimate: classification.roofAgeEstimate,
          roofConfidence: classification.roofConfidence,
          roofColor: classification.roofColor,
          isAluminumSiding: classification.isAluminumSiding,
          sidingType: classification.sidingType as any,
          sidingCondition: classification.sidingCondition as any,
          sidingConfidence: classification.sidingConfidence,
          roofFeatures: classification.roofFeatures,
          sidingFeatures: classification.sidingFeatures,
          reasoning: classification.reasoning,
          damageIndicators: classification.damageIndicators,
          prospectScore: score,
          isHighPriority: score >= 60,
          aiRawResponse: {
            ...classification,
            solarInsights: solarInsights?.hasData
              ? {
                  roofAreaM2: Math.round(roofAreaM2),
                  roofAreaSqFt: Math.round(roofAreaM2 * 10.764),
                  roofSquares: areaToSquares(roofAreaM2),
                  avgPitchDegrees: solarInsights.avgPitchDegrees,
                  segmentCount: solarInsights.segmentCount,
                  measuredRoofType: solarInsights.roofType,
                }
              : null,
            costEstimate,
          } as any,
          aiModelUsed: classification.modelUsed,
          status: "completed",
          analyzedAt: new Date(),
        })
        .where(eq(propertyAnalyses.id, record.id));

      res.json(
        await db.query.propertyAnalyses.findFirst({
          where: eq(propertyAnalyses.id, record.id),
        })
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      await db
        .update(propertyAnalyses)
        .set({ status: "failed", errorMessage: message })
        .where(eq(propertyAnalyses.id, record.id));
      res.json(
        await db.query.propertyAnalyses.findFirst({
          where: eq(propertyAnalyses.id, record.id),
        })
      );
    }
  } catch (error) {
    console.error("Quick scan error:", error);
    res.status(500).json({ error: "Quick scan failed" });
  }
});

export default router;
