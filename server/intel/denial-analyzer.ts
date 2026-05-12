/**
 * RIQ 21 Denial Letter Analyzer
 *
 * Pastes-in a carrier denial letter, returns:
 *   - Identified carrier + adjuster
 *   - Verbatim denial reasons (no paraphrase)
 *   - Patent-matched decision rules the carrier likely relied on
 *   - Bad-faith signals (denial language that contradicts patent's documented logic
 *     OR shows AI-generated boilerplate w/o property-specific detail)
 *   - Drafted counter-letter with citations
 *   - Recommended escalation actions
 *
 * Powered by Gemini 2.0 Flash with structured JSON response. Patents are loaded
 * from intel_blobs at request time so the analyzer always uses the freshest decoder.
 */
import type { Request, Response } from 'express';
import { GoogleGenAI } from '@google/genai';
import { sql as pgSql } from '../db.js';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
let ai: GoogleGenAI | null = null;
if (GEMINI_API_KEY) ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

const MODEL = 'gemini-2.0-flash';

interface PatentExtracted {
  summary?: string;
  imageFeaturesScanned?: string[];
  decisionRules?: Array<{ trigger: string; outcome: string }>;
  exclusions?: string[];
  counterPlaysForRoofers?: string[];
  badFaithSignals?: string[];
}

interface PatentEntry {
  id: string;
  carrier: string;
  title: string;
  url: string;
  extracted: PatentExtracted;
}

interface CarrierPatentsBlob {
  patents: Record<string, PatentEntry>;
  byCarrier: Record<string, string[]>;
}

async function loadPatents(): Promise<CarrierPatentsBlob | null> {
  try {
    const rows = await pgSql<Array<{ data: CarrierPatentsBlob }>>`
      SELECT data FROM intel_blobs WHERE key = 'carrier-patents' LIMIT 1
    `;
    if (rows.length === 0) return null;
    return rows[0].data;
  } catch {
    return null;
  }
}

function patentsForCarrier(blob: CarrierPatentsBlob, carrier: string): PatentEntry[] {
  const result: PatentEntry[] = [];
  const carrierKey = (carrier || '').trim();
  const carrierIds = blob.byCarrier[carrierKey] || [];
  for (const id of carrierIds) {
    const p = blob.patents[id];
    if (p) result.push(p);
  }
  // Always include VENDOR_MULTI (Accurence, Dolphin, Betterview, Panton, BuildFax)
  const vendorIds = blob.byCarrier['VENDOR_MULTI'] || [];
  for (const id of vendorIds) {
    const p = blob.patents[id];
    if (p) result.push(p);
  }
  return result;
}

function shapePatentsForPrompt(patents: PatentEntry[]): string {
  return patents
    .map((p) => {
      const e = p.extracted || {};
      const rules = (e.decisionRules || [])
        .map((r) => `      - IF ${r.trigger} THEN ${r.outcome}`)
        .join('\n');
      const exclusions = (e.exclusions || []).map((x) => `      - ${x}`).join('\n');
      const features = (e.imageFeaturesScanned || []).join(', ');
      const signals = (e.badFaithSignals || []).map((x) => `      - ${x}`).join('\n');
      return [
        `  PATENT ${p.id} (${p.carrier}) — ${p.title}`,
        `    summary: ${e.summary || ''}`,
        features ? `    imageFeaturesScanned: ${features}` : '',
        rules ? `    decisionRules:\n${rules}` : '',
        exclusions ? `    exclusions:\n${exclusions}` : '',
        signals ? `    badFaithSignals:\n${signals}` : '',
      ]
        .filter(Boolean)
        .join('\n');
    })
    .join('\n\n');
}

