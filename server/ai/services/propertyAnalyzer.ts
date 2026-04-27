import { eq } from "drizzle-orm";
import type { DB } from "../../db.js";
import {
  propertyAnalyses,
  roofTypeEnum,
  sidingTypeEnum,
  conditionEnum,
} from "../schema.js";

type RoofType = typeof roofTypeEnum.enumValues[number];
type SidingType = typeof sidingTypeEnum.enumValues[number];
type Condition = typeof conditionEnum.enumValues[number];
import { geocodeAddress } from "./geocodingService.js";
import { fetchPropertyImages } from "./imageFetchService.js";
import { classifyPropertyAllModes } from "./aiClassificationService.js";
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
  computeAllModeScores,
  computeSolarEstimate,
  formatStormEventsForInsurance,
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
        // All modes are now stored in every analysis record — return cache for any mode.
        // The cacheTtlMs controls freshness (default 30 days) which covers storm data updates.
        if (isRecent) {
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

    // Always fetch storm + FEMA data — needed for all-mode scoring regardless of selected mode
    const [images, solarInsights, stormHistory, censusData, femaData, propertyData] = await Promise.all([
      fetchPropertyImages(geo.lat, geo.lng, config.googleMapsApiKey),
      getBuildingInsights(geo.lat, geo.lng, config.googleMapsApiKey).catch(
        () => null
      ),
      getStormHistory(geo.lat, geo.lng, 15, 3).catch(() => null),
      getCachedCensusData(geo.lat, geo.lng, db).catch(() => null),
      getCachedFemaData(geo.lat, geo.lng, geo.state, geo.city, db).catch(() => null),
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

    // 4. AI Classification — all 3 modes in one analysis pass
    await db
      .update(propertyAnalyses)
      .set({ status: "analyzing" })
      .where(eq(propertyAnalyses.id, record.id));

    // Build context string with geo, solar, storm, and property intel
    // Note: mode-specific instructions are handled inside classifyPropertyAllModes (Pass 3)
    const contextParts = [
      `Location: ${geo.city}, ${geo.state} ${geo.zip}`,
      solarInsights?.hasData
        ? `Google Solar API: roof pitch ${solarInsights.avgPitchDegrees}deg, ${solarInsights.segmentCount} segments, ${Math.round(solarInsights.totalRoofAreaMeters2)}m2, type=${solarInsights.roofType}`
        : null,
      solarInsights?.hasData && solarInsights.roofType === "flat"
        ? "CONSTRAINT: Solar API confirms FLAT roof (pitch <5deg)."
        : null,
      stormHistory?.summary ? `Storm history: ${stormHistory.summary}` : null,
      // Property records — used to cross-reference with visual estimates
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
    ].filter(Boolean);

    const addressWithContext = `${geo.normalizedAddress}. ${contextParts.join(". ")}`;

    const { base: classification, modeInsights } = await classifyPropertyAllModes(
      images.streetView,
      images.satellite,
      addressWithContext,
      config.geminiApiKey,
      images.streetViewAngles.length > 0
        ? images.streetViewAngles
        : undefined,
      images.satelliteCloseup
    );

    // 5. Score all 3 modes at once — use the user-selected mode as primary score
    const allModeScores = computeAllModeScores(
      classification,
      solarInsights,
      stormHistory,
      censusData,
      femaData,
      propertyData
    );
    const { score, isHighPriority } = allModeScores[mode];

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

    // 7. Store results — all 3 modes in aiRawResponse for instant frontend switching
    const formattedStormData = formatStormEventsForInsurance(stormHistory);

    // Shared enrichment data used across all modes
    const sharedSolarInsights = solarInsights?.hasData
      ? {
          roofAreaM2: Math.round(roofAreaM2),
          roofAreaSqFt: Math.round(roofAreaM2 * 10.764),
          roofSquares: areaToSquares(roofAreaM2),
          avgPitchDegrees: solarInsights.avgPitchDegrees,
          avgPitch: degreesToPitch(solarInsights.avgPitchDegrees),
          segmentCount: solarInsights.segmentCount,
          measuredRoofType: solarInsights.roofType,
        }
      : null;

    const sharedPropertyIntel = {
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
    };

    await db
      .update(propertyAnalyses)
      .set({
        roofType: classification.roofType as RoofType,
        roofCondition: classification.roofCondition as Condition,
        roofAgeEstimate: classification.roofAgeEstimate,
        roofConfidence: classification.roofConfidence,
        roofColor: classification.roofColor,
        isAluminumSiding: classification.isAluminumSiding,
        sidingType: classification.sidingType as SidingType,
        sidingCondition: classification.sidingCondition as Condition,
        sidingConfidence: classification.sidingConfidence,
        roofFeatures: classification.roofFeatures,
        sidingFeatures: classification.sidingFeatures,
        reasoning: classification.reasoning,
        damageIndicators: classification.damageIndicators,
        prospectScore: score,
        isHighPriority,
        aiRawResponse: {
          // Base classification (shared across all modes)
          ...classification,
          // Which mode was selected when this analysis was requested
          requestedMode: mode,
          // Per-mode scores — frontend uses these to display score when user switches
          modeScores: {
            retail: allModeScores.retail.score,
            insurance: allModeScores.insurance.score,
            solar: allModeScores.solar.score,
          },
          modeHighPriority: {
            retail: allModeScores.retail.isHighPriority,
            insurance: allModeScores.insurance.isHighPriority,
            solar: allModeScores.solar.isHighPriority,
          },
          // Per-mode AI insights — keyed so frontend can switch instantly
          modes: {
            retail: {
              score: allModeScores.retail.score,
              isHighPriority: allModeScores.retail.isHighPriority,
              insights: modeInsights.retail,
            },
            insurance: {
              score: allModeScores.insurance.score,
              isHighPriority: allModeScores.insurance.isHighPriority,
              insights: modeInsights.insurance,
              // Full storm event history for insurance view
              stormEvents: formattedStormData.stormEvents,
              claimWindow: formattedStormData.claimWindow,
              qualifyingEvents: formattedStormData.qualifyingEvents,
              hasRecentHail: formattedStormData.hasRecentHail,
              largestHailInches: formattedStormData.largestHailInches,
              maxWindMph: formattedStormData.maxWindMph,
              lastStormDate: formattedStormData.lastStormDate,
            },
            solar: {
              score: allModeScores.solar.score,
              isHighPriority: allModeScores.solar.isHighPriority,
              insights: modeInsights.solar,
              solarEstimate,
            },
          },
          // Shared data (available regardless of mode)
          solarInsights: sharedSolarInsights,
          costEstimate,
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
          propertyIntel: sharedPropertyIntel,
        },
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
