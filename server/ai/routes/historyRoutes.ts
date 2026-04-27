import { Router } from "express";
import { desc, eq, sql } from "drizzle-orm";
import { db } from "../../db.js";
import { propertyAnalyses, roofTypeEnum } from "../schema.js";

type RoofType = typeof roofTypeEnum.enumValues[number];

const router = Router();

// GET /api/history - Paginated history with filters
router.get("/", async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
    const offset = (page - 1) * limit;
    const highPriorityOnly = req.query.highPriority === "true";
    const roofType = req.query.roofType as string;
    const aluminumOnly = req.query.aluminum === "true";

    const conditions = [eq(propertyAnalyses.status, "completed")];
    if (highPriorityOnly) {
      conditions.push(eq(propertyAnalyses.isHighPriority, true));
    }
    if (roofType) {
      conditions.push(eq(propertyAnalyses.roofType, roofType as RoofType));
    }
    if (aluminumOnly) {
      conditions.push(eq(propertyAnalyses.isAluminumSiding, true));
    }

    const where =
      conditions.length === 1
        ? conditions[0]
        : sql`${conditions.map((c) => sql`(${c})`).reduce((a, b) => sql`${a} AND ${b}`)}`;

    const [results, countResult] = await Promise.all([
      db.query.propertyAnalyses.findMany({
        where,
        orderBy: desc(propertyAnalyses.createdAt),
        limit,
        offset,
      }),
      db
        .select({ count: sql<number>`count(*)` })
        .from(propertyAnalyses)
        .where(where),
    ]);

    const total = Number(countResult[0]?.count || 0);

    res.json({
      results,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("History error:", error);
    res.status(500).json({ error: "Failed to fetch history" });
  }
});

export default router;
