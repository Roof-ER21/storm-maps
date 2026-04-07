import { Router } from "express";
import { eq, desc, and, sql } from "drizzle-orm";
import { db } from "../../db.js";
import { propertyAnalyses } from "../schema.js";
import { logActivity } from "../services/activityLogger.js";
import { validate, leadStatusSchema, leadNotesSchema, correctionSchema } from "../validation.js";

const router = Router();

const VALID_ROOF_TYPES = [
  "three_tab_shingle", "architectural_shingle", "designer_shingle",
  "wood_shake", "synthetic_shake", "metal_standing_seam", "metal_ribbed",
  "tile_clay", "tile_concrete", "slate", "flat_membrane", "unknown",
];
const VALID_SIDING_TYPES = [
  "aluminum", "vinyl", "wood", "fiber_cement", "brick", "stone",
  "stucco", "composite", "unknown",
];
const VALID_CONDITIONS = [
  "excellent", "good", "fair", "poor", "critical", "unknown",
];

const VALID_STATUSES = [
  "new",
  "knocked",
  "not_home",
  "callback",
  "pitched",
  "sold",
  "skip",
];

// PATCH /api/leads/:id/star - Toggle star
router.patch("/:id/star", async (req, res) => {
  try {
    const current = await db.query.propertyAnalyses.findFirst({
      where: eq(propertyAnalyses.id, req.params.id as string),
    });
    if (!current) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    await db
      .update(propertyAnalyses)
      .set({ starred: !current.starred })
      .where(eq(propertyAnalyses.id, req.params.id as string));

    logActivity(db, "star", { starred: !current.starred }, req.params.id as string, req.ip).catch(() => {});
    res.json({ starred: !current.starred });
  } catch {
    res.status(500).json({ error: "Failed to update" });
  }
});

// PATCH /api/leads/:id/status - Update lead status
router.patch("/:id/status", validate(leadStatusSchema), async (req, res) => {
  try {
    const { status } = req.body;

    await db
      .update(propertyAnalyses)
      .set({
        leadStatus: status,
        lastContactedAt:
          status !== "new" && status !== "skip" ? new Date() : undefined,
      })
      .where(eq(propertyAnalyses.id, req.params.id as string));

    logActivity(db, "status_change", { status }, req.params.id as string, req.ip).catch(() => {});
    res.json({ status });
  } catch {
    res.status(500).json({ error: "Failed to update" });
  }
});

// PATCH /api/leads/:id/notes - Update rep notes
router.patch("/:id/notes", async (req, res) => {
  try {
    const { notes } = req.body;
    await db
      .update(propertyAnalyses)
      .set({ repNotes: notes || null })
      .where(eq(propertyAnalyses.id, req.params.id as string));

    res.json({ notes });
  } catch {
    res.status(500).json({ error: "Failed to update" });
  }
});

// GET /api/leads - Get leads with filters
router.get("/", async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, parseInt(req.query.limit as string) || 25);
    const offset = (page - 1) * limit;
    const starredOnly = req.query.starred === "true";
    const statusFilter = req.query.status as string;
    const highPriorityOnly = req.query.highPriority === "true";

    const conditions = [eq(propertyAnalyses.status, "completed")];
    if (starredOnly) conditions.push(eq(propertyAnalyses.starred, true));
    if (statusFilter && VALID_STATUSES.includes(statusFilter))
      conditions.push(eq(propertyAnalyses.leadStatus, statusFilter));
    if (highPriorityOnly)
      conditions.push(eq(propertyAnalyses.isHighPriority, true));

    const where = and(...conditions);

    const [results, countResult] = await Promise.all([
      db.query.propertyAnalyses.findMany({
        where,
        orderBy: desc(propertyAnalyses.prospectScore),
        limit,
        offset,
      }),
      db
        .select({ count: sql<number>`count(*)` })
        .from(propertyAnalyses)
        .where(where!),
    ]);

    const total = Number(countResult[0]?.count || 0);

    // Stats
    const statsResult = await db
      .select({
        status: propertyAnalyses.leadStatus,
        count: sql<number>`count(*)`,
      })
      .from(propertyAnalyses)
      .where(eq(propertyAnalyses.status, "completed"))
      .groupBy(propertyAnalyses.leadStatus);

    const statusCounts: Record<string, number> = {};
    for (const row of statsResult) {
      statusCounts[row.status || "new"] = Number(row.count);
    }

    res.json({
      results,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      statusCounts,
    });
  } catch (error) {
    console.error("Leads error:", error);
    res.status(500).json({ error: "Failed to fetch leads" });
  }
});

