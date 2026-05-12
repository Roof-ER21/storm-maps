/**
 * RIQ 21 Adjuster Twin — given a named adjuster + a proposed scope, predicts
 * their likely response using:
 *   1. Their personal cheat-sheet history (approval rate, denial reasons, comp-shingle vs spot-repair tendency)
 *   2. Their carrier's documented AI/automation patents
 *   3. The scope details (hail size, roof age, photo count, area damaged)
 *
 * Returns a structured prediction the rep can use to:
 *   - Pre-stage the scope to maximize approval probability
 *   - Pre-rebut likely denial reasons
 *   - Decide whether to escalate before submission
 */
import type { Request, Response } from 'express';
import { GoogleGenAI } from '@google/genai';
import { sql as pgSql } from '../db.js';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
let ai: GoogleGenAI | null = null;
if (GEMINI_API_KEY) ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

const MODEL = 'gemini-2.0-flash';

interface AdjusterSheet {
  name: string;
  carrier?: string;
  jobs?: number;
  approved?: number;
  dead?: number;
  approvalRate?: number;
  carrierBaseline?: number;
  deltaVsCarrier?: number;
  stance?: string;
  medianUplift?: number;
  medianDeductible?: number;
  reps?: Array<{ name: string; jobs: number; approved?: number; approvalRate?: number }>;
  cities?: Array<{ name: string; jobs: number }>;
  insufficient?: boolean;
  [key: string]: unknown;
}

interface CheatSheetsBlob {
  adjusters?: AdjusterSheet[];
  generated?: string;
}

interface PatentEntry {
  id: string;
  carrier: string;
  title: string;
  url: string;
  extracted: {
    summary?: string;
    decisionRules?: Array<{ trigger: string; outcome: string }>;
    exclusions?: string[];
    badFaithSignals?: string[];
  };
}

interface CarrierPatentsBlob {
  patents: Record<string, PatentEntry>;
  byCarrier: Record<string, string[]>;
}

async function loadBlob<T>(key: string): Promise<T | null> {
  try {
    const rows = await pgSql<Array<{ data: T }>>`
      SELECT data FROM intel_blobs WHERE key = ${key} LIMIT 1
    `;
    if (rows.length === 0) return null;
    return rows[0].data;
  } catch {
    return null;
  }
}

const PROMPT = `You are an "Adjuster Twin" — a forensic simulator that predicts how a specific insurance adjuster will respond to a roofing claim, based on their HISTORICAL behavior + their CARRIER's documented AI logic.

You will be given:
- The adjuster's personal cheat sheet (their approval rate, denial reasons, comparison to team baseline)
- Their carrier's patent-documented decision rules
- The proposed scope (hail size, roof age, area, photos, evidence)

OUTPUT — return ONLY valid JSON in this shape:
{
  "likelyDecision": "approve-full|approve-partial|deny|require-supplement|require-resubmit",
  "decisionConfidence": "low|medium|high",
  "confidenceRationale": "1 sentence on why this confidence",
  "approvalProbability": 0.0 to 1.0,
  "predictedTotal": estimated dollar approval (number, or null if denial expected),
  "likelyApprovalScope": "what they'll approve (full vs partial — name the trades/sections)",
  "predictedDenialReasons": [
    { "reason": "specific reason they're likely to cite", "basedOn": "historical|patent|both", "likelihood": "low|medium|high" }
  ],
  "preEmptiveAdjustments": [
    { "action": "concrete change to scope/evidence BEFORE submission", "why": "what risk this defuses", "priority": 1 to 5 }
  ],
  "leveragePoints": [
    "specific evidence or argument that maximizes this adjuster's approval probability"
  ],
  "redFlags": [
    "specific elements in the scope this adjuster is historically likely to reject"
  ],
  "escalationRecommendation": {
    "shouldEscalate": true|false,
    "trigger": "specific threshold that would warrant supervisor escalation (or empty)",
    "rationale": ""
  },
  "comparableHistoricalJobs": [
    "1-2 specific historical jobs from their cheat sheet that closely match — be concrete with what was approved/denied"
  ],
  "playbookSummary": "2-3 sentence playbook the rep should use with this specific adjuster"
}

NEVER make up data. If the adjuster sheet is thin (low N), say so in confidenceRationale and lower confidence. NEVER output text outside JSON.

================
ADJUSTER SHEET:
{{ADJUSTER}}

================
CARRIER PATENTS (documented decision logic):
{{PATENTS}}

================
PROPOSED SCOPE:
{{SCOPE}}
`;

function shapeAdjuster(sheet: AdjusterSheet): string {
  return JSON.stringify(sheet, null, 2).slice(0, 8000);
}

function shapePatents(patents: PatentEntry[]): string {
  return patents
    .slice(0, 8)
    .map((p) => {
      const rules = (p.extracted?.decisionRules || [])
        .slice(0, 5)
        .map((r) => `  IF ${r.trigger} THEN ${r.outcome}`)
        .join('\n');
      const exclusions = (p.extracted?.exclusions || []).slice(0, 4).map((x) => `  - ${x}`).join('\n');
      return [
        `${p.id} (${p.carrier}) — ${p.title}`,
        p.extracted?.summary ? `  summary: ${p.extracted.summary}` : '',
        rules ? `  rules:\n${rules}` : '',
        exclusions ? `  exclusions:\n${exclusions}` : '',
      ].filter(Boolean).join('\n');
    })
    .join('\n\n');
}

