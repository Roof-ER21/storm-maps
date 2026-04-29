import { Router } from "express";
import { sql, desc, eq, inArray } from "drizzle-orm";
import { db } from "../../db.js";
import { propertyAnalyses, activityLog } from "../schema.js";
import { createBackup, getLatestBackup } from "../services/backupService.js";
import { optimizeRoute, type RoutePoint } from "../services/routeOptimizer.js";
import { getCacheStats, purgeExpiredCache } from "../services/enrichmentCache.js";

const router = Router();

interface DashboardOverviewRow {
  all_scans: number | string | null;
  completed: number | string | null;
  high_priority: number | string | null;
  aluminum_siding: number | string | null;
  today: number | string | null;
  roof_type_breakdown: Record<string, unknown> | null;
  lead_pipeline: Record<string, unknown> | null;
  activity_breakdown: Record<string, unknown> | null;
}

function countValue(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function normalizeCountMap(input: Record<string, unknown> | null | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(input ?? {})) {
    out[key] = countValue(value);
  }
  return out;
}

function errorCause(error: unknown): unknown {
  return (error as { cause?: unknown } | null)?.cause ?? error;
}

function dashboardErrorSummary(error: unknown): string {
  const causeValue = errorCause(error);
  const cause = (causeValue && typeof causeValue === "object" ? causeValue : {}) as {
    code?: unknown;
    errno?: unknown;
    address?: unknown;
    port?: unknown;
    message?: unknown;
  };
  const code = String(cause.code ?? cause.errno ?? "DB_ERROR");
  const address =
    typeof cause.address === "string"
      ? `${cause.address}${cause.port ? `:${cause.port}` : ""}`
      : "";
  const message =
    typeof cause.message === "string"
      ? cause.message
      : error instanceof Error
        ? error.message
        : String(error);
  return [code, address, message].filter(Boolean).join(" ");
}

function isDbConnectivityError(error: unknown): boolean {
  const summary = dashboardErrorSummary(error).toUpperCase();
  return (
    summary.includes("CONNECT_TIMEOUT") ||
    summary.includes("ETIMEDOUT") ||
    summary.includes("ECONNRESET") ||
    summary.includes("ECONNREFUSED") ||
    summary.includes("ENOTFOUND") ||
    summary.includes("EAI_AGAIN") ||
    summary.includes("CONNECTION TERMINATED")
  );
}

