/**
 * Bridge Routes — Connect storm leads to AI property analysis.
 *
 * POST /analyze-lead/:leadId    — Run AI analysis on a storm lead's address
 * POST /analyze-swath           — Batch-analyze all leads in a bounding box
 */
import { Router } from 'express';
import { db } from '../../db.js';
import { leads } from '../../schema.js';
import { propertyAnalyses } from '../schema.js';
import { eq, and, gte, lte } from 'drizzle-orm';
import { analyzeProperty } from '../services/propertyAnalyzer.js';
import type { AnalysisMode } from '../services/analysisMode.js';

const router = Router();

const getConfig = () => ({
  googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY || '',
  geminiApiKey: process.env.GEMINI_API_KEY || '',
});

/**
 * POST /api/ai/bridge/analyze-lead/:leadId
 * Run AI analysis on a single storm lead and link the result.
 */
router.post('/analyze-lead/:leadId', async (req, res) => {
  try {
    const leadId = req.params.leadId as string;
    const mode = ((req.body?.mode as string) || 'insurance') as AnalysisMode;

    const config = getConfig();
    if (!config.googleMapsApiKey || !config.geminiApiKey) {
      res.status(500).json({ error: 'API keys not configured' });
      return;
    }

    // Get the lead
    const [lead] = await db.select().from(leads).where(eq(leads.id, leadId));
    if (!lead) {
      res.status(404).json({ error: 'Lead not found' });
      return;
    }

    // Already has AI analysis?
    if (lead.aiAnalysisId) {
      const [existing] = await db.select().from(propertyAnalyses)
        .where(eq(propertyAnalyses.id, lead.aiAnalysisId));
      if (existing && existing.status === 'completed') {
        res.json({ analysis: existing, cached: true });
        return;
      }
    }

    // Run analysis on the lead's address
    const analysis = await analyzeProperty(
      lead.propertyLabel,
      db,
      config,
      mode,
    );

    // Link the analysis to the lead
    await db.update(leads).set({
      aiAnalysisId: analysis.id,
      aiProspectScore: analysis.prospectScore,
      aiRoofType: analysis.roofType,
      aiRoofCondition: analysis.roofCondition,
      updatedAt: new Date(),
    }).where(eq(leads.id, leadId));

    res.json({ analysis, cached: false });
  } catch (err) {
    console.error('[bridge] analyze-lead error:', err);
    res.status(500).json({ error: 'Failed to analyze lead' });
  }
});

/**
 * POST /api/ai/bridge/analyze-swath
 * Batch-analyze multiple leads within a bounding box.
 * Body: { north, south, east, west, mode?, limit? }
 */
router.post('/analyze-swath', async (req, res) => {
  try {
    const { north, south, east, west, mode = 'insurance', limit = 20 } = req.body;
    if (!north || !south || !east || !west) {
      res.status(400).json({ error: 'Bounding box (north, south, east, west) required' });
      return;
    }

    const config = getConfig();
    if (!config.googleMapsApiKey || !config.geminiApiKey) {
      res.status(500).json({ error: 'API keys not configured' });
      return;
    }

    // Find leads in the bounding box that don't have AI analysis yet
    const targetLeads = await db.select().from(leads)
      .where(
        and(
          gte(leads.lat, south),
          lte(leads.lat, north),
          gte(leads.lng, west),
          lte(leads.lng, east),
        )
      )
      .limit(Math.min(limit, 50));

    const unanalyzed = targetLeads.filter(l => !l.aiAnalysisId);
    const results: Array<{ leadId: string; analysisId: string; score: number | null }> = [];

    const processLead = async (lead: typeof targetLeads[0]) => {
      try {
        const analysis = await analyzeProperty(
          lead.propertyLabel,
          db,
          config,
          mode as AnalysisMode,
        );
        await db.update(leads).set({
          aiAnalysisId: analysis.id,
          aiProspectScore: analysis.prospectScore,
          aiRoofType: analysis.roofType,
          aiRoofCondition: analysis.roofCondition,
          updatedAt: new Date(),
        }).where(eq(leads.id, lead.id));
        results.push({ leadId: lead.id, analysisId: analysis.id, score: analysis.prospectScore });
      } catch (err) {
        console.error(`[bridge] Failed to analyze lead ${lead.id}:`, err);
      }
    };

    // Process 2 at a time
    const queue = [...unanalyzed];
    const workers = Array.from({ length: Math.min(2, queue.length) }, async () => {
      while (queue.length > 0) {
        const lead = queue.shift();
        if (lead) await processLead(lead);
      }
    });
    await Promise.all(workers);

    res.json({
      total: targetLeads.length,
      analyzed: results.length,
      alreadyAnalyzed: targetLeads.length - unanalyzed.length,
      results,
    });
  } catch (err) {
    console.error('[bridge] analyze-swath error:', err);
    res.status(500).json({ error: 'Failed to analyze swath' });
  }
});

export default router;