export async function predictAdjuster(req: Request, res: Response): Promise<void> {
  if (!ai) {
    res.status(503).json({ error: 'gemini_unavailable', detail: 'GEMINI_API_KEY not configured' });
    return;
  }

  const body = req.body || {};
  const adjusterName: string = (body.adjusterName || '').toString().trim();
  const carrier: string = (body.carrier || '').toString().trim();
  const scope = body.scope || {};

  if (!adjusterName) {
    res.status(400).json({ error: 'invalid_input', detail: 'adjusterName required' });
    return;
  }
  if (!scope || typeof scope !== 'object') {
    res.status(400).json({ error: 'invalid_input', detail: 'scope object required' });
    return;
  }

  const cheats = await loadBlob<CheatSheetsBlob>('cheat-sheets');
  if (!cheats || !cheats.adjusters) {
    res.status(503).json({ error: 'cheat_sheets_unavailable', detail: 'adjuster cheat sheets not loaded' });
    return;
  }

  // Case-insensitive adjuster match — adjusters can repeat with different carriers; pick the most-jobs one
  const matches = cheats.adjusters
    .filter((a) => a.name && a.name.toLowerCase() === adjusterName.toLowerCase())
    .sort((a, b) => (b.jobs || 0) - (a.jobs || 0));
  // Prefer a match on the specified carrier if available
  const adjusterSheet = matches.find((m) => carrier && m.carrier?.toLowerCase() === carrier.toLowerCase()) || matches[0];

  if (!adjusterSheet) {
    res.status(404).json({
      error: 'adjuster_not_found',
      detail: 'adjuster not in cheat-sheets dataset',
      suggestion: cheats.adjusters
        .filter((a) => a.name && a.name.toLowerCase().includes((adjusterName.toLowerCase().split(' ')[0] || '')))
        .slice(0, 5)
        .map((a) => a.name),
    });
    return;
  }
  const adjusterKey = adjusterSheet.name;

  // Patents — carrier + VENDOR_MULTI
  const blob = await loadBlob<CarrierPatentsBlob>('carrier-patents');
  const patents: PatentEntry[] = [];
  if (blob) {
    const ids = [
      ...(blob.byCarrier[carrier] || []),
      ...(blob.byCarrier['VENDOR_MULTI'] || []),
    ];
    for (const id of ids) {
      const p = blob.patents[id];
      if (p) patents.push(p);
    }
  }

  const prompt = PROMPT
    .replace('{{ADJUSTER}}', shapeAdjuster(adjusterSheet))
    .replace('{{PATENTS}}', shapePatents(patents))
    .replace('{{SCOPE}}', JSON.stringify(scope, null, 2));

  try {
    const response = await ai.models.generateContent({
      model: MODEL,
      contents: prompt,
      config: { responseMimeType: 'application/json', temperature: 0.3 },
    });
    const text = response.text || '';
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      const cleaned = text.replace(/^```json\s*|\s*```$/gm, '').trim();
      parsed = JSON.parse(cleaned);
    }
    res.json({
      generated: new Date().toISOString(),
      model: MODEL,
      adjuster: adjusterKey,
      carrier: carrier || adjusterSheet.carrier,
      adjusterDataPoints: {
        totalJobs: adjusterSheet.jobs || 0,
        approved: adjusterSheet.approved || 0,
        approvalRate: adjusterSheet.approvalRate || null,
        carrierBaseline: adjusterSheet.carrierBaseline || null,
        deltaVsCarrier: adjusterSheet.deltaVsCarrier || null,
        stance: adjusterSheet.stance || null,
        medianUplift: adjusterSheet.medianUplift || null,
      },
      patentsConsidered: patents.map((p) => p.id),
      prediction: parsed,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'unknown';
    res.status(500).json({ error: 'gemini_error', detail: msg });
  }
}

/** GET /api/intel/adjuster-twin/list — returns names of adjusters with cheat-sheet data */
export async function listAdjusters(_req: Request, res: Response): Promise<void> {
  const cheats = await loadBlob<CheatSheetsBlob>('cheat-sheets');
  if (!cheats || !cheats.adjusters) {
    res.json({ adjusters: [] });
    return;
  }
  // Dedupe by name (an adjuster can appear once per carrier they worked) — keep
  // the highest-volume entry for the dropdown but include the carrier in the label.
  const list = cheats.adjusters
    .filter((a) => a.name && (a.jobs || 0) >= 5 && !a.insufficient)
    .map((a) => ({
      name: a.name,
      carrier: a.carrier || null,
      totalJobs: a.jobs || 0,
      approvalRate: a.approvalRate ?? null,
      stance: a.stance ?? null,
      deltaVsCarrier: a.deltaVsCarrier ?? null,
    }))
    .sort((a, b) => (b.totalJobs || 0) - (a.totalJobs || 0));
  res.json({ adjusters: list });
}
