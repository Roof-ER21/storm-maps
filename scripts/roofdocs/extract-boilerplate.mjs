// Per-carrier boilerplate detector — scans denial-corpus.json for repeated
// phrases that appear in 2+ denials from the same carrier. These are the
// algorithmic/template fingerprints carriers reuse across claims.
//
// Output: data/carrier-boilerplate.json
//   { generated, byCarrier: { CarrierName: [{phrase, occurrences, examples[]}] } }
//
// The Denial Analyzer can use this for DETERMINISTIC pre-LLM detection:
// when an incoming denial contains any of a carrier's known boilerplate
// phrases, flag it as AI-generated and inject into the prompt as evidence.
//
// Why deterministic detection matters: an Allstate adjuster citing "our
// coverage decision stands" is hard to argue with as an opinion. But when
// THE SAME PHRASE appears in 8 other Allstate denials we have on file,
// that's evidence of template-driven (likely AI-generated) language —
// admissible in bad-faith arguments under 2026 case law.

import fs from 'node:fs';
import path from 'node:path';
import { normalizeCarrier } from '../../server/intel/carrier-normalize.mjs';

const RIQ_BASE = process.env.RIQ_BASE || '/Users/a21/RIQ21';
const CORPUS_PATH = path.join(RIQ_BASE, 'data/denial-corpus.json');
const OUT_PATH = path.join(RIQ_BASE, 'data/carrier-boilerplate.json');

const corpus = JSON.parse(fs.readFileSync(CORPUS_PATH, 'utf8'));

function cleanText(s) {
  let txt = String(s || '');

  // V2: aggressively strip non-substantive content BEFORE n-gram analysis
  const noiseFilters = [
    // Email footers / signature blocks
    /With 24\/7 access[\s\S]*?(?=\n\n|$)/gi,
    /Available to Insureds[\s\S]*?(?=\n\n|$)/gi,
    /CONFIDENTIAL[\s\S]*?(?=\n\n|$)/gi,
    /Taking care of our members[\s\S]*?(?=\n\n|$)/gi,
    /CONFIDENTIALITY[\s\S]*?STATEMENT[\s\S]*?(?=\n\n|$)/gi,
    /PRIVACY NOTICE[\s\S]*?(?=\n\n|$)/gi,
    /Go Digital[\s\S]*?(?=\n\n|$)/gi,
    /Need Roadside Assistance[\s\S]*?(?=\n\n|$)/gi,
    /To ensure delivery[\s\S]*?address book\.?/gi,
    /This message[\s\S]*?intended recipient/gi,
    /\[metadata[\s\S]*?\]/gi,
    /\[COMUID[\s\S]*?\]/gi,
    /TRVDiscDefault::\d+/gi,
    // Address blocks / boilerplate carrier addresses
    /P\.?O\.?\s*Box[\s\S]*?\d{5}/gi,
    /\d{1,4}\s+[A-Z][a-z]+\s+(St|Ave|Road|Rd|Blvd|Drive|Dr|Way)\b[\s\S]*?\d{5}/gi,
    // Email-app callouts
    /Sent from my (iPhone|Android|Samsung|Verizon)[\s\S]*?(?=\n|$)/gi,
    /Get Outlook for[\s\S]*?(?=\n|$)/gi,
    // Adjuster signature blocks: looks like "Name, Title \n Org \n Phone..."
    /Sincerely,\s*\n[\s\S]{0,600}?(?=\n\n|$)/gi,
    /Regards,\s*\n[\s\S]{0,600}?(?=\n\n|$)/gi,
    /Best regards,\s*\n[\s\S]{0,600}?(?=\n\n|$)/gi,
    // Roof-ER rep sign-offs (we want CARRIER language only, not Roof-ER's)
    /Best,?\s*\n\s*\*?[A-Z][a-z]+ [A-Z][a-z]+\*?[\s\S]*?Roof.?ER[\s\S]*?(?=\n\n|$)/gi,
    /Roof\s*Doc\s*I\s*Roof.?ER[\s\S]*?(?=\n\n|$)/gi,
    /Director\s*I\s*Roof.?ER[\s\S]*?(?=\n\n|$)/gi,
    /Senior\s*Field\s*Rep\s*I\s*Roof.?ER[\s\S]*?(?=\n\n|$)/gi,
    /Operations\s*I\s*Roof.?ER[\s\S]*?(?=\n\n|$)/gi,
    /https?:\/\/theroofdocs\.com\/?/gi,
    /https?:\/\/\S+/gi,
    // Forward chain markers
    /----+\s*Forwarded message\s*----+/gi,
    /From:\s+[A-Z][\s\S]*?Subject:[^\n]*\n/gi,
    /Sent:\s+\w+,?\s+\w+ \d+,?\s+\d{4}[\s\S]*?(?=\n)/gi,
    /On \w+,?\s+\w+\s+\d+,?\s+\d{4}.*?wrote:/gi,
  ];
  for (const re of noiseFilters) txt = txt.replace(re, ' ');

  txt = txt
    .replace(/[­-‏﻿]/g, '')
    .replace(/\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g, '###PHONE###')
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '###EMAIL###')
    .replace(/\$\d[\d,.]*/g, '###AMOUNT###')
    .replace(/\d{1,2}\/\d{1,2}\/\d{2,4}/g, '###DATE###')
    .replace(/\b\d{4,}\b/g, '###NUM###') // strip claim numbers etc
    .replace(/\s+/g, ' ')
    .trim();
  return txt;
}

