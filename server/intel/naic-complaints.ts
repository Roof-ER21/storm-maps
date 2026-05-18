/**
 * NAIC Complaint Index — Phase 7 carrier-quality context.
 *
 * Loads the curated `data/naic-complaint-index.json` at boot. Provides:
 *   GET /api/intel/carrier-complaints              — full table
 *   GET /api/intel/carrier-complaints?carrier=X    — one carrier
 *
 * The data is seeded from the Indiana DOI 2022 Homeowner Complaint Index
 * (public PDF). Carrier names match RIQ's normalized carrier list, so
 * this can be JOINed against intel_projects directly.
 *
 * Index methodology: (carrier's share of complaints) / (carrier's share of
 * premium). 1.0 = average. <1 = fewer complaints than expected; >1 = more.
 *
 * Used by:
 *   - carrier-detail.html (shown next to the carrier name)
 *   - predictor.ts (small factor in the score blend)
 */
import { type Request, type Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export type ComplaintEntry = {
  index: number | null;
  rating: 'excellent' | 'good' | 'average' | 'above-average complaints' | 'high-complaint outlier' | 'unrated' | 'DNC';
  premium_in_2022?: number;
  complaints_in_2022?: number;
  primary_naic?: string;
  note?: string;
};

export type ComplaintData = {
  source: string;
  sourceUrl: string;
  lastUpdated: string;
  methodology: string;
  interpretation: Record<string, string>;
  carriers: Record<string, ComplaintEntry>;
};

let cache: ComplaintData | null = null;

function loadData(): ComplaintData {
  if (cache) return cache;
  const dataPath = path.resolve(__dirname, '..', '..', 'data', 'naic-complaint-index.json');
  const raw = fs.readFileSync(dataPath, 'utf8');
  cache = JSON.parse(raw) as ComplaintData;
  return cache;
}

export async function carrierComplaints(req: Request, res: Response) {
  try {
    const data = loadData();
    const carrier = String(req.query.carrier ?? '').trim();
    if (carrier) {
      const entry = data.carriers[carrier] ?? null;
      res.json({
        carrier,
        entry,
        source: data.source,
        sourceUrl: data.sourceUrl,
        methodology: data.methodology,
        interpretation: data.interpretation,
      });
      return;
    }
    res.json(data);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: 'carrier_complaints_failed', message: msg });
  }
}

/** Programmatic lookup for use inside other endpoints (e.g. predictor). */
export function getComplaintIndex(carrierName: string | null | undefined): { index: number | null; rating: string; note?: string } | null {
  if (!carrierName) return null;
  try {
    const data = loadData();
    const entry = data.carriers[carrierName];
    if (!entry) return null;
    return { index: entry.index, rating: entry.rating, note: entry.note };
  } catch {
    return null;
  }
}
