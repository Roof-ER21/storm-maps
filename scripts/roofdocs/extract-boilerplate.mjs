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

const RIQ_BASE = process.env.RIQ_BASE || '/Users/a21/Desktop/storm-maps';
const CORPUS_PATH = path.join(RIQ_BASE, 'data/denial-corpus.json');
const OUT_PATH = path.join(RIQ_BASE, 'data/carrier-boilerplate.json');

const corpus = JSON.parse(fs.readFileSync(CORPUS_PATH, 'utf8'));

// --- normalization helpers ---
function normalizeCarrier(name) {
  if (!name) return null;
  const n = String(name).toLowerCase().trim();
  // Collapse legal-entity variants to canonical carrier names
  if (n.includes('allstate')) return 'Allstate';
  if (n.includes('state farm')) return 'State Farm';
  if (n.includes('usaa')) return 'USAA';
  if (n.includes('liberty mutual') || n.includes('safeco')) return 'Liberty Mutual';
  if (n.includes('nationwide')) return 'Nationwide';
  if (n.includes('travelers')) return 'Travelers';
  if (n.includes('erie')) return 'Erie';
  if (n.includes('encompass')) return 'Encompass';
  if (n.includes('utica')) return 'Utica National';
  if (n.includes('amig') || n.includes('american modern') || n.includes('cincinnati')) return 'AMIG (Cincinnati Financial)';
  if (n.includes('progressive')) return 'Progressive';
  if (n.includes('geico')) return 'Geico';
  if (n.includes('chubb')) return 'Chubb';
  if (n.includes('lemonade')) return 'Lemonade';
  if (n.includes('hartford')) return 'The Hartford';
  if (n.includes('selective')) return 'Selective';
  if (n.includes('safeco')) return 'Safeco';
  if (n.includes('farmers')) return 'Farmers';
  return null;
}

function cleanText(s) {
  return String(s || '')
    .replace(/[­-‏﻿]/g, '')
    // Strip rep names/signatures we don't want as carrier patterns
    .replace(/Best,\s*[A-Z][a-z]+ [A-Z][a-z]+/g, '')
    .replace(/\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g, '###PHONE###')
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '###EMAIL###')
    .replace(/\$\d[\d,.]*/g, '###AMOUNT###')
    .replace(/\d{1,2}\/\d{1,2}\/\d{2,4}/g, '###DATE###')
    .replace(/\s+/g, ' ')
    .trim();
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

function extractPhrases(texts, minLen = 5, maxLen = 14) {
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

const result = {
  generated: new Date().toISOString(),
  description: 'Per-carrier boilerplate phrases detected via n-gram analysis of denial corpus. Each phrase appears in 2+ denials from the same carrier — strong signal that the carrier reuses templated/AI-generated language across claims.',
  source: 'data/denial-corpus.json',
  byCarrier,
  totalCarriers: Object.keys(byCarrier).length,
  totalPhrases: Object.values(byCarrier).reduce((sum, c) => sum + c.phrases.length, 0),
};

fs.writeFileSync(OUT_PATH, JSON.stringify(result, null, 2));
const kb = (fs.statSync(OUT_PATH).size / 1024).toFixed(1);
console.log(`\nWrote ${OUT_PATH} (${kb} KB)`);
console.log(`  Total carriers: ${result.totalCarriers}`);
console.log(`  Total phrases: ${result.totalPhrases}`);
