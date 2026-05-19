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
import { recordIntake } from './denial-intake.js';
import { normalizeCarrier } from './carrier-normalize.mjs';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
let ai: GoogleGenAI | null = null;
if (GEMINI_API_KEY) ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

const MODEL = 'gemini-2.0-flash';

// Phase 5 (V2 roadmap) A/B stance variants. Picked uniformly at random per
// analysis so denial-stats can later rank flip-rate by carrier x stance. The
// directive only steers the counterLetter + recommendedActions tone — the
// analytical fields (denialReasons / matchedPatents / contradictions / aiTells /
// badFaithSignals / appealStrength) stay neutral. Override at request time via
// `body.stanceVariant` for forced selection / replay.
const STANCE_VARIANTS = ['firm-legal', 'collaborative-evidence', 'escalation-focused'] as const;
type StanceVariant = typeof STANCE_VARIANTS[number];

const STANCE_DIRECTIVES: Record<StanceVariant, string> = {
  'firm-legal':
    'STANCE = FIRM-LEGAL. For counterLetter and recommendedActions ONLY: lead with policy-language demands and citation of the carrier patent contradictions you just identified. Include an explicit 10-business-day deadline and bad-faith-preservation language in the counter-letter body. Frame recommended actions as compliance + preservation steps (document everything, notify DOI if no response, retain counsel as next escalation). Tone: precise, citation-heavy, no apologies, no softening qualifiers.',
  'collaborative-evidence':
    'STANCE = COLLABORATIVE-EVIDENCE. For counterLetter and recommendedActions ONLY: lead the counter-letter with property-specific evidence the AI/adjuster appears to have missed (measurements, photos, manufacturer specs, recent storm events). Frame the supervisor-review request as "help us reconcile this finding" rather than accusatory. Save bad-faith-preservation language for the closing paragraph only. Frame recommended actions as concrete evidence-gathering steps the rep + customer can take this week. Tone: factual, cooperative, evidence-forward.',
  'escalation-focused':
    'STANCE = ESCALATION-FOCUSED. For counterLetter and recommendedActions ONLY: lead with the demand for written disclosure of AI / automated-decision-tool use in this claim review, citing emerging state regulation. Request a named human supervisor for the second review. Set a hard 10-business-day deadline with the explicit next-step trigger written out (DOI complaint, OAG notification, counsel referral). Preserve bad-faith. Frame recommended actions as a sequenced escalation ladder (today / this week / day-11-if-silent). Tone: time-pressured, regulatory, no-nonsense.',
};

function selectStance(): StanceVariant {
  return STANCE_VARIANTS[Math.floor(Math.random() * STANCE_VARIANTS.length)];
}

function isStanceVariant(s: unknown): s is StanceVariant {
  return typeof s === 'string' && (STANCE_VARIANTS as readonly string[]).includes(s);
}

