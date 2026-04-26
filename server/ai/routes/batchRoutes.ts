import { Router } from "express";
import { eq, desc } from "drizzle-orm";
import multer from "multer";
import { db } from "../../db.js";
import { batchJobs, propertyAnalyses } from "../schema.js";
import { analyzeProperty } from "../services/propertyAnalyzer.js";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

const getConfig = () => ({
  googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY || "",
  geminiApiKey: process.env.GEMINI_API_KEY || "",
});

function parseCSV(content: string): string[] {
  const lines = content.trim().split("\n");
  if (lines.length < 2) return [];

  const header = lines[0].toLowerCase();
  const cols = header.split(",").map((c) => c.trim().replace(/"/g, ""));

  // Find the address column
  const addressIdx = cols.findIndex(
    (c) =>
      c === "address" ||
      c === "street_address" ||
      c === "property_address" ||
      c === "full_address" ||
      c.includes("address")
  );

  // If no obvious address column, use the first column
  const idx = addressIdx >= 0 ? addressIdx : 0;

  const addresses: string[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Simple CSV parse (handles quoted fields)
    const fields: string[] = [];
    let current = "";
    let inQuote = false;
    for (const ch of line) {
      if (ch === '"') {
        inQuote = !inQuote;
      } else if (ch === "," && !inQuote) {
        fields.push(current.trim());
        current = "";
      } else {
        current += ch;
      }
    }
    fields.push(current.trim());

    const addr = fields[idx]?.replace(/^"|"$/g, "").trim();
    if (addr && addr.length >= 5) {
      addresses.push(addr);
    }
  }
  return addresses;
}

// POST /api/batch - Upload CSV and start batch processing
router.post("/", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: "CSV file is required" });
      return;
    }

    const content = req.file.buffer.toString("utf-8");
    const addresses = parseCSV(content);
    const batchMode = (["retail", "insurance", "solar"].includes(req.body.mode) ? req.body.mode : "retail") as "retail" | "insurance" | "solar";

    if (addresses.length === 0) {
      res.status(400).json({ error: "No valid addresses found in CSV" });
      return;
    }

    if (addresses.length > 500) {
      res.status(400).json({ error: "Maximum 500 addresses per batch" });
      return;
    }

    const config = getConfig();
    if (!config.googleMapsApiKey || !config.geminiApiKey) {
      res.status(500).json({ error: "API keys not configured" });
      return;
    }

    // Create batch job
    const [job] = await db
      .insert(batchJobs)
      .values({
        fileName: req.file.originalname,
        totalAddresses: addresses.length,
        status: "processing",
        startedAt: new Date(),
      })
      .returning();

    // Return immediately, process in background
    res.json({
      jobId: job.id,
      totalAddresses: addresses.length,
      status: "processing",
    });

    // Process addresses (3 concurrent max with delay)
    const CONCURRENT = 3;
    const DELAY_MS = 500;
    let processed = 0;
    let success = 0;
    let failed = 0;

    for (let i = 0; i < addresses.length; i += CONCURRENT) {
      const batch = addresses.slice(i, i + CONCURRENT);
      const results = await Promise.allSettled(
        batch.map((addr) => analyzeProperty(addr, db, config, batchMode, job.id))
      );

      for (const r of results) {
        processed++;
        if (r.status === "fulfilled" && r.value.status === "completed") {
          success++;
        } else {
          failed++;
        }
      }

      await db
        .update(batchJobs)
        .set({ processedCount: processed, successCount: success, failedCount: failed })
        .where(eq(batchJobs.id, job.id));

      if (i + CONCURRENT < addresses.length) {
        await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
      }
    }

    // Mark complete
    await db
      .update(batchJobs)
      .set({
        status: "completed",
        completedAt: new Date(),
        processedCount: processed,
        successCount: success,
        failedCount: failed,
      })
      .where(eq(batchJobs.id, job.id));
  } catch (error) {
    console.error("Batch error:", error);
    res.status(500).json({ error: "Batch processing failed" });
  }
});

// GET /api/batch/:id - Get batch job status
router.get("/:id", async (req, res) => {
  try {
    const job = await db.query.batchJobs.findFirst({
      where: eq(batchJobs.id, req.params.id),
    });
    if (!job) {
      res.status(404).json({ error: "Batch job not found" });
      return;
    }

    const analyses = await db.query.propertyAnalyses.findMany({
      where: eq(propertyAnalyses.batchJobId, job.id),
      orderBy: desc(propertyAnalyses.createdAt),
    });

    res.json({ ...job, results: analyses });
  } catch {
    res.status(500).json({ error: "Failed to fetch batch status" });
  }
});

// GET /api/batch/:id/export - Export batch results as CSV
router.get("/:id/export", async (req, res) => {
  try {
    const analyses = await db.query.propertyAnalyses.findMany({
      where: eq(propertyAnalyses.batchJobId, req.params.id),
    });

    const headers = [
      "Address",
      "Roof Type",
      "Roof Condition",
      "Roof Age (yrs)",
      "Roof Color",
      "Roof Confidence",
      "Siding Type",
      "Aluminum Siding",
      "Siding Condition",
      "Siding Confidence",
      "Prospect Score",
      "High Priority",
      "Damage",
      "Status",
    ];

    const rows = analyses.map((a) => [
      `"${(a.normalizedAddress || a.inputAddress).replace(/"/g, '""')}"`,
      a.roofType || "",
      a.roofCondition || "",
      a.roofAgeEstimate || "",
      a.roofColor || "",
      a.roofConfidence?.toFixed(2) || "",
      a.sidingType || "",
      a.isAluminumSiding ? "YES" : "NO",
      a.sidingCondition || "",
      a.sidingConfidence?.toFixed(2) || "",
      a.prospectScore || "",
      a.isHighPriority ? "YES" : "NO",
      Array.isArray(a.damageIndicators)
        ? (a.damageIndicators as any[]).map((d: any) => d.type).join("; ")
        : "",
      a.status || "",
    ]);

    const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join(
      "\n"
    );

    res.setHeader("Content-Type", "text/csv");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=property-analysis-${req.params.id}.csv`
    );
    res.send(csv);
  } catch {
    res.status(500).json({ error: "Export failed" });
  }
});

export default router;