// Build per-carrier text bundles (only from carrier-spoken text, not roofer/homeowner replies)
const carrierTexts = {}; // canonicalCarrier -> [{ source, text }]
for (const e of corpus.entries || []) {
  const canonical = normalizeCarrier(e.carrier);
  if (!canonical) continue;
  // Skip rep-chatter (it's about carriers, not from them) for this analysis
  if (e.sourceType === 'rep-chatter') continue;
  // For gmail-thread entries, prefer denialText (already extracted carrier-spoken)
  let txt = e.denialText || '';
  if (!txt) continue;
  // Strip the COUNTER/HOMEOWNER COUNTER sections we appended in build-denial-corpus
  txt = txt.split(/---(?:COUNTER|HOMEOWNER COUNTER|ROOFER ESCALATION TEMPLATE)---/i)[0];
  if (!carrierTexts[canonical]) carrierTexts[canonical] = [];
  carrierTexts[canonical].push({ source: e.source || e.id, text: cleanText(txt) });
}

// --- n-gram extraction ---
// Extract 5-12 word phrases that appear in 2+ denials from same carrier.
// Use word boundary tokens to handle slight word-order variation.

function extractPhrases(texts, minLen = 3, maxLen = 10) {
  // For each text, sentence-split and find common n-gram phrases across texts.
  const phraseCounts = new Map(); // phrase -> Set of texts it appears in (with refs)
  for (let i = 0; i < texts.length; i++) {
    const t = texts[i];
    // Tokenize sentences crudely on punctuation
    const sentences = t.text.split(/(?<=[.!?])\s+/).filter(s => s.length > 30);
    for (const s of sentences) {
      const words = s.toLowerCase().split(/\s+/).filter(w => w.length > 1);
      if (words.length < minLen) continue;
      for (let len = minLen; len <= Math.min(maxLen, words.length); len++) {
        for (let start = 0; start + len <= words.length; start++) {
          const phrase = words.slice(start, start + len).join(' ');
          // Reject phrases that are mostly anonymized tokens
          const placeholderCount = (phrase.match(/###\w+###/g) || []).length;
          if (placeholderCount > 1) continue;
          if (!phraseCounts.has(phrase)) phraseCounts.set(phrase, new Set());
          phraseCounts.get(phrase).add(i);
        }
      }
    }
  }
  // Keep only phrases appearing in 2+ distinct denials
  const candidates = [];
  for (const [phrase, idxSet] of phraseCounts) {
    if (idxSet.size < 2) continue;
    candidates.push({ phrase, occurrences: idxSet.size, exampleIdxs: [...idxSet] });
  }
  // Sort: longest with most occurrences first (longer = more diagnostic)
  candidates.sort((a, b) => {
    const aLen = a.phrase.length;
    const bLen = b.phrase.length;
    return (b.occurrences * 100 + bLen) - (a.occurrences * 100 + aLen);
  });
  // De-dup overlapping sub-phrases: if phrase A is a substring of phrase B AND B has same occurrence count, drop A.
  const kept = [];
  for (const c of candidates) {
    const isRedundant = kept.some(k => k.phrase.includes(c.phrase) && k.occurrences >= c.occurrences);
    if (!isRedundant) kept.push(c);
  }
  return kept;
}

// --- run per-carrier ---
const byCarrier = {};
console.log('Carriers with 2+ denials in corpus:');
for (const [carrier, texts] of Object.entries(carrierTexts)) {
  if (texts.length < 2) {
    console.log(`  ${carrier.padEnd(30)} ${texts.length} denial — skip (need 2+)`);
    continue;
  }
  const phrases = extractPhrases(texts);
  console.log(`  ${carrier.padEnd(30)} ${texts.length} denials → ${phrases.length} repeated phrases`);
  byCarrier[carrier] = {
    denialCount: texts.length,
    phrases: phrases.slice(0, 60).map(p => ({
      phrase: p.phrase,
      occurrences: p.occurrences,
      examples: p.exampleIdxs.slice(0, 3).map(i => ({
        source: texts[i].source,
        snippet: extractSnippet(texts[i].text, p.phrase),
      })),
    })),
  };
}

function extractSnippet(text, phrase) {
  const lc = text.toLowerCase();
  const idx = lc.indexOf(phrase);
  if (idx < 0) return text.slice(0, 200);
  const start = Math.max(0, idx - 80);
  const end = Math.min(text.length, idx + phrase.length + 80);
  return (start > 0 ? '...' : '') + text.slice(start, end) + (end < text.length ? '...' : '');
}

// === Second source: aggregate the hand-curated keyDenialLanguage arrays
// from each Gmail dump. These are higher quality than n-gram extraction
// because a human (me, while reading each thread) flagged them as the
// substantive denial-defining phrases. ===
const curated = {}; // canonicalCarrier -> Set of curated phrases
for (const e of corpus.entries || []) {
  const canonical = normalizeCarrier(e.carrier);
  if (!canonical) continue;
  const kdl = e.keyDenialLanguage;
  if (!Array.isArray(kdl) || kdl.length === 0) continue;
  if (!curated[canonical]) curated[canonical] = new Map();
  for (const phrase of kdl) {
    if (!phrase || typeof phrase !== 'string' || phrase.length < 10) continue;
    const norm = phrase.toLowerCase().trim();
    if (!curated[canonical].has(norm)) curated[canonical].set(norm, { phrase, sources: [] });
    curated[canonical].get(norm).sources.push(e.source || e.id);
  }
}

// === Third source: live denial_intake table — every analyzer call captures
// `analysis.denialReasons[].verbatimQuote` which is Gemini's extraction of
// the substantive denial language from an incoming letter. This means the
// boilerplate corpus AUTO-GROWS with each new intake. ===
let intakeAdded = 0;
const DATABASE_URL = process.env.DATABASE_URL || process.env.DATABASE_PUBLIC_URL;
if (DATABASE_URL) {
  try {
    const { default: postgres } = await import('postgres');
    const sql = postgres(DATABASE_URL, { ssl: DATABASE_URL.includes('railway.internal') ? false : { rejectUnauthorized: false }, max: 2, idle_timeout: 30 });
    const rows = await sql`
      SELECT id, COALESCE(identified_carrier, carrier) AS carrier, analysis
      FROM denial_intake
      WHERE analysis IS NOT NULL
      ORDER BY created_at DESC
      LIMIT 5000
    `;
    for (const r of rows) {
      const canonical = normalizeCarrier(r.carrier);
      if (!canonical) continue;
      const reasons = (r.analysis && r.analysis.denialReasons) || [];
      if (!Array.isArray(reasons)) continue;
      for (const reason of reasons) {
        const q = reason?.verbatimQuote;
        if (!q || typeof q !== 'string' || q.length < 15) continue;
        const norm = q.toLowerCase().trim();
        if (!curated[canonical]) curated[canonical] = new Map();
        if (!curated[canonical].has(norm)) {
          curated[canonical].set(norm, { phrase: q, sources: [] });
          intakeAdded++;
        }
        curated[canonical].get(norm).sources.push('intake:' + r.id);
      }
    }
    await sql.end();
    console.log(`Live intake: +${intakeAdded} unique phrases pulled from ${rows.length} denial_intake rows`);
  } catch (e) {
    console.warn('Live intake pull failed:', e.message);
  }
} else {
  console.log('No DATABASE_URL — skipping live intake source');
}

// Merge curated phrases into byCarrier (as a separate field)
for (const [carrier, phraseMap] of Object.entries(curated)) {
  if (!byCarrier[carrier]) byCarrier[carrier] = { denialCount: 0, phrases: [] };
  byCarrier[carrier].curatedPhrases = Array.from(phraseMap.values()).map(v => ({
    phrase: v.phrase,
    sources: v.sources,
    occurrences: v.sources.length,
  }));
}

// === Counter-strategies: aggregate carrierTactic / rooferTactic / lessonForAnalyzer
// fields from Gmail dumps so reps see HOW to fight each carrier's patterns. ===
for (const e of corpus.entries || []) {
  const canonical = normalizeCarrier(e.carrier);
  if (!canonical) continue;
  if (!byCarrier[canonical]) byCarrier[canonical] = {};
  if (!byCarrier[canonical].strategies) byCarrier[canonical].strategies = [];
  const strategy = {};
  if (e.carrierTactic) strategy.carrierTactic = e.carrierTactic;
  if (e.rooferTactic) strategy.rooferTactic = e.rooferTactic;
  if (e.lessonForAnalyzer) strategy.lessonForAnalyzer = e.lessonForAnalyzer;
  if (e.patentMapping) strategy.patentMapping = e.patentMapping;
  if (Object.keys(strategy).length > 0) {
    strategy.source = e.source;
    byCarrier[canonical].strategies.push(strategy);
  }
}

// === Adjuster rosters: pull adjusterRoster + templatePhrases arrays from
// the roster dump JSON files for per-carrier adjuster lookup. ===
const SOURCES_DIR = path.join(RIQ_BASE, 'data/denial-sources');
if (fs.existsSync(SOURCES_DIR)) {
  const rosterFiles = fs.readdirSync(SOURCES_DIR).filter(f => /team-roster/.test(f));
  for (const f of rosterFiles) {
    try {
      const dump = JSON.parse(fs.readFileSync(path.join(SOURCES_DIR, f), 'utf8'));
      const canonical = normalizeCarrier(dump.carrier);
      if (!canonical) continue;
      if (!byCarrier[canonical]) byCarrier[canonical] = {};
      if (Array.isArray(dump.adjusterRoster)) {
        byCarrier[canonical].adjusters = dump.adjusterRoster;
      }
      if (Array.isArray(dump.templatePhrases)) {
        byCarrier[canonical].templatePhrases = dump.templatePhrases;
      }
    } catch (e) {
      console.warn(`Roster ${f} failed:`, e.message);
    }
  }
}

const result = {
  generated: new Date().toISOString(),
  description: 'Per-carrier boilerplate phrases — two sources: (1) n-gram extraction across denial bodies finding phrases appearing in 2+ denials from same carrier; (2) hand-curated keyDenialLanguage arrays from each Gmail dump JSON. Curated is higher quality but limited to what I manually flagged while reading; n-gram is exhaustive but noisy.',
  source: 'data/denial-corpus.json + data/denial-sources/*.json',
  byCarrier,
  totalCarriers: Object.keys(byCarrier).length,
  totalNgramPhrases: Object.values(byCarrier).reduce((sum, c) => sum + (c.phrases?.length || 0), 0),
  totalCuratedPhrases: Object.values(byCarrier).reduce((sum, c) => sum + (c.curatedPhrases?.length || 0), 0),
};

fs.writeFileSync(OUT_PATH, JSON.stringify(result, null, 2));
const kb = (fs.statSync(OUT_PATH).size / 1024).toFixed(1);
console.log(`\nWrote ${OUT_PATH} (${kb} KB)`);
console.log(`  Total carriers: ${result.totalCarriers}`);
console.log(`  Total phrases: ${result.totalPhrases}`);