// GET /api/dashboard - Stats overview
router.get("/", async (_req, res) => {
  try {
    const overviewRows = await db.execute(sql`
      WITH
      stats AS (
        SELECT
          count(*)::int AS all_scans,
          count(*) FILTER (WHERE status = 'completed')::int AS completed,
          count(*) FILTER (WHERE is_high_priority = TRUE)::int AS high_priority,
          count(*) FILTER (WHERE is_aluminum_siding = TRUE)::int AS aluminum_siding,
          count(*) FILTER (WHERE created_at > now() - interval '24 hours')::int AS today
        FROM property_analyses
      ),
      roof AS (
        SELECT COALESCE(jsonb_object_agg(COALESCE(roof_type, 'unknown'), n), '{}'::jsonb) AS roof_type_breakdown
        FROM (
          SELECT roof_type, count(*)::int AS n
          FROM property_analyses
          WHERE status = 'completed'
          GROUP BY roof_type
        ) grouped_roofs
      ),
      pipeline AS (
        SELECT COALESCE(jsonb_object_agg(COALESCE(lead_status, 'new'), n), '{}'::jsonb) AS lead_pipeline
        FROM (
          SELECT lead_status, count(*)::int AS n
          FROM property_analyses
          WHERE status = 'completed'
          GROUP BY lead_status
        ) grouped_pipeline
      ),
      activity AS (
        SELECT COALESCE(jsonb_object_agg(action, n), '{}'::jsonb) AS activity_breakdown
        FROM (
          SELECT action, count(*)::int AS n
          FROM activity_log
          GROUP BY action
        ) grouped_activity
      )
      SELECT
        stats.all_scans,
        stats.completed,
        stats.high_priority,
        stats.aluminum_siding,
        stats.today,
        roof.roof_type_breakdown,
        pipeline.lead_pipeline,
        activity.activity_breakdown
      FROM stats
      CROSS JOIN roof
      CROSS JOIN pipeline
      CROSS JOIN activity
    `) as DashboardOverviewRow[];

    const overview = overviewRows[0] ?? {
      all_scans: 0,
      completed: 0,
      high_priority: 0,
      aluminum_siding: 0,
      today: 0,
      roof_type_breakdown: {},
      lead_pipeline: {},
      activity_breakdown: {},
    };

    const [recentActivity, topLeads, recentAnalyses] = await Promise.all([
      db.query.activityLog.findMany({
        orderBy: desc(activityLog.createdAt),
        limit: 20,
      }),
      db.query.propertyAnalyses.findMany({
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
      }),
      db.query.propertyAnalyses.findMany({
        where: eq(propertyAnalyses.status, "completed"),
        orderBy: desc(propertyAnalyses.createdAt),
        limit: 15,
        columns: {
          id: true,
          inputAddress: true,
          normalizedAddress: true,
          roofType: true,
          prospectScore: true,
          isHighPriority: true,
          isAluminumSiding: true,
          leadStatus: true,
          createdAt: true,
        },
      }),
    ]);

    // Estimate API cost: ~$0.01 per full analysis (Street View + Satellite + Gemini)
    const totalCompleted = countValue(overview.completed);
    const estimatedCost = (totalCompleted * 0.012).toFixed(2);

    // Enrichment data cache stats
    const cacheStats = await getCacheStats(db).catch(() => ({ totalEntries: 0, byType: {}, expiredCount: 0 }));

    // Image storage estimate
    const imageStats = await db.execute(
      sql`SELECT count(*) as count, COALESCE(sum(size_bytes), 0) as total_bytes FROM property_images`
    ).catch(() => [{ count: 0, total_bytes: 0 }]);

    const imgRows = imageStats as Array<{ count: number | string; total_bytes: number | string }>;
    const imageCount = Number(imgRows[0]?.count || 0);
    const imageSizeMB = (Number(imgRows[0]?.total_bytes || 0) / 1024 / 1024).toFixed(1);

    res.json({
      totals: {
        allScans: countValue(overview.all_scans),
        completed: totalCompleted,
        highPriority: countValue(overview.high_priority),
        aluminumSiding: countValue(overview.aluminum_siding),
        today: countValue(overview.today),
      },
      estimatedApiCost: `$${estimatedCost}`,
      roofTypeBreakdown: normalizeCountMap(overview.roof_type_breakdown),
      leadPipeline: normalizeCountMap(overview.lead_pipeline),
      topLeads,
      activityBreakdown: normalizeCountMap(overview.activity_breakdown),
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
      recentAnalyses,
    });
  } catch (error) {
    if (isDbConnectivityError(error)) {
      console.warn(`[dashboard] database temporarily unavailable: ${dashboardErrorSummary(error)}`);
      res.status(503).json({ error: "Dashboard temporarily unavailable" });
      return;
    }
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
    const _svResult = await db.execute(
      sql`UPDATE property_analyses
          SET street_view_url = '/api/images/streetview?lat=' || lat || '&lng=' || lng
          WHERE street_view_url LIKE 'https://maps.googleapis.com%'
            AND lat IS NOT NULL AND lng IS NOT NULL`
    );
    // Fix satellite URLs
    const _satResult = await db.execute(
      sql`UPDATE property_analyses
          SET satellite_url = '/api/images/satellite?lat=' || lat || '&lng=' || lng
          WHERE satellite_url LIKE 'https://maps.googleapis.com%'
            AND lat IS NOT NULL AND lng IS NOT NULL`
    );
    res.json({ fixed: true, message: "Image URLs migrated to proxy" });
  } catch {
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
