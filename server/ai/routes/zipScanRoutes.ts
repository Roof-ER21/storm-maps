import { Router } from "express";
import { eq, desc } from "drizzle-orm";
import { db } from "../../db.js";
import { batchJobs, propertyAnalyses } from "../schema.js";
import { findAddressesInZip } from "../services/zipScanService.js";
import { analyzeProperty } from "../services/propertyAnalyzer.js";
import { classifyProperty } from "../services/aiClassificationService.js";
import { getBuildingInsights, estimateReplacementCost, areaToSquares } from "../services/solarApiService.js";
import type { AnalysisMode } from "../services/analysisMode.js";
import { computeProspectScore } from "../services/analysisMode.js";
import { storeImages } from "../services/imageStorageService.js";
import { validate, zipScanSchema } from "../validation.js";

const router = Router();

const getConfig = () => ({
  googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY || "",
  geminiApiKey: process.env.GEMINI_API_KEY || "",
});

/**
 * Quick satellite-only analysis for a lat/lng point.
 * Skips geocoding entirely — used for grid points that have no real address.
 */
async function quickAnalyze(
  lat: number,
  lng: number,
  address: string,
  config: { googleMapsApiKey: string; geminiApiKey: string },
  mode: AnalysisMode,
  jobId: string
) {
  const placeId = `zip_${lat.toFixed(5)}_${lng.toFixed(5)}`;

  // Check if already done
  const existing = await db.query.propertyAnalyses.findFirst({
    where: eq(propertyAnalyses.placeId, placeId),
  });
  if (existing?.status === "completed") return existing;

  // Create record
  const [record] = await db
    .insert(propertyAnalyses)
    .values({
      inputAddress: address,
      normalizedAddress: address,
      lat,
      lng,
      placeId,
      status: "fetching_images",
      batchJobId: jobId,
    })
    .onConflictDoNothing()
    .returning();

  if (!record) {
    const found = await db.query.propertyAnalyses.findFirst({
      where: eq(propertyAnalyses.placeId, placeId),
    });
    return found;
  }

  try {
    // Fetch satellite image directly
    const satUrl = new URL("https://maps.googleapis.com/maps/api/staticmap");
    satUrl.searchParams.set("center", `${lat},${lng}`);
    satUrl.searchParams.set("zoom", "20");
    satUrl.searchParams.set("size", "640x640");
    satUrl.searchParams.set("maptype", "satellite");
    satUrl.searchParams.set("scale", "2");
    satUrl.searchParams.set("key", config.googleMapsApiKey);

    const satRes = await fetch(satUrl.toString(), { signal: AbortSignal.timeout(15000) });
    if (!satRes.ok) throw new Error("No satellite imagery");
    const satellite = Buffer.from(await satRes.arrayBuffer());

    // Check street view
    const svMetaUrl = new URL("https://maps.googleapis.com/maps/api/streetview/metadata");
    svMetaUrl.searchParams.set("location", `${lat},${lng}`);
    svMetaUrl.searchParams.set("key", config.googleMapsApiKey);
    const svMeta = await fetch(svMetaUrl.toString(), { signal: AbortSignal.timeout(8000) })
      .then((r) => r.json())
      .catch(() => ({ status: "ZERO_RESULTS" }));

    let svDisplayUrl: string | null = null;
    if (svMeta.status === "OK") {
      svDisplayUrl = `/api/images/streetview?lat=${lat}&lng=${lng}`;
    }

    // Store satellite image permanently (fire and forget)
    storeImages(record.id, [{
      imageType: "satellite",
      buffer: satellite,
      mimeType: "image/png",
      lat,
      lng,
    }], db).catch(() => {});

    // Solar API (parallel, don't block)
    const solarInsights = await getBuildingInsights(lat, lng, config.googleMapsApiKey).catch(() => null);

    await db.update(propertyAnalyses).set({
      streetViewUrl: svDisplayUrl,
      satelliteUrl: `/api/images/satellite?lat=${lat}&lng=${lng}`,
      streetViewAvailable: svMeta.status === "OK",
      streetViewDate: svMeta.date || null,
      status: "analyzing",
    }).where(eq(propertyAnalyses.id, record.id));

    // AI classification
    const classification = await classifyProperty(
      null, satellite, `Property in zip code, ${address}`, config.geminiApiKey
    );

    const { score, isHighPriority } = computeProspectScore(classification, mode, solarInsights, null);
    const roofAreaM2 = solarInsights?.totalRoofAreaMeters2 || 0;
    const costEstimate = estimateReplacementCost(roofAreaM2, classification.roofType);

    await db.update(propertyAnalyses).set({
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
      isHighPriority,
      aiRawResponse: {
        ...classification,
        mode,
        solarInsights: solarInsights?.hasData ? {
          roofAreaM2: Math.round(roofAreaM2),
          roofAreaSqFt: Math.round(roofAreaM2 * 10.764),
          roofSquares: areaToSquares(roofAreaM2),
          avgPitchDegrees: solarInsights.avgPitchDegrees,
          segmentCount: solarInsights.segmentCount,
          measuredRoofType: solarInsights.roofType,
        } : null,
        costEstimate,
      } as any,
      aiModelUsed: classification.modelUsed,
      status: "completed",
      analyzedAt: new Date(),
    }).where(eq(propertyAnalyses.id, record.id));

    return await db.query.propertyAnalyses.findFirst({
      where: eq(propertyAnalyses.id, record.id),
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown";
    await db.update(propertyAnalyses).set({
      status: "failed",
      errorMessage: msg,
    }).where(eq(propertyAnalyses.id, record.id));
    return await db.query.propertyAnalyses.findFirst({
      where: eq(propertyAnalyses.id, record.id),
    });
  }
}

// POST /api/zip-scan
router.post("/", validate(zipScanSchema), async (req, res) => {
  try {
    const { zipCode, mode: analysisMode, limit: scanLimit } = req.body;

    const config = getConfig();
    if (!config.googleMapsApiKey || !config.geminiApiKey) {
      res.status(500).json({ error: "API keys not configured" });
      return;
    }

    const addresses = await findAddressesInZip(zipCode, scanLimit);
    if (addresses.length === 0) {
      res.status(404).json({ error: `No locations found in zip code ${zipCode}` });
      return;
    }

    // Create batch job
    const [job] = await db.insert(batchJobs).values({
      fileName: `zip-scan-${zipCode}-${analysisMode}`,
      totalAddresses: addresses.length,
      status: "processing",
      startedAt: new Date(),
    }).returning();

    res.json({
      jobId: job.id,
      zipCode,
      mode: analysisMode,
      addressesFound: addresses.length,
      status: "processing",
      addresses: addresses.slice(0, 5).map((a) => a.address),
    });

    // Process in background
    const CONCURRENT = 2;
    const DELAY_MS = 800;
    let processed = 0;
    let success = 0;
    let failed = 0;

    for (let i = 0; i < addresses.length; i += CONCURRENT) {
      const batch = addresses.slice(i, i + CONCURRENT);
      const results = await Promise.allSettled(
        batch.map((a) => {
          // If address has a real street address, use full analysis
          // If it's a grid point (no real address), use quick satellite-only
          const hasRealAddress = a.houseNumber && a.street;
          if (hasRealAddress) {
            return analyzeProperty(a.address, db, config, analysisMode, job.id);
          } else {
            return quickAnalyze(a.lat, a.lng, a.address, config, analysisMode, job.id);
          }
        })
      );

      for (const r of results) {
        processed++;
        if (r.status === "fulfilled" && r.value?.status === "completed") {
          success++;
        } else {
          failed++;
        }
      }

      await db.update(batchJobs).set({
        processedCount: processed,
        successCount: success,
        failedCount: failed,
      }).where(eq(batchJobs.id, job.id));

      if (i + CONCURRENT < addresses.length) {
        await new Promise((r) => setTimeout(r, DELAY_MS));
      }
    }

    // Summary
    const completedAnalyses = await db.query.propertyAnalyses.findMany({
      where: eq(propertyAnalyses.batchJobId, job.id),
      orderBy: desc(propertyAnalyses.prospectScore),
    });

    const highPriority = completedAnalyses.filter((a) => a.isHighPriority);
    const completed = completedAnalyses.filter((a) => a.status === "completed");
    const avgScore = completed.length > 0
      ? Math.round(completed.reduce((sum, a) => sum + (a.prospectScore || 0), 0) / completed.length)
      : 0;

    const roofTypes: Record<string, number> = {};
    for (const a of completed) {
      roofTypes[a.roofType || "unknown"] = (roofTypes[a.roofType || "unknown"] || 0) + 1;
    }

    await db.update(batchJobs).set({
      status: "completed",
      completedAt: new Date(),
      processedCount: processed,
      successCount: success,
      failedCount: failed,
      summaryStats: {
        zipCode,
        mode: analysisMode,
        highPriorityCount: highPriority.length,
        avgProspectScore: avgScore,
        roofTypeBreakdown: roofTypes,
        aluminumSidingCount: completed.filter((a) => a.isAluminumSiding).length,
        topLeads: highPriority.slice(0, 5).map((a) => ({
          address: a.normalizedAddress || a.inputAddress,
          score: a.prospectScore,
          roofType: a.roofType,
          condition: a.roofCondition,
        })),
      },
    }).where(eq(batchJobs.id, job.id));
  } catch (error) {
    console.error("Zip scan error:", error);
    res.status(500).json({ error: "Zip scan failed" });
  }
});

// GET /api/zip-scan/:id
router.get("/:id", async (req, res) => {
  try {
    const job = await db.query.batchJobs.findFirst({
      where: eq(batchJobs.id, req.params.id),
    });
    if (!job) { res.status(404).json({ error: "Scan not found" }); return; }

    const analyses = await db.query.propertyAnalyses.findMany({
      where: eq(propertyAnalyses.batchJobId, job.id),
      orderBy: desc(propertyAnalyses.prospectScore),
    });

    res.json({ ...job, results: analyses });
  } catch {
    res.status(500).json({ error: "Failed to fetch scan results" });
  }
});

export default router;