// Carrier-aware stance pick (V2 auto-flip). Queries outcome stats for the
// given carrier; if a stance has ≥ MIN_OUTCOMES outcomes and a strictly
// higher flip rate than alternatives, pick it. Else fall back to uniform
// random. Returns { stance, source: 'recommended' | 'random' } so the
// caller can log + the response can surface why a particular stance was
// chosen (useful for evaluating the recommendation engine).
const MIN_OUTCOMES_FOR_RECOMMENDATION = 3;
async function pickStanceForCarrier(
  carrierRaw: string | null,
): Promise<{ stance: StanceVariant; source: 'recommended' | 'random' }> {
  if (!carrierRaw) return { stance: selectStance(), source: 'random' };
  try {
    const { normalizeCarrier } = await import('./carrier-normalize.mjs');
    const canonical = normalizeCarrier(carrierRaw) || carrierRaw;
    const rows = await pgSql<Array<{ stance_variant: string; outcome: string }>>`
      SELECT di.stance_variant, lo.outcome
      FROM denial_intake di
      JOIN LATERAL (
        SELECT outcome FROM denial_outcomes
        WHERE intake_id = di.id
        ORDER BY created_at DESC LIMIT 1
      ) lo ON true
      WHERE di.stance_variant IS NOT NULL
        AND lo.outcome IN ('approved','partial','denied')
        AND COALESCE(di.identified_carrier, di.carrier) IS NOT NULL
        AND ${canonical} = ANY(
          ARRAY[di.identified_carrier, di.carrier]
        )
    `;
    if (rows.length === 0) return { stance: selectStance(), source: 'random' };
    // Bucket by stance
    type Bucket = { total: number; flipped: number };
    const buckets = new Map<string, Bucket>();
    for (const r of rows) {
      const b = buckets.get(r.stance_variant) || { total: 0, flipped: 0 };
      b.total += 1;
      if (r.outcome === 'approved' || r.outcome === 'partial') b.flipped += 1;
      buckets.set(r.stance_variant, b);
    }
    let best: { stance: StanceVariant; flipRate: number; total: number } | null = null;
    for (const [stance, b] of buckets) {
      if (b.total < MIN_OUTCOMES_FOR_RECOMMENDATION) continue;
      if (!isStanceVariant(stance)) continue;
      const flipRate = b.flipped / b.total;
      if (!best || flipRate > best.flipRate) best = { stance, flipRate, total: b.total };
    }
    if (best) return { stance: best.stance, source: 'recommended' };
    return { stance: selectStance(), source: 'random' };
  } catch {
    // Any error → safe fallback to random (don't block analysis on DB issues).
    return { stance: selectStance(), source: 'random' };
  }
}

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

interface DenialCorpusEntry {
  id: string;
  source: string;
  sourceType: string;
  carrier: string | null;
  adjuster: string | null;
  denialText: string;
  counterText?: string;
  outcome?: string | null;
  denialCategory?: string | null;
  dateOfDenial?: string | null;
  caseRef?: string | null;
}