// PATCH /api/leads/:id/correct - Rep corrects AI classification
router.patch("/:id/correct", async (req, res) => {
  try {
    const { roofType, sidingType, roofCondition, sidingCondition, isAluminumSiding, roofAgeEstimate } = req.body;

    const updates: Record<string, any> = {};
    if (roofType && VALID_ROOF_TYPES.includes(roofType)) updates.roofType = roofType;
    if (sidingType && VALID_SIDING_TYPES.includes(sidingType)) updates.sidingType = sidingType;
    if (roofCondition && VALID_CONDITIONS.includes(roofCondition)) updates.roofCondition = roofCondition;
    if (sidingCondition && VALID_CONDITIONS.includes(sidingCondition)) updates.sidingCondition = sidingCondition;
    if (typeof isAluminumSiding === "boolean") updates.isAluminumSiding = isAluminumSiding;
    if (typeof roofAgeEstimate === "number" && roofAgeEstimate >= 0) updates.roofAgeEstimate = roofAgeEstimate;

    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: "No valid corrections provided" });
      return;
    }

    // Store original AI response for training data
    const current = await db.query.propertyAnalyses.findFirst({
      where: eq(propertyAnalyses.id, req.params.id as string),
    });
    if (!current) { res.status(404).json({ error: "Not found" }); return; }

    const aiResponse = (current.aiRawResponse || {}) as any;
    aiResponse._corrections = aiResponse._corrections || [];
    aiResponse._corrections.push({
      timestamp: new Date().toISOString(),
      before: {
        roofType: current.roofType,
        sidingType: current.sidingType,
        roofCondition: current.roofCondition,
        sidingCondition: current.sidingCondition,
        isAluminumSiding: current.isAluminumSiding,
        roofAgeEstimate: current.roofAgeEstimate,
      },
      after: updates,
    });

    await db
      .update(propertyAnalyses)
      .set({ ...updates, aiRawResponse: aiResponse })
      .where(eq(propertyAnalyses.id, req.params.id as string));

    res.json({ corrected: updates, id: req.params.id as string });
  } catch {
    res.status(500).json({ error: "Failed to save correction" });
  }
});

