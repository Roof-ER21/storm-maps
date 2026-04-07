import { Router } from "express";
import { sql, desc, eq, inArray } from "drizzle-orm";
import { db } from "../../db.js";
import { propertyAnalyses, activityLog } from "../schema.js";
import { createBackup, getLatestBackup } from "../services/backupService.js";
import { optimizeRoute, type RoutePoint } from "../services/routeOptimizer.js";
import { getCacheStats, purgeExpiredCache } from "../services/enrichmentCache.js";

const router = Router();

// GET /api/dashboard - Stats overview
router.get("/", async (_req, res) => {
  try {
    const [totalResult, completedResult, highPriorityResult, aluminumResult, todayResult, roofBreakdown, modeBreakdown, recentActivity] = await Promise.all([
      db.select({ count: sql<number>`count(*)` }).from(propertyAnalyses),
      db.select({ count: sql<number>`count(*)` }).from(propertyAnalyses).where(eq(propertyAnalyses.status, "completed")),
      db.select({ count: sql<number>`count(*)` }).from(propertyAnalyses).where(eq(propertyAnalyses.isHighPriority, true)),
      db.select({ count: sql<number>`count(*)` }).from(propertyAnalyses).where(eq(propertyAnalyses.isAluminumSiding, true)),
      db.select({ count: sql<number>`count(*)` }).from(propertyAnalyses).where(
        sql`created_at > now() - interval '24 hours'`
      ),
      db.select({
        type: propertyAnalyses.roofType,
        count: sql<number>`count(*)`,
      }).from(propertyAnalyses).where(eq(propertyAnalyses.status, "completed")).groupBy(propertyAnalyses.roofType),
      db.select({
        action: activityLog.action,
        count: sql<number>`count(*)`,
      }).from(activityLog).groupBy(activityLog.action),
      db.query.activityLog.findMany({
        orderBy: desc(activityLog.createdAt),
        limit: 20,
      }),
    ]);

    // Estimate API cost: ~$0.01 per full analysis (Street View + Satellite + Gemini)
    const totalCompleted = Number(completedResult[0]?.count || 0);
    const estimatedCost = (totalCompleted * 0.012).toFixed(2);

    // Lead pipeline
    const pipelineResult = await db.select({
      status: propertyAnalyses.leadStatus,
      count: sql<number>`count(*)`,
    }).from(propertyAnalyses).where(eq(propertyAnalyses.status, "completed")).groupBy(propertyAnalyses.leadStatus);

    const pipeline: Record<string, number> = {};
    for (const row of pipelineResult) {
      pipeline[row.status || "new"] = Number(row.count);
    }

    // Top scoring leads
    const topLeads = await db.query.propertyAnalyses.findMany({
      where: eq(propertyAnalyses.isHighPriority, true),
      orderBy: desc(propertyAnalyses.prospectScore),
      limit: 5,
      columns: {
        id: true,
        inputAddress: true,
        normalizedAddress: true,
        roofType: true,
        prospectScore: true,
        isAluminumSiding: true,
        leadStatus: true,
      },
    });

    // Enrichment data cache stats
    const cacheStats = await getCacheStats(db).catch(() => ({ totalEntries: 0, byType: {}, expiredCount: 0 }));

    // Image storage estimate
    const imageStats = await db.execute(
      sql`SELECT count(*) as count, COALESCE(sum(size_bytes), 0) as total_bytes FROM property_images`
    ).catch(() => [{ count: 0, total_bytes: 0 }]);

    const imageCount = Number((imageStats as any)[0]?.count || 0);
    const imageSizeMB = (Number((imageStats as any)[0]?.total_bytes || 0) / 1024 / 1024).toFixed(1);

    res.json({
      totals: {
        allScans: Number(totalResult[0]?.count || 0),
        completed: totalCompleted,
        highPriority: Number(highPriorityResult[0]?.count || 0),
        aluminumSiding: Number(aluminumResult[0]?.count || 0),
        today: Number(todayResult[0]?.count || 0),
      },
      estimatedApiCost: `$${estimatedCost}`,
      roofTypeBreakdown: Object.fromEntries(
        roofBreakdown.map((r) => [r.type || "unknown", Number(r.count)])
      ),
      leadPipeline: pipeline,
      topLeads,
      activityBreakdown: Object.fromEntries(
        modeBreakdown.map((r) => [r.action, Number(r.count)])
      ),
      recentActivity: recentActivity.map((a) => ({
        action: a.action,
        details: a.details,
        createdAt: a.createdAt,
      })),
      storage: {
        images: imageCount,
        imageSizeMB,
      },
      enrichmentCache: cacheStats,
      lastBackup: getLatestBackup()?.result || null,
      recentAnalyses: (await db.query.propertyAnalyses.findMany({
        where: eq(propertyAnalyses.status, "completed"),
        orderBy: desc(propertyAnalyses.createdAt),
        limit: 15,
        columns: {
          id: true, inputAddress: true, normalizedAddress: true,
          roofType: true, prospectScore: true, isHighPriority: true,
          isAluminumSiding: true, leadStatus: true, createdAt: true,
        },
      })),
    });
  } catch (error) {
    console.error("Dashboard error:", error);
    res.status(500).json({ error: "Failed to load dashboard" });
  }
});

