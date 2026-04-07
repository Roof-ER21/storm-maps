import { Router } from "express";
import { eq } from "drizzle-orm";
import { db } from "../../db.js";
import { propertyAnalyses, propertyImages } from "../schema.js";
import { analyzeProperty } from "../services/propertyAnalyzer.js";
import { validate, analyzeSchema } from "../validation.js";

const router = Router();

const getConfig = () => ({
  googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY || "",
  geminiApiKey: process.env.GEMINI_API_KEY || "",
});

// Rate limiting (in-memory)
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();
function checkRateLimit(
  key: string,
  max: number,
  windowMs: number
): boolean {
  const now = Date.now();
  const record = rateLimitMap.get(key);
  if (!record || record.resetTime < now) {
    rateLimitMap.set(key, { count: 1, resetTime: now + windowMs });
    return true;
  }
  if (record.count >= max) return false;
  record.count++;
  return true;
}

// POST /api/analyze - Analyze a single address
router.post("/", validate(analyzeSchema), async (req, res) => {
  try {
    const { address, mode: analysisMode, force } = req.body;

    if (!checkRateLimit("global", 30, 60000)) {
      res.status(429).json({ error: "Rate limit exceeded. Try again in a minute." });
      return;
    }

    const config = getConfig();
    if (!config.googleMapsApiKey || !config.geminiApiKey) {
      res.status(500).json({ error: "API keys not configured" });
      return;
    }

    const result = await analyzeProperty(
      address.trim(),
      db,
      { ...config, cacheTtlDays: force ? 0 : undefined },
      analysisMode
    );
    res.json(result);
  } catch (error) {
    console.error("Analysis error:", error);
    res.status(500).json({
      error: "Analysis failed",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

// GET /api/analyze/:id - Get analysis by ID (with images)
router.get("/:id", async (req, res) => {
  try {
    const id = req.params.id as string;
    const [analysis, images] = await Promise.all([
      db.query.propertyAnalyses.findFirst({
        where: eq(propertyAnalyses.id, id),
      }),
      db.select().from(propertyImages).where(eq(propertyImages.analysisId, id)),
    ]);
    if (!analysis) {
      res.status(404).json({ error: "Analysis not found" });
      return;
    }
    res.json({ analysis, images: images || [] });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch analysis" });
  }
});

export default router;
