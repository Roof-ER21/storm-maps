// Re-extract the 6 weak patents that returned 0 decision rules.
// These are FRAMEWORK patents (claim-processing architectures, not specific
// damage-classification thresholds). Original prompt asked for explicit "rules" —
// framework patents describe SYSTEMS instead. New prompt accepts both.
//
// Re-runs Gemini extraction on the cached raw HTML/text from harvest step,
// merges results into data/carrier-patents.json, preserves existing strong
// extractions.

import fs from 'node:fs';
import path from 'node:path';
import { GoogleGenAI } from '@google/genai';

const RIQ_BASE = process.env.RIQ_BASE || '/Users/a21/Desktop/storm-maps';
const RAW_DIR = `${RIQ_BASE}/data/carrier-patents-raw`;
const OUT = `${RIQ_BASE}/data/carrier-patents.json`;
const WEAK_IDS = ['US10089396', 'US10497289', 'US11216889', 'US11410230', 'US11720971', 'US11348134'];

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
  console.error('GEMINI_API_KEY not set. Source .env.local first.');
  process.exit(1);
}
const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
const MODEL = 'gemini-2.0-flash';

const FRAMEWORK_PROMPT = `You are analyzing a US patent assigned to an insurance carrier or insurance-tech vendor. The carrier or vendor built an AUTOMATED CLAIM-PROCESSING FRAMEWORK that is used BY carriers AGAINST roofers and homeowners.

This patent describes a SYSTEM ARCHITECTURE or ML FRAMEWORK rather than specific numeric damage-classification thresholds. Your job: extract what the system does, even if specifics aren't stated. A roofer needs to know what processing this AI subjects their claim to.

Return ONLY valid JSON in this exact shape:
{
  "summary": "2-3 sentence plain-English summary of what this system actually does",
  "relevanceToRoofers": "1-2 sentences on why a roofer should care",
  "imageFeaturesScanned": ["specific visual/data features the AI scans (e.g. 'aerial imagery for property item placement', 'shingle texture variation', 'metal flashing impact patterns')"],
  "decisionRules": [
    {
      "trigger": "specific input condition OR system stage",
      "outcome": "what the system does at that stage",
      "actionable": true
    }
  ],
  "defaultBehaviors": [
    "system default action when input is ambiguous or rule doesn't fire (e.g. 'route to manual adjuster', 'flag for fraud detection', 'apply standard depreciation table')"
  ],
  "scoringThresholds": [
    { "metric": "named metric or feature", "threshold": "value or range from patent", "meaning": "what crossing causes" }
  ],
  "exclusions": ["specific claim exclusions or carve-outs"],
  "counterPlaysForRoofers": [
    "concrete tactic a roofing contractor can use against this system"
  ],
  "limitations": "what the patent does NOT cover (often more useful than what it does)",
  "badFaithSignals": [
    "patterns where carrier behavior diverging from this system's documented architecture = possible bad faith"
  ]
}

For framework patents specifically:
- "decisionRules" should describe SYSTEM STAGES even if no thresholds are given (e.g. trigger: 'aerial image received', outcome: 'segmentation neural network processes the image').
- "defaultBehaviors" captures fallback paths.
- If nothing concrete is extractable, still produce a useful summary + relevanceToRoofers.

If a field truly doesn't apply, use [] or "". NEVER include explanatory text outside JSON.

PATENT METADATA:
- ID: {{ID}}
- Title: {{TITLE}}
- Assignee: {{ASSIGNEE}}
- Category: {{CATEGORY}}

ABSTRACT:
{{ABSTRACT}}

CLAIMS:
{{CLAIMS}}

DESCRIPTION (excerpt):
{{DESCRIPTION}}
`;

async function extractOne(raw) {
  const prompt = FRAMEWORK_PROMPT
    .replace('{{ID}}', raw.id)
    .replace('{{TITLE}}', raw.title || '')
    .replace('{{ASSIGNEE}}', raw.assignee || '')
    .replace('{{CATEGORY}}', raw.category || '')
    .replace('{{ABSTRACT}}', (raw.abstract || '').slice(0, 4000))
    .replace('{{CLAIMS}}', (raw.claims || '').slice(0, 8000))
    .replace('{{DESCRIPTION}}', (raw.description || '').slice(0, 10000));

  const response = await ai.models.generateContent({
    model: MODEL,
    contents: prompt,
    config: { responseMimeType: 'application/json', temperature: 0.3 },
  });
  const text = response.text || '';
  try {
    return JSON.parse(text);
  } catch {
    const cleaned = text.replace(/^```json\s*|\s*```$/gm, '').trim();
    return JSON.parse(cleaned);
  }
}

(async () => {
  const corpus = JSON.parse(fs.readFileSync(OUT, 'utf8'));
  let okCount = 0;
  for (const id of WEAK_IDS) {
    const rawFile = path.join(RAW_DIR, `${id}.json`);
    if (!fs.existsSync(rawFile)) { console.log(`  ✗ ${id} — raw missing`); continue; }
    const raw = JSON.parse(fs.readFileSync(rawFile, 'utf8'));
    process.stdout.write(`  → ${id} (${raw.carrier}) … `);
    try {
      const extracted = await extractOne(raw);
      const beforeRules = (corpus.patents[id]?.extracted?.decisionRules || []).length;
      // Merge into corpus
      corpus.patents[id] = {
        id: raw.id, title: raw.title, assignee: raw.assignee, carrier: raw.carrier,
        filed: raw.filed, category: raw.category, why: raw.why, url: raw.url,
        extracted,
      };
      const afterRules = (extracted.decisionRules || []).length;
      const afterDefaults = (extracted.defaultBehaviors || []).length;
      const afterCounters = (extracted.counterPlaysForRoofers || []).length;
      console.log(`✓ rules: ${beforeRules}→${afterRules}, defaults: ${afterDefaults}, counters: ${afterCounters}`);
      okCount++;
      await new Promise((r) => setTimeout(r, 500));
    } catch (e) {
      console.log(`✗ ${e.message}`);
    }
  }
  corpus.generated = new Date().toISOString();
  fs.writeFileSync(OUT, JSON.stringify(corpus, null, 2));
  console.log(`\n${okCount}/${WEAK_IDS.length} re-extracted; corpus saved to ${OUT}`);
})();