// POST /api/dashboard/backup - Trigger manual backup
router.post("/backup", async (_req, res) => {
  try {
    const { json, result } = await createBackup(db);
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", `attachment; filename=property-analyzer-backup-${result.timestamp.split("T")[0]}.json`);
    res.send(json);
  } catch {
    res.status(500).json({ error: "Backup failed" });
  }
});

// GET /api/dashboard/backup/info - Last backup info
router.get("/backup/info", (_req, res) => {
  const backup = getLatestBackup();
  if (!backup) {
    res.json({ status: "no_backup_yet" });
    return;
  }
  res.json(backup.result);
});

// POST /api/dashboard/fix-image-urls - Migrate old direct Google URLs to proxy URLs
router.post("/fix-image-urls", async (_req, res) => {
  try {
    // Fix street view URLs
    const svResult = await db.execute(
      sql`UPDATE property_analyses
          SET street_view_url = '/api/images/streetview?lat=' || lat || '&lng=' || lng
          WHERE street_view_url LIKE 'https://maps.googleapis.com%'
            AND lat IS NOT NULL AND lng IS NOT NULL`
    );
    // Fix satellite URLs
    const satResult = await db.execute(
      sql`UPDATE property_analyses
          SET satellite_url = '/api/images/satellite?lat=' || lat || '&lng=' || lng
          WHERE satellite_url LIKE 'https://maps.googleapis.com%'
            AND lat IS NOT NULL AND lng IS NOT NULL`
    );
    res.json({ fixed: true, message: "Image URLs migrated to proxy" });
  } catch (error) {
    res.status(500).json({ error: "Migration failed" });
  }
});

// POST /api/dashboard/optimize-route - Get optimized canvass order
router.post("/optimize-route", async (req, res) => {
  try {
    const { ids } = req.body; // array of analysis IDs to route

    if (!Array.isArray(ids) || ids.length === 0) {
      res.status(400).json({ error: "Array of property IDs required" });
      return;
    }

    const analyses = await db.query.propertyAnalyses.findMany({
      where: inArray(propertyAnalyses.id, ids),
    });

    const points: RoutePoint[] = analyses
      .filter((a) => a.lat && a.lng)
      .map((a) => ({
        id: a.id,
        lat: a.lat!,
        lng: a.lng!,
        address: a.normalizedAddress || a.inputAddress,
        score: a.prospectScore || 0,
      }));

    const route = optimizeRoute(points);
    res.json(route);
  } catch {
    res.status(500).json({ error: "Route optimization failed" });
  }
});

// POST /api/dashboard/optimize-batch/:batchId - Optimize all leads from a batch/zip-scan
router.post("/optimize-batch/:batchId", async (req, res) => {
  try {
    const analyses = await db.query.propertyAnalyses.findMany({
      where: eq(propertyAnalyses.batchJobId, req.params.batchId),
    });

    const points: RoutePoint[] = analyses
      .filter((a) => a.lat && a.lng && a.status === "completed" && (a.prospectScore || 0) >= 30)
      .map((a) => ({
        id: a.id,
        lat: a.lat!,
        lng: a.lng!,
        address: a.normalizedAddress || a.inputAddress,
        score: a.prospectScore || 0,
      }));

    if (points.length === 0) {
      res.json({ points: [], totalDistanceMiles: 0, estimatedWalkMinutes: 0, estimatedDriveMinutes: 0 });
      return;
    }

    const route = optimizeRoute(points);
    res.json(route);
  } catch {
    res.status(500).json({ error: "Route optimization failed" });
  }
});

// GET /api/dashboard/cache - Enrichment cache stats
router.get("/cache", async (_req, res) => {
  try {
    const stats = await getCacheStats(db);
    res.json(stats);
  } catch {
    res.status(500).json({ error: "Failed to get cache stats" });
  }
});

// POST /api/dashboard/cache/purge - Remove expired cache entries
router.post("/cache/purge", async (_req, res) => {
  try {
    const purged = await purgeExpiredCache(db);
    res.json({ purged, message: `Removed ${purged} expired cache entries` });
  } catch {
    res.status(500).json({ error: "Cache purge failed" });
  }
});

export default router;
