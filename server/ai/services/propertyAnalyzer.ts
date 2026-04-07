import { eq } from "drizzle-orm";
import type { DB } from "../../db.js";
import { propertyAnalyses } from "../schema.js";
import { geocodeAddress } from "./geocodingService.js";
import { fetchPropertyImages } from "./imageFetchService.js";
import { classifyProperty } from "./aiClassificationService.js";
import {
  getBuildingInsights,
  estimateReplacementCost,
  areaToSquares,
  degreesToPitch,
} from "./solarApiService.js";
import { getStormHistory } from "./stormDataService.js";
import {
  getCachedCensusData,
  getCachedFemaData,
  getCachedPropertyData,
} from "./enrichmentCache.js";
import {
  type AnalysisMode,
  MODE_PROMPTS,
  computeProspectScore,
  computeSolarEstimate,
} from "./analysisMode.js";
import { storeImages, type ImageToStore } from "./imageStorageService.js";
import { logActivity } from "./activityLogger.js";

interface AnalyzerConfig {
  googleMapsApiKey: string;
  geminiApiKey: string;
  cacheTtlDays?: number;
}

export async function analyzeProperty(
  address: string,
  db: DB,
  config: AnalyzerConfig,
  mode: AnalysisMode = "retail",
  batchJobId?: string
): Promise<typeof propertyAnalyses.$inferSelect> {
  const cacheTtlMs = (config.cacheTtlDays ?? 30) * 24 * 60 * 60 * 1000;

  // 1. Create pending record
  const [record] = await db
    .insert(propertyAnalyses)
    .values({
      inputAddress: address,
      status: "pending",
      batchJobId: batchJobId || null,
    })
    .returning();

  try {
    // 2. Geocode
    await db
      .update(propertyAnalyses)
      .set({ status: "geocoding" })
      .where(eq(propertyAnalyses.id, record.id));

    const geo = await geocodeAddress(address, config.googleMapsApiKey);
    if (!geo) {
      await db
        .update(propertyAnalyses)
        .set({ status: "failed", errorMessage: "Could not geocode address" })
        .where(eq(propertyAnalyses.id, record.id));
      return (await db.query.propertyAnalyses.findFirst({
        where: eq(propertyAnalyses.id, record.id),
      }))!;
    }

    // Check cache — return existing analysis if recent enough
    if (geo.placeId) {
      const cached = await db.query.propertyAnalyses.findFirst({
        where: eq(propertyAnalyses.placeId, geo.placeId),
      });
      if (cached) {
        const isRecent = cached.analyzedAt && Date.now() - cached.analyzedAt.getTime() < cacheTtlMs;
        // Insurance mode always re-analyzes (storm data changes), others use cache
        if (isRecent && mode !== "insurance") {
          await db
            .delete(propertyAnalyses)
            .where(eq(propertyAnalyses.id, record.id));
          return cached;
        }
        // Delete old record to avoid place_id unique constraint violation
        await db
          .delete(propertyAnalyses)
          .where(eq(propertyAnalyses.id, cached.id));
      }
    }

    await db
      .update(propertyAnalyses)
      .set({
        normalizedAddress: geo.normalizedAddress,
        lat: geo.lat,
        lng: geo.lng,
        placeId: geo.placeId,
      })
      .where(eq(propertyAnalyses.id, record.id));

    // 3. Fetch images + Solar API + Storm data in parallel
    await db
      .update(propertyAnalyses)
      .set({ status: "fetching_images" })
      .where(eq(propertyAnalyses.id, record.id));

    const [images, solarInsights, stormHistory, censusData, femaData, propertyData] = await Promise.all([
      fetchPropertyImages(geo.lat, geo.lng, config.googleMapsApiKey),
      getBuildingInsights(geo.lat, geo.lng, config.googleMapsApiKey).catch(
        () => null
      ),
      mode === "insurance"
        ? getStormHistory(geo.lat, geo.lng, 15, 3).catch(() => null)
        : Promise.resolve(null),
      getCachedCensusData(geo.lat, geo.lng, db).catch(() => null),
      mode === "insurance"
        ? getCachedFemaData(geo.lat, geo.lng, geo.state, geo.city, db).catch(() => null)
        : Promise.resolve(null),
      getCachedPropertyData(geo.lat, geo.lng, geo.normalizedAddress, db).catch(() => null),
    ]);

    // Build display URLs
    let displayStreetViewUrl: string | null = null;
    if (images.streetViewAvailable) {
      displayStreetViewUrl = `/api/images/streetview?lat=${geo.lat}&lng=${geo.lng}`;
    }
    let displaySatelliteUrl: string | null = null;
    if (images.satellite) {
      displaySatelliteUrl = `/api/images/satellite?lat=${geo.lat}&lng=${geo.lng}`;
    }

    await db
      .update(propertyAnalyses)
      .set({
        streetViewUrl: displayStreetViewUrl,
        satelliteUrl: displaySatelliteUrl,
        streetViewAvailable: images.streetViewAvailable,
        streetViewDate: images.streetViewDate,
      })
      .where(eq(propertyAnalyses.id, record.id));

    // Store images permanently (background, don't block)
    const imagesToStore: ImageToStore[] = [];
    for (const angle of images.streetViewAngles) {
      imagesToStore.push({
        imageType: `streetview_${angle.label}`,
        buffer: angle.buffer,
        mimeType: "image/jpeg",
        captureDate: images.streetViewDate,
        lat: geo.lat,
        lng: geo.lng,
      });
    }
    if (images.satellite) {
      imagesToStore.push({
        imageType: "satellite",
        buffer: images.satellite,
        mimeType: "image/png",
        lat: geo.lat,
        lng: geo.lng,
      });
    }
    if (images.satelliteCloseup) {
      imagesToStore.push({
        imageType: "satellite_closeup",
        buffer: images.satelliteCloseup,
        mimeType: "image/png",
        lat: geo.lat,
        lng: geo.lng,
      });
    }
    // Fire and forget — don't await
    storeImages(record.id, imagesToStore, db).catch(() => {});

    if (
      images.streetViewAngles.length === 0 &&
      !images.streetView &&
      !images.satellite
    ) {
      await db
        .update(propertyAnalyses)
        .set({
          status: "failed",
          errorMessage: "No images available for this location",
        })
        .where(eq(propertyAnalyses.id, record.id));
      return (await db.query.propertyAnalyses.findFirst({
        where: eq(propertyAnalyses.id, record.id),
      }))!;
    }

    // 4. AI Classification with mode-specific prompt
    await db
      .update(propertyAnalyses)
      .set({ status: "analyzing" })
      .where(eq(propertyAnalyses.id, record.id));

    // Build context string with geo, solar, storm, property intel, and mode info
    const contextParts = [
      `Location: ${geo.city}, ${geo.state} ${geo.zip}`,
      solarInsights?.hasData
        ? `Google Solar API: roof pitch ${solarInsights.avgPitchDegrees}deg, ${solarInsights.segmentCount} segments, ${Math.round(solarInsights.totalRoofAreaMeters2)}m2, type=${solarInsights.roofType}`
        : null,
      solarInsights?.hasData && solarInsights.roofType === "flat"
        ? "CONSTRAINT: Solar API confirms FLAT roof (pitch <5deg)."
        : null,
      stormHistory?.summary ? `Storm history: ${stormHistory.summary}` : null,
      // Property records — use to cross-reference with visual estimates
      propertyData?.hasData
        ? [
            `Property records:`,
            propertyData.yearBuilt ? `year built=${propertyData.yearBuilt}` : null,
            propertyData.buildingSqFt ? `building=${propertyData.buildingSqFt}sqft` : null,
            propertyData.assessedValue ? `assessed=$${propertyData.assessedValue.toLocaleString()}` : null,
            propertyData.marketValue ? `market=$${propertyData.marketValue.toLocaleString()}` : null,
            propertyData.lastSalePrice ? `last sale=$${propertyData.lastSalePrice.toLocaleString()} (${propertyData.lastSaleDate})` : null,
            propertyData.propertyClass ? `type=${propertyData.propertyClass}` : null,
          ].filter(Boolean).join(", ")
        : null,
      propertyData?.yearBuilt
        ? `CROSS-REFERENCE: Records show year built ${propertyData.yearBuilt}. Use this to calibrate your roof age estimate — if the home was built in ${propertyData.yearBuilt} and the roof looks original, estimate age as ${new Date().getFullYear() - propertyData.yearBuilt} years.`
        : null,
      propertyData?.buildingMaterial || propertyData?.roofShape
        ? `OSM building data: ${[propertyData.buildingMaterial ? `wall material=${propertyData.buildingMaterial}` : null, propertyData.roofShape ? `roof shape=${propertyData.roofShape}` : null, propertyData.buildingLevels ? `${propertyData.buildingLevels} stories` : null].filter(Boolean).join(", ")}`
        : null,
      // Census neighborhood income
      censusData?.hasData
        ? `Neighborhood: median household income $${censusData.medianHouseholdIncome?.toLocaleString() || "N/A"}, ${censusData.ownerOccupiedPct || "?"}% owner-occupied, median home value $${censusData.medianHomeValue?.toLocaleString() || "N/A"}, median year built ${censusData.medianYearBuilt || "N/A"}`
        : null,
      // FEMA flood/disaster
      femaData?.hasFloodData && femaData.floodZone
        ? `FEMA flood zone: ${femaData.floodZone.zone} (${femaData.floodZone.zoneLabel})${femaData.floodZone.isHighRisk ? " — HIGH FLOOD RISK" : ""}`
        : null,
      femaData?.hasDisasterData
        ? `FEMA disasters: ${femaData.disasterSummary}`
        : null,
      MODE_PROMPTS[mode], // mode-specific instructions
    ].filter(Boolean);

    const addressWithContext = `${geo.normalizedAddress}. ${contextParts.join(". ")}`;

    const classification = await classifyProperty(
      images.streetView,
      images.satellite,
      addressWithContext,
      config.geminiApiKey,
      images.streetViewAngles.length > 0
        ? images.streetViewAngles
        : undefined,
      images.satelliteCloseup
    );

    // 5. Mode-specific scoring (with enriched data)
    const { score, isHighPriority } = computeProspectScore(
      classification,
      mode,
      solarInsights,
      stormHistory,
      censusData,
      femaData,
      propertyData
    );

    // 6. Compute extras — detailed cost estimate with regional rates, pitch, waste
    const roofAreaM2 = solarInsights?.totalRoofAreaMeters2 || 0;
    const costEstimate = estimateReplacementCost(
      roofAreaM2,
      classification.roofType,
      solarInsights?.avgPitchDegrees,
      solarInsights?.segmentCount,
      geo.state
    );
    const solarEstimate =
      mode === "solar" && solarInsights
        ? computeSolarEstimate(solarInsights, geo.state)
        : null;

    // 7. Store results
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
        isHighPriority,
        aiRawResponse: {
          ...classification,
          mode,
          solarInsights: solarInsights?.hasData
            ? {
                roofAreaM2: Math.round(roofAreaM2),
                roofAreaSqFt: Math.round(roofAreaM2 * 10.764),
                roofSquares: areaToSquares(roofAreaM2),
                avgPitchDegrees: solarInsights.avgPitchDegrees,
                avgPitch: degreesToPitch(solarInsights.avgPitchDegrees),
                segmentCount: solarInsights.segmentCount,
                measuredRoofType: solarInsights.roofType,
              }
            : null,
          costEstimate,
          solarEstimate,
          stormHistory: stormHistory
            ? {
                summary: stormHistory.summary,
                qualifyingEvent: stormHistory.qualifyingEvent,
                hasRecentHail: stormHistory.hasRecentHail,
                largestHailInches: stormHistory.largestHailInches,
                maxWindMph: stormHistory.maxWindMph,
                lastStormDate: stormHistory.lastStormDate,
                eventCount: stormHistory.events.length,
                claimWindow: stormHistory.claimWindow,
                events: stormHistory.events.slice(0, 10).map((e) => ({
                  date: e.date,
                  type: e.type,
                  magnitude: e.magnitude,
                  location: e.location,
                  distanceMiles: e.distanceMiles,
                  source: e.source,
                })),
              }
            : null,
          // New data enrichment
          propertyIntel: {
            property: propertyData?.hasData
              ? {
                  ownerName: propertyData.ownerName,
                  mailingAddress: propertyData.mailingAddress,
                  assessedValue: propertyData.assessedValue,
                  marketValue: propertyData.marketValue,
                  yearBuilt: propertyData.yearBuilt,
                  lotSizeSqFt: propertyData.lotSizeSqFt,
                  lotSizeAcres: propertyData.lotSizeAcres,
                  buildingSqFt: propertyData.buildingSqFt,
                  bedrooms: propertyData.bedrooms,
                  bathrooms: propertyData.bathrooms,
                  propertyClass: propertyData.propertyClass,
                  lastSaleDate: propertyData.lastSaleDate,
                  lastSalePrice: propertyData.lastSalePrice,
                  taxAmount: propertyData.taxAmount,
                  buildingLevels: propertyData.buildingLevels,
                  buildingMaterial: propertyData.buildingMaterial,
                  roofShape: propertyData.roofShape,
                  dataSource: propertyData.dataSource,
                }
              : null,
            census: censusData?.hasData
              ? {
                  medianHouseholdIncome: censusData.medianHouseholdIncome,
                  medianHomeValue: censusData.medianHomeValue,
                  ownerOccupiedPct: censusData.ownerOccupiedPct,
                  medianYearBuilt: censusData.medianYearBuilt,
                  totalHousingUnits: censusData.totalHousingUnits,
                  fipsTract: `${censusData.fipsState}-${censusData.fipsCounty}-${censusData.fipsTract}`,
                }
              : null,
            fema: {
              floodZone: femaData?.floodZone || null,
              recentDisasters: femaData?.recentDisasters?.slice(0, 5) || [],
              disasterSummary: femaData?.disasterSummary || null,
            },
          },
        } as any,
        aiModelUsed: classification.modelUsed,
        status: "completed",
        analyzedAt: new Date(),
      })
      .where(eq(propertyAnalyses.id, record.id));

    // Log activity
    logActivity(db, "search", {
      address,
      mode,
      roofType: classification.roofType,
      score,
      imagesStored: imagesToStore.length,
    }, record.id).catch(() => {});

    return (await db.query.propertyAnalyses.findFirst({
      where: eq(propertyAnalyses.id, record.id),
    }))!;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    await db
      .update(propertyAnalyses)
      .set({ status: "failed", errorMessage: message })
      .where(eq(propertyAnalyses.id, record.id));
    return (await db.query.propertyAnalyses.findFirst({
      where: eq(propertyAnalyses.id, record.id),
    }))!;
  }
}