// GET /api/leads/:id/report - Generate printable HTML report
router.get("/:id/report", async (req, res) => {
  try {
    const analysis = await db.query.propertyAnalyses.findFirst({
      where: eq(propertyAnalyses.id, req.params.id as string),
    });
    if (!analysis) { res.status(404).json({ error: "Not found" }); return; }

    const ai = (analysis.aiRawResponse || {}) as any;
    const solar = ai.solarInsights;
    const cost = ai.costEstimate;
    const roofLabel: Record<string, string> = {
      three_tab_shingle: "3-Tab Shingle", architectural_shingle: "Architectural Shingle",
      designer_shingle: "Designer/Luxury", wood_shake: "Wood Shake",
      metal_standing_seam: "Metal Standing Seam", tile_clay: "Clay Tile",
      tile_concrete: "Concrete Tile", slate: "Slate", flat_membrane: "Flat/Membrane",
    };

    const proto = req.headers["x-forwarded-proto"] || req.protocol || "https";
    const host = req.headers["x-forwarded-host"] || req.headers.host || "localhost:3100";
    const baseUrl = `${proto}://${host}`;

    // Convert relative image URLs to absolute for the standalone report page
    const svUrl = analysis.streetViewUrl?.startsWith("/")
      ? `${baseUrl}${analysis.streetViewUrl}`
      : analysis.streetViewUrl;
    const satUrl = analysis.satelliteUrl?.startsWith("/")
      ? `${baseUrl}${analysis.satelliteUrl}`
      : analysis.satelliteUrl;

    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Property Report - ${analysis.normalizedAddress || analysis.inputAddress}</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:system-ui,-apple-system,sans-serif;color:#1e293b;max-width:800px;margin:0 auto;padding:20px}
  .header{text-align:center;border-bottom:3px solid #1e40af;padding-bottom:16px;margin-bottom:20px}
  .header h1{font-size:22px;color:#1e40af}
  .header .address{font-size:16px;color:#475569;margin-top:4px}
  .header .date{font-size:12px;color:#94a3b8;margin-top:4px}
  .images{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:16px}
  .images img{width:100%;height:200px;object-fit:cover;border-radius:8px;border:1px solid #e2e8f0}
  .score-bar{display:flex;align-items:center;justify-content:space-between;background:#f1f5f9;border-radius:8px;padding:16px;margin-bottom:16px}
  .score{font-size:36px;font-weight:800;color:${(analysis.prospectScore || 0) >= 60 ? '#dc2626' : (analysis.prospectScore || 0) >= 40 ? '#ea580c' : '#16a34a'}}
  .score span{font-size:14px;color:#94a3b8;font-weight:400}
  .priority{background:#fef2f2;color:#dc2626;padding:6px 16px;border-radius:20px;font-weight:700;font-size:13px}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px}
  .card{background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:14px}
  .card h3{font-size:11px;text-transform:uppercase;color:#94a3b8;letter-spacing:1px;margin-bottom:8px}
  .card .value{font-size:18px;font-weight:700;color:#1e293b}
  .card .sub{font-size:12px;color:#64748b;margin-top:2px}
  .full-width{grid-column:1/-1}
  .damage{margin-bottom:16px}
  .damage li{font-size:13px;color:#475569;padding:2px 0}
  .reasoning{background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:14px;margin-bottom:16px;font-size:13px;color:#1e40af}
  .footer{text-align:center;color:#94a3b8;font-size:11px;margin-top:24px;padding-top:12px;border-top:1px solid #e2e8f0}
  .aluminum{background:#fef3c7;border:2px solid #f59e0b;border-radius:8px;padding:12px;text-align:center;font-weight:700;color:#92400e;margin-bottom:16px}
  @media print{body{padding:10px}img{max-height:180px}}
</style></head><body>
<div class="header">
  <h1>Property Exterior Analysis Report</h1>
  <div class="address">${analysis.normalizedAddress || analysis.inputAddress}</div>
  <div class="date">Analyzed: ${analysis.analyzedAt ? new Date(analysis.analyzedAt).toLocaleDateString() : 'N/A'}${analysis.streetViewDate ? ` | Photo: ${analysis.streetViewDate}` : ''}</div>
</div>

<div class="images">
  ${svUrl ? `<img src="${svUrl}" alt="Street View">` : '<div style="background:#f1f5f9;border-radius:8px;display:flex;align-items:center;justify-content:center;height:200px;color:#94a3b8">No Street View</div>'}
  ${satUrl ? `<img src="${satUrl}" alt="Satellite">` : ''}
</div>

<div class="score-bar">
  <div>
    <div style="font-size:12px;color:#64748b">Prospect Score</div>
    <div class="score">${analysis.prospectScore || 0} <span>/ 100</span></div>
  </div>
  ${analysis.isHighPriority ? '<div class="priority">HIGH PRIORITY</div>' : ''}
  ${cost ? `<div style="text-align:right"><div style="font-size:12px;color:#64748b">Est. Replacement</div><div style="font-size:20px;font-weight:700;color:#059669">$${cost.low?.toLocaleString()} - $${cost.high?.toLocaleString()}</div></div>` : ''}
</div>

${analysis.isAluminumSiding ? '<div class="aluminum">&#9888; ALUMINUM SIDING DETECTED — Cross-sell opportunity</div>' : ''}

<div class="grid">
  <div class="card">
    <h3>Roof Type</h3>
    <div class="value">${roofLabel[analysis.roofType || ''] || analysis.roofType || 'Unknown'}</div>
    <div class="sub">${analysis.roofColor || ''} | Confidence: ${Math.round((analysis.roofConfidence || 0) * 100)}%</div>
  </div>
  <div class="card">
    <h3>Roof Condition</h3>
    <div class="value" style="text-transform:capitalize">${analysis.roofCondition || 'Unknown'}</div>
    <div class="sub">~${analysis.roofAgeEstimate || '?'} years old</div>
  </div>
  <div class="card">
    <h3>Siding</h3>
    <div class="value" style="text-transform:capitalize">${(analysis.sidingType || 'unknown').replace(/_/g, ' ')}</div>
    <div class="sub">Condition: ${analysis.sidingCondition || 'Unknown'} | Confidence: ${Math.round((analysis.sidingConfidence || 0) * 100)}%</div>
  </div>
  ${solar ? `<div class="card">
    <h3>Measured Roof Data</h3>
    <div class="value">${solar.roofAreaSqFt?.toLocaleString()} sqft</div>
    <div class="sub">Pitch: ${solar.avgPitchDegrees}° | ${solar.segmentCount} segments</div>
  </div>` : ''}
</div>

${(analysis.damageIndicators as any[])?.length > 0 ? `<div class="card damage"><h3>Damage Indicators</h3><ul>${(analysis.damageIndicators as any[]).map((d: any) => `<li>• ${d.type.replace(/_/g, ' ')} (${d.severity}) — ${d.location}</li>`).join('')}</ul></div>` : ''}

${analysis.reasoning || ai.reasoning ? `<div class="reasoning"><strong>AI Reasoning:</strong> ${analysis.reasoning || ai.reasoning}</div>` : ''}

${ai.notes ? `<div class="card full-width"><h3>Notes</h3><div class="sub">${ai.notes}</div></div>` : ''}

<div class="footer">
  Generated by Property Exterior Analyzer | ${new Date().toLocaleDateString()}
</div>
</body></html>`;

    res.setHeader("Content-Type", "text/html");
    res.send(html);
  } catch {
    res.status(500).json({ error: "Failed to generate report" });
  }
});

export default router;