interface DenialCorpus {
  entries: DenialCorpusEntry[];
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

async function loadCorpus(): Promise<DenialCorpus | null> {
  try {
    const rows = await pgSql<Array<{ data: DenialCorpus }>>`
      SELECT data FROM intel_blobs WHERE key = 'denial-corpus' LIMIT 1
    `;
    if (rows.length === 0) return null;
    return rows[0].data;
  } catch {
    return null;
  }
}

interface BoilerplatePhrase { phrase: string; occurrences: number; sources?: string[]; }
interface BoilerplateBag { denialCount?: number; phrases?: BoilerplatePhrase[]; curatedPhrases?: BoilerplatePhrase[]; }
interface BoilerplateBlob { byCarrier?: Record<string, BoilerplateBag>; totalCarriers?: number; totalCuratedPhrases?: number; }

async function loadBoilerplate(): Promise<BoilerplateBlob | null> {
  try {
    const rows = await pgSql<Array<{ data: BoilerplateBlob }>>`
      SELECT data FROM intel_blobs WHERE key = 'carrier-boilerplate' LIMIT 1
    `;
    if (rows.length === 0) return null;
    return rows[0].data;
  } catch {
    return null;
  }
}

interface BoilerplateMatch { phrase: string; carrier: string; sourceType: 'curated' | 'ngram'; occurrencesInCorpus: number; }

function detectBoilerplateMatches(letterText: string, carrier: string, blob: BoilerplateBlob | null): BoilerplateMatch[] {
  if (!blob || !blob.byCarrier) return [];
  const canonical = normalizeCarrier(carrier);
  if (!canonical) return [];
  const bag = blob.byCarrier[canonical];
  if (!bag) return [];
  const haystack = letterText.toLowerCase();
  const matches: BoilerplateMatch[] = [];
  // Check curated phrases first (higher quality)
  for (const p of (bag.curatedPhrases || [])) {
    if (!p.phrase || p.phrase.length < 12) continue;
    if (haystack.includes(p.phrase.toLowerCase())) {
      matches.push({ phrase: p.phrase, carrier: canonical, sourceType: 'curated', occurrencesInCorpus: p.occurrences || 1 });
    }
  }
  // Also check n-gram phrases (lower quality but exhaustive)
  for (const p of (bag.phrases || [])) {
    if (!p.phrase || p.phrase.length < 15) continue;
    if (haystack.includes(p.phrase.toLowerCase())) {
      matches.push({ phrase: p.phrase, carrier: canonical, sourceType: 'ngram', occurrencesInCorpus: p.occurrences || 2 });
    }
  }
  return matches.slice(0, 8); // cap to keep prompt focused
}

interface StrategyEntry { carrierTactic?: string; rooferTactic?: string; lessonForAnalyzer?: string; patentMapping?: string; source?: string; }
interface AdjusterEntry { name?: string; title?: string; email?: string; phone?: string; exampleClaim?: string; denialPattern?: string; stance?: string; subsidiary?: string; manager?: string; }

function getCarrierStrategies(carrier: string, blob: BoilerplateBlob | null): StrategyEntry[] {
  if (!blob || !blob.byCarrier) return [];
  const canonical = normalizeCarrier(carrier);
  if (!canonical) return [];
  const bag = blob.byCarrier[canonical] as BoilerplateBag & { strategies?: StrategyEntry[] };
  if (!bag || !Array.isArray(bag.strategies)) return [];
  // Cap to 4 strategies to keep prompt focused
  return bag.strategies.slice(0, 4);
}

function getCarrierAdjusters(carrier: string, blob: BoilerplateBlob | null): AdjusterEntry[] {
  if (!blob || !blob.byCarrier) return [];
  const canonical = normalizeCarrier(carrier);
  if (!canonical) return [];
  const bag = blob.byCarrier[canonical] as BoilerplateBag & { adjusters?: AdjusterEntry[] };
  return Array.isArray(bag?.adjusters) ? bag.adjusters : [];
}

function findRelevantAdjusters(letterText: string, allAdjusters: AdjusterEntry[]): AdjusterEntry[] {
  if (allAdjusters.length === 0) return [];
  const lc = letterText.toLowerCase();
  const matched = allAdjusters.filter((a) => a.name && lc.includes(a.name.toLowerCase()));
  return matched.slice(0, 3);
}

function shapeAdjusters(adjusters: AdjusterEntry[]): string {
  if (adjusters.length === 0) return '(no specific adjuster from our roster matched in this letter)';
  return adjusters.map((a, i) => {
    const lines = [`  ADJUSTER ${i + 1}: ${a.name || '?'}${a.title ? ` (${a.title})` : ''}`];
    if (a.email) lines.push(`    Email: ${a.email}`);
    if (a.phone) lines.push(`    Phone: ${a.phone}`);
    if (a.subsidiary) lines.push(`    Subsidiary: ${a.subsidiary}`);
    if (a.manager) lines.push(`    Escalate to manager: ${a.manager}`);
    if (a.exampleClaim) lines.push(`    Past Roof Docs claim ref: ${a.exampleClaim}`);
    if (a.denialPattern) lines.push(`    Known pattern: ${a.denialPattern}`);
    if (a.stance) lines.push(`    Stance: ${a.stance}`);
    return lines.join('\n');
  }).join('\n\n');
}

function shapeStrategies(strategies: StrategyEntry[]): string {
  if (strategies.length === 0) return '(no carrier-specific strategies known yet)';
  return strategies.map((s, i) => {
    const parts: string[] = [];
    if (s.carrierTactic) parts.push(`CARRIER TACTIC: ${s.carrierTactic}`);
    if (s.rooferTactic) parts.push(`ROOFER COUNTER: ${s.rooferTactic}`);
    if (s.lessonForAnalyzer) parts.push(`LESSON FOR YOU (the analyzer): ${s.lessonForAnalyzer}`);
    return `  STRATEGY ${i + 1}:\n    ${parts.join('\n    ')}`;
  }).join('\n\n');
}

/** Pick the most useful few-shot examples for this carrier.
 * Priority: carrier-matched gmail-thread w/ counterText > carrier-matched rd-canon > carrier-matched rep-chatter > generic rd-canon.
 * Carrier match is CONTAINS-based since corpus entries include legal-entity-suffix variants
 * ("Allstate Indemnity Company", "Liberty Mutual Insurance" etc.) — exact match is too strict. */
function selectFewShot(corpus: DenialCorpus, carrier: string, max = 4): DenialCorpusEntry[] {
  if (!corpus || !corpus.entries || corpus.entries.length === 0) return [];
  const target = (carrier || '').toLowerCase().trim();
  const entries = corpus.entries;
  const matchesCarrier = (e: DenialCorpusEntry): boolean => {
    if (!target || !e.carrier) return false;
    const c = e.carrier.toLowerCase();
    // Exact match OR substring match either direction (handles "Allstate" → "Allstate Indemnity Company")
    return c === target || c.includes(target) || target.includes(c);
  };
  const rank = (e: DenialCorpusEntry): number => {
    const carrierMatch = matchesCarrier(e) ? 100 : 0;
    const hasCounter = e.counterText ? 30 : 0;
    const sourceScore = e.sourceType === 'gmail-thread' ? 25 : e.sourceType === 'pdf-archive' ? 20 : e.sourceType === 'rd-canon' ? 15 : e.sourceType === 'rep-chatter' ? 5 : 0;
    // Reward longer/richer entries up to 25 pts (was 10)
    const textQuality = Math.min(25, (e.denialText || '').length / 150);
    return carrierMatch + hasCounter + sourceScore + textQuality;
  };
  const ranked = [...entries].sort((a, b) => rank(b) - rank(a));
  // Filter out anything with <100 chars of denial text (too thin)
  const usable = ranked.filter((e) => (e.denialText || '').length >= 100);
  return usable.slice(0, max);
}

function shapeFewShot(examples: DenialCorpusEntry[]): string {
  if (examples.length === 0) return '(no past denials in corpus matching this carrier)';
  return examples
    .map((e, i) => {
      const counter = e.counterText
        ? `\n  ROOF DOCS COUNTER: ${e.counterText.slice(0, 800)}`
        : '';
      const meta = [
        e.carrier ? `carrier=${e.carrier}` : '',
        e.adjuster ? `adjuster=${e.adjuster}` : '',
        e.outcome ? `outcome=${e.outcome}` : '',
        e.dateOfDenial ? `date=${e.dateOfDenial}` : '',
      ].filter(Boolean).join(', ');
      return `EXAMPLE ${i + 1} (${e.sourceType}${meta ? ' · ' + meta : ''}):\n  DENIAL TEXT: ${e.denialText.slice(0, 1000)}${counter}`;
    })
    .join('\n\n');
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
- DENIAL POSTURE — not every adverse outcome is a full denial. Classify the letter:
  • "full-denial": carrier rejects the claim entirely / no payment
  • "partial-approval-undersized": carrier approves coverage but UNDER-COUNTS scope (e.g., 16.51 of 18.81 sq, single-slope when matching applies, missing accessories). Common USAA AI tell.
  • "partial-approval-coverage-limited": carrier approves some components, denies others (e.g., roof denied, siding approved, water damage approved)
  • "acv-payment-only": carrier approves but withholds depreciation pending repair — common Travelers pattern
  • "supplement-rejected": carrier responds to a supplement request with denial of additional scope
  • "approval-full": clean full approval (rare in this corpus but flag if present)
  When posture is "partial-approval-undersized": the counter is a SUPPLEMENT REQUEST with measurement evidence, NOT an appeal of denial. Tone is conversational/factual, not adversarial.
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
  "denialPosture": "full-denial|partial-approval-undersized|partial-approval-coverage-limited|acv-payment-only|supplement-rejected|approval-full",
  "denialReasons": [
    { "verbatimQuote": "EXACT text from letter, no paraphrase", "category": "wear-and-tear|prior-damage|maintenance|manufacturing-defect|installation|cosmetic|insufficient-evidence|scope-omission|matching-denied|depreciation-withheld|other" }
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
PAST DENIAL EXAMPLES FROM ROOF DOCS' REAL ARCHIVE (use as style/leverage reference; do NOT copy verbatim):
{{EXAMPLES}}

================
DETERMINISTIC BOILERPLATE MATCHES (these EXACT phrases from the incoming letter appear verbatim in past denials from this same carrier — STRONG aiTells / boilerplate signal):
{{BOILERPLATE}}

================
CARRIER-SPECIFIC STRATEGIES (curated from past Roof Docs experience with this carrier — use these to guide your recommendedActions, counterLetter, and badFaithSignals fields):
{{STRATEGIES}}

================
SPECIFIC ADJUSTER INTEL (we have prior history with these adjusters — use known patterns + escalation paths):
{{ADJUSTERS}}

================
STANCE DIRECTIVE (controls ONLY the counterLetter + recommendedActions tone — every other field stays neutral analytical):
{{STANCE}}

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
  // Stance selection precedence:
  //   1. Explicit body.stanceVariant → use it (testing / replay)
  //   2. carrierHint provided → carrier-aware pick (uses recommended winner
  //      from denial_outcomes if that carrier has ≥3 outcomes per stance)
  //   3. Else → uniform random
  let stanceVariant: StanceVariant;
  let stanceSource: 'forced' | 'recommended' | 'random';
  if (isStanceVariant(body.stanceVariant)) {
    stanceVariant = body.stanceVariant;
    stanceSource = 'forced';
  } else if (carrierHint) {
    const picked = await pickStanceForCarrier(carrierHint);
    stanceVariant = picked.stance;
    stanceSource = picked.source;
  } else {
    stanceVariant = selectStance();
    stanceSource = 'random';
  }

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

  // Few-shot examples from the real denial corpus
  const corpus = await loadCorpus();
  const examples = corpus ? selectFewShot(corpus, carrierHint, 4) : [];

  // Deterministic boilerplate detection (runs BEFORE Gemini sees the letter)
  const boilerplate = await loadBoilerplate();
  const boilerplateMatches = detectBoilerplateMatches(denialText, carrierHint, boilerplate);
  const boilerplateText = boilerplateMatches.length > 0
    ? boilerplateMatches.map((m, i) => `  ${i + 1}. [${m.sourceType.toUpperCase()} · ${m.occurrencesInCorpus}x in ${m.carrier} corpus] "${m.phrase}"`).join('\n')
    : '(no exact boilerplate phrase matches detected in this letter for this carrier — Gemini should still scan for AI-tell patterns)';

  // Carrier-specific strategies — explicit guidance for Gemini
  const strategies = getCarrierStrategies(carrierHint, boilerplate);
  // Adjuster intel — match by name in the letter
  const allAdjusters = getCarrierAdjusters(carrierHint, boilerplate);
  const matchedAdjusters = findRelevantAdjusters(denialText, allAdjusters);

  const prompt = ANALYZE_PROMPT
    .replace('{{PATENTS}}', shapePatentsForPrompt(patents))
    .replace('{{EXAMPLES}}', shapeFewShot(examples))
    .replace('{{BOILERPLATE}}', boilerplateText)
    .replace('{{STRATEGIES}}', shapeStrategies(strategies))
    .replace('{{ADJUSTERS}}', shapeAdjusters(matchedAdjusters))
    .replace('{{STANCE}}', STANCE_DIRECTIVES[stanceVariant])
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
    const corpusExamplesUsed = examples.map((e) => ({ id: e.id, source: e.source, carrier: e.carrier }));
    const patentsConsidered = patents.map((p) => p.id);

    // Durable intake — fire-and-forget so analyzer latency isn't blocked on DB
    let intakeId: number | null = null;
    try {
      intakeId = await recordIntake(req, {
        carrier: carrierHint,
        denialText,
        analysis: parsed,
        patentsConsidered,
        corpusExamplesUsed,
        stanceVariant,
      });
    } catch {
      // Already swallowed inside recordIntake — defensive double-catch
    }

    res.json({
      generated: new Date().toISOString(),
      model: MODEL,
      carrierHint,
      stanceVariant,
      stanceSource,
      patentsConsidered,
      corpusExamplesUsed,
      boilerplateMatches,
      matchedAdjusters: matchedAdjusters.map((a) => ({ name: a.name, email: a.email, denialPattern: a.denialPattern })),
      intakeId,
      analysis: parsed,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'unknown';
    res.status(500).json({ error: 'gemini_error', detail: msg });
  }
}
