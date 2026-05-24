// Extracts structured carrier-AI decision rules from raw patent text using
// Gemini. Output is the actionable layer roofers need: what features the
// AI scans, what thresholds trigger what, what counter-plays exist.
//
// Reads:  data/carrier-patents-raw/*.json (output of harvest-carrier-patents.mjs)
// Writes: data/carrier-patents.json (aggregated, keyed by patentId)

import fs from 'node:fs';
import path from 'node:path';
import { GoogleGenAI } from '@google/genai';

const RIQ_BASE = process.env.RIQ_BASE || '/Users/a21/RIQ21';
const RAW_DIR = `${RIQ_BASE}/data/carrier-patents-raw`;
const OUT = `${RIQ_BASE}/data/carrier-patents.json`;

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
  console.error('GEMINI_API_KEY not set. Source .env.local first.');
  process.exit(1);
}

const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
const MODEL = 'gemini-2.0-flash';

const EXTRACTION_PROMPT = `You are analyzing a US patent assigned to an insurance carrier or insurance-tech vendor that builds automated claim/damage assessment systems used BY carriers AGAINST roofers and homeowners.

You are translating this patent for a ROOFING CONTRACTOR who needs to understand the carrier's automated decision logic so they can:
1. Pre-align scope/photos with the AI's matching criteria (so claims pass first review)
2. Counter-argue if the AI denies a claim using these same rules
3. Spot when a denial diverges from the patent's documented logic (potential bad faith)

Be specific. Skip generic boilerplate. Patent language is broad — extract what's CONCRETE and ACTIONABLE.

Return ONLY valid JSON in this exact shape:
{
  "summary": "2-3 sentence plain-English summary of what this patent's system actually does",
  "relevanceToRoofers": "1-2 sentences on why a roofer should care about this specific patent",
  "imageFeaturesScanned": [
    "concrete visual features the AI/algorithm scans for (e.g., 'granular wear contrast', 'hail bruising pattern density', 'shingle edge curvature')"
  ],
  "decisionRules": [
    { "trigger": "specific condition the patent says triggers a decision", "outcome": "what the system does", "actionable": true }
  ],
  "scoringThresholds": [
    { "metric": "named metric or feature", "threshold": "numeric value or range from patent", "meaning": "what crossing the threshold causes" }
  ],
  "exclusions": ["specific claim exclusions or carve-outs the patent applies (often the most actionable for roofers)"],
  "counterPlaysForRoofers": [
    "concrete tactic a roofing contractor can use: e.g., 'submit before-storm baseline photos to defeat <feature> false-positive', 'cite NRCA Standard X to override patent rule Y'"
  ],
  "limitations": "what the patent does NOT cover or what's ambiguous (often more revealing than what it claims)",
  "badFaithSignals": [
    "specific patterns where a denial diverging from this patent's stated logic = possible bad faith (cite specific patent claims where the carrier's actual behavior contradicts its documented system)"
  ]
}

If a field truly doesn't apply, use empty array [] or empty string "". NEVER include explanatory text outside the JSON.

PATENT METADATA:
- ID: {{ID}}
- Title: {{TITLE}}
- Assignee: {{ASSIGNEE}}
- Filed: {{FILED}}
- Category: {{CATEGORY}}

PATENT ABSTRACT:
{{ABSTRACT}}

PATENT CLAIMS:
{{CLAIMS}}

PATENT DESCRIPTION (excerpt):
{{DESCRIPTION}}
`;

async function extractOne(raw) {
  const prompt = EXTRACTION_PROMPT
    .replace('{{ID}}', raw.id)
    .replace('{{TITLE}}', raw.title || '')
    .replace('{{ASSIGNEE}}', raw.assignee || '')
    .replace('{{FILED}}', raw.filed || '')
    .replace('{{CATEGORY}}', raw.category || '')
    .replace('{{ABSTRACT}}', (raw.abstract || '').slice(0, 4000))
    .replace('{{CLAIMS}}', (raw.claims || '').slice(0, 8000))
    .replace('{{DESCRIPTION}}', (raw.description || '').slice(0, 10000));

  const response = await ai.models.generateContent({
    model: MODEL,
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
      temperature: 0.2,
    },
  });

  const text = response.text || '';
  try {
    return JSON.parse(text);
  } catch (e) {
    // Sometimes the model wraps JSON in markdown — strip code fences
    const cleaned = text.replace(/^```json\s*|\s*```$/gm, '').trim();
    return JSON.parse(cleaned);
  }
}

(async () => {
  const files = fs.readdirSync(RAW_DIR).filter((f) => f.endsWith('.json'));
  console.log(`Extracting logic from ${files.length} patents (model=${MODEL})\n`);
  const aggregated = {
    generated: new Date().toISOString(),
    model: MODEL,
    patents: {},
    byCarrier: {},
  };
  let ok = 0, failed = 0;
  for (const f of files) {
    const raw = JSON.parse(fs.readFileSync(path.join(RAW_DIR, f), 'utf8'));
    process.stdout.write(`  → ${raw.id} (${raw.carrier}) … `);
    try {
      const extracted = await extractOne(raw);
      const entry = {
        id: raw.id,
        title: raw.title,
        assignee: raw.assignee,
        carrier: raw.carrier,
        filed: raw.filed,
        category: raw.category,
        why: raw.why,
        url: raw.url,
        extracted,
      };
      aggregated.patents[raw.id] = entry;
      const carrierKey = raw.carrier;
      if (!aggregated.byCarrier[carrierKey]) aggregated.byCarrier[carrierKey] = [];
      aggregated.byCarrier[carrierKey].push(raw.id);
      console.log(`✓ ${(extracted.decisionRules || []).length} rules, ${(extracted.counterPlaysForRoofers || []).length} counter-plays`);
      ok++;
      // Stagger Gemini calls
      await new Promise((r) => setTimeout(r, 500));
    } catch (e) {
      console.log(`✗ ${e.message}`);
      failed++;
    }
  }
  // Sort carriers
  for (const k of Object.keys(aggregated.byCarrier)) aggregated.byCarrier[k].sort();
  fs.writeFileSync(OUT, JSON.stringify(aggregated, null, 2));
  const mb = (fs.statSync(OUT).size / 1024).toFixed(1);
  console.log(`\nWrote ${OUT} (${mb} KB)`);
  console.log(`  ${ok} extracted, ${failed} failed`);
  console.log(`  Carriers covered: ${Object.keys(aggregated.byCarrier).join(', ')}`);
})();