const ANALYZE_PROMPT = `You are a forensic insurance-claim analyst working for a ROOFING CONTRACTOR. The roofer's customer received the denial letter below. Your job: decode it against the carrier's own patent-documented AI decision logic to find leverage for an appeal.

GROUND RULES:
- Quote denial reasons VERBATIM. Never paraphrase. If you can't quote it exactly, omit it.
- A reason is a specific claim/finding cited by the adjuster — not the closing/greeting.
- Match each reason to specific patent decision rules from the corpus below.
- A "contradiction" exists when the denial language clearly diverges from what the patent says the AI/process actually does.
- An "AI tell" is boilerplate language without property-specific detail (generic "wear and tear", "manufacturing defect", "improper installation" with no specific shingle reference, no batch number, no installation date).
- Bad-faith signals (per 2026 federal case law in State Farm OK litigation) include:
  • Denial issued <72 hours from claim submission (suggests no human review)
  • Identical denial language reused across unrelated claims
  • Generic findings unsupported by property-specific evidence
  • Refusal to disclose AI/automated systems when asked
  • Contradictions between denial language and the carrier's own documented decision logic

OUTPUT — return ONLY valid JSON in this exact shape:
{
  "identifiedCarrier": "best guess at carrier name from letter (or empty)",
  "identifiedAdjuster": "adjuster name + title if mentioned (or empty)",
  "claimNumber": "claim number if visible (or empty)",
  "denialDateGuess": "date on letter if visible (or empty)",
  "denialReasons": [
    { "verbatimQuote": "EXACT text from letter, no paraphrase", "category": "wear-and-tear|prior-damage|maintenance|manufacturing-defect|installation|cosmetic|insufficient-evidence|other" }
  ],
  "matchedPatents": [
    { "patentId": "USXXXXXXX", "ruleApplied": "which rule from that patent matches this denial", "likelyReason": "why this patent's rule explains this denial" }
  ],
  "contradictions": [
    { "patentId": "USXXXXXXX", "contradiction": "specific language in denial that contradicts the patent's stated logic" }
  ],
  "aiTells": [
    "specific phrase or pattern in the letter that signals AI/boilerplate generation"
  ],
  "badFaithSignals": [
    "concrete signal from the letter that supports a bad-faith argument under 2026 precedent"
  ],
  "counterLetter": {
    "subject": "Re: Claim # — Request for Supplemental Review and AI Disclosure",
    "body": "FULL drafted letter, 3-5 paragraphs. Must: (1) request specific policy language basis for each denial, (2) demand written disclosure of any AI/automated decision tools used per emerging state regulation, (3) request human supervisor adjuster review, (4) provide property-specific evidence the AI may have missed, (5) close with a firm deadline (10 business days) and bad-faith preservation language. NO LEGAL THREATS — just facts + requests. Address to the named adjuster if any."
  },
  "recommendedActions": [
    { "priority": 1, "action": "concrete next step the roofer/customer should take", "rationale": "why" }
  ],
  "appealStrength": "weak|moderate|strong|very-strong",
  "appealStrengthReasoning": "1-2 sentences explaining the score"
}

If a field truly doesn't apply, use [] or "". NEVER output text outside the JSON.

================
CARRIER PATENT DECODER CORPUS:
{{PATENTS}}

================
DENIAL LETTER (verbatim):
{{LETTER}}
`;

export async function analyzeDenial(req: Request, res: Response): Promise<void> {
  if (!ai) {
    res.status(503).json({ error: 'gemini_unavailable', detail: 'GEMINI_API_KEY not configured on server' });
    return;
  }

  const body = req.body || {};
  const denialText: string = (body.denialText || '').toString();
  const carrierHint: string = (body.carrier || '').toString();

  if (!denialText.trim() || denialText.length < 50) {
    res.status(400).json({ error: 'invalid_input', detail: 'denialText must be at least 50 chars' });
    return;
  }
  if (denialText.length > 25000) {
    res.status(400).json({ error: 'invalid_input', detail: 'denialText must be under 25,000 chars' });
    return;
  }

  const blob = await loadPatents();
  if (!blob) {
    res.status(503).json({ error: 'patents_unavailable', detail: 'carrier-patents dataset not loaded' });
    return;
  }

  const patents = patentsForCarrier(blob, carrierHint);
  if (patents.length === 0) {
    res.status(500).json({ error: 'no_patents_matched', detail: 'no patents in corpus matched the carrier hint' });
    return;
  }

  const prompt = ANALYZE_PROMPT
    .replace('{{PATENTS}}', shapePatentsForPrompt(patents))
    .replace('{{LETTER}}', denialText.slice(0, 25000));

  try {
    const response = await ai.models.generateContent({
      model: MODEL,
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        temperature: 0.2,
      },
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
      carrierHint,
      patentsConsidered: patents.map((p) => p.id),
      analysis: parsed,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'unknown';
    res.status(500).json({ error: 'gemini_error', detail: msg });
  }
}
