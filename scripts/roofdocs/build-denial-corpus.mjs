// Build the denial corpus from all available local sources.
//
// Reads:
//   - GroupMe archive at ~/groupme-archive/groupme.db (denial-mentioning msgs)
//   - Susan AI knowledge_base at ~/susan_ai_21/susan_knowledge_comprehensive.db
//   - Roof Docs denial PDFs in ~/Downloads/_Organized/PDFs/
//   - data/denial-sources/gmail-*.json (pre-pulled Gmail threads if present)
//
// Writes: data/denial-corpus.json
//
// Output shape:
//   {
//     generated: ISO,
//     stats: { totalEntries, byCarrier, bySource },
//     entries: [
//       { id, source, sourceType, carrier, adjuster, denialText,
//         counterText?, context?, outcome?, dateOfDenial?, dateAdded }
//     ]
//   }
//
// The Denial Analyzer reads this corpus and injects 3-5 most-similar entries
// into each prompt as few-shot examples (filtered by carrier).

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import os from 'node:os';

const HOME = os.homedir();
const RIQ_BASE = process.env.RIQ_BASE || '/Users/a21/Desktop/storm-maps';
const OUT = path.join(RIQ_BASE, 'data/denial-corpus.json');
const SOURCES_DIR = path.join(RIQ_BASE, 'data/denial-sources');

fs.mkdirSync(SOURCES_DIR, { recursive: true });

const entries = [];

// ============ 1. Real PDF denials ============
function pullPdfDenials() {
  const folder = path.join(HOME, 'Downloads/_Organized/PDFs');
  const targets = [
    {
      file: 'PL Property Full Denial_compressed.pdf',
      carrier: 'Nationwide',
      claimType: 'full-denial',
      caseRef: '957275-GP / Kym Gully',
    },
  ];
  for (const t of targets) {
    const fp = path.join(folder, t.file);
    if (!fs.existsSync(fp)) continue;
    try {
      const text = execSync(`pdftotext -layout "${fp}" -`, { timeout: 30000 }).toString();
      if (text.length < 200) continue;
      entries.push({
        id: 'pdf:' + t.file.replace(/[^a-z0-9]+/gi, '-').toLowerCase(),
        source: t.file,
        sourceType: 'pdf-archive',
        carrier: t.carrier,
        adjuster: extractAdjusterFromText(text) || null,
        denialText: cleanText(text).slice(0, 8000),
        outcome: null, // We don't know yet — could be tracked later
        denialCategory: t.claimType,
        dateOfDenial: extractDateFromText(text),
        caseRef: t.caseRef,
        dateAdded: new Date().toISOString(),
      });
      console.log(`  ✓ pdf: ${t.file} (${text.length} chars)`);
    } catch (e) {
      console.log(`  ✗ pdf ${t.file}: ${e.message}`);
    }
  }
}

// ============ 2. GroupMe Sales Team — denial chatter ============
function pullGroupMe() {
  const db = path.join(HOME, 'groupme-archive/groupme.db');
  if (!fs.existsSync(db)) {
    console.log('  ! groupme.db not at ~/groupme-archive/ — skipping');
    return;
  }
  const query = `
    SELECT g.name AS grp, datetime(m.created_at,'unixepoch') AS dt,
           m.sender_name AS rep, m.text AS msg
    FROM messages m JOIN groups g ON m.group_id = g.id
    WHERE g.name IN ('Sales Team','Office Staff')
      AND length(m.text) > 120
      AND (m.text LIKE '%denial%' OR m.text LIKE '%denied%'
           OR m.text LIKE '%wear and tear%' OR m.text LIKE '%cosmetic%'
           OR m.text LIKE '%partialed%' OR m.text LIKE '%full denial%'
           OR m.text LIKE '%partial approval%')
      AND m.sender_type = 'user'
    ORDER BY m.created_at DESC
    LIMIT 300;
  `;
  const out = execSync(`sqlite3 -separator '|||' "${db}" "${query.replace(/\s+/g, ' ')}"`, { maxBuffer: 50 * 1024 * 1024 });
  const lines = out.toString().split('\n').filter(Boolean);
  let kept = 0;
  for (const line of lines) {
    const parts = line.split('|||');
    if (parts.length < 4) continue;
    const [grp, dt, rep, msg] = parts;
    const carrier = guessCarrierFromText(msg);
    const adjuster = extractAdjusterFromText(msg);
    entries.push({
      id: 'gm:' + dt + ':' + rep.slice(0, 12).replace(/\s/g, '-'),
      source: `GroupMe ${grp}`,
      sourceType: 'rep-chatter',
      carrier,
      adjuster,
      denialText: cleanText(msg),
      outcome: extractOutcomeFromText(msg),
      denialCategory: msg.toLowerCase().includes('partial') ? 'partial' : (msg.toLowerCase().includes('denied') || msg.toLowerCase().includes('denial')) ? 'full-denial' : null,
      dateOfDenial: dt.slice(0, 10),
      reportedBy: rep,
      dateAdded: new Date().toISOString(),
    });
    kept++;
  }
  console.log(`  ✓ GroupMe: ${kept} denial-related messages`);
}

// ============ 3. Susan AI knowledge_base — denial-handling intel ============
function pullSusan() {
  const db = path.join(HOME, 'susan_ai_21/susan_knowledge_comprehensive.db');
  if (!fs.existsSync(db)) {
    console.log('  ! susan_knowledge_comprehensive.db not present — skipping');
    return;
  }
  const query = `
    SELECT id, category, question, answer, source_file
    FROM knowledge_base
    WHERE LOWER(question || ' ' || COALESCE(answer,'')) LIKE '%denial%'
       OR LOWER(question || ' ' || COALESCE(answer,'')) LIKE '%wear and tear%'
       OR LOWER(question || ' ' || COALESCE(answer,'')) LIKE '%partial%'
       OR LOWER(category) IN ('email_templates','sales_scripts','insurance')
    LIMIT 100;
  `;
  const out = execSync(`sqlite3 -separator '|||' "${db}" "${query.replace(/\s+/g, ' ')}"`, { maxBuffer: 50 * 1024 * 1024 });
  const lines = out.toString().split('\n').filter(Boolean);
  let kept = 0;
  for (const line of lines) {
    const parts = line.split('|||');
    if (parts.length < 5) continue;
    const [id, category, question, answer, source] = parts;
    entries.push({
      id: 'susan:' + id,
      source: 'Susan ' + (source || category),
      sourceType: 'rd-canon',
      carrier: guessCarrierFromText(question + ' ' + answer),
      adjuster: null,
      denialText: cleanText(question),
      counterText: cleanText(answer).slice(0, 4000),
      outcome: null,
      denialCategory: category,
      dateOfDenial: null,
      dateAdded: new Date().toISOString(),
    });
    kept++;
  }
  console.log(`  ✓ Susan: ${kept} denial-handling entries`);
}

// ============ 4. Pre-pulled Gmail threads ============
function pullGmailDump() {
  if (!fs.existsSync(SOURCES_DIR)) return;
  const files = fs.readdirSync(SOURCES_DIR).filter((f) => f.startsWith('gmail-') && f.endsWith('.json'));
  if (files.length === 0) {
    console.log('  ! No gmail-*.json in data/denial-sources/ — Gmail dump not run yet');
    return;
  }
  let kept = 0;
  for (const f of files) {
    try {
      const thread = JSON.parse(fs.readFileSync(path.join(SOURCES_DIR, f), 'utf8'));
      // Two schemas supported:
      //   v1: { messages: [{sender, body, date}] } — joined into one denialText
      //   v2: { denialText, counterText } — flat fields, used directly
      let allText = '';
      if (Array.isArray(thread.messages) && thread.messages.length > 0) {
        allText = thread.messages.map((m) => `[${m.sender || m.role || ''} ${m.date || ''}]\n${m.body || ''}`).join('\n\n');
      }
      // v2 fallback / supplement — extract text from any major content field
      if (!allText) {
        const parts = [];
        if (thread.denialText) parts.push(thread.denialText);
        if (thread.denialSummary) parts.push(thread.denialSummary);
        if (thread.carrierResponse) parts.push(thread.carrierResponse);
        if (thread.denialTemplate) parts.push('TEMPLATE: ' + thread.denialTemplate);
        if (thread.patternSummary) parts.push('PATTERN: ' + thread.patternSummary);
        if (thread.specificCarrierQuote_Kinnick) parts.push('VERBATIM: ' + thread.specificCarrierQuote_Kinnick);
        if (Array.isArray(thread.carrierPivots)) {
          for (const p of thread.carrierPivots) {
            if (p.claim) parts.push(`PIVOT ${p.pivot || '?'}: ${p.claim}`);
            if (p.rooferResponse) parts.push(`  ROOFER REPLY: ${p.rooferResponse}`);
          }
        }
        if (thread.counterText) parts.push('---COUNTER---\n' + thread.counterText);
        if (thread.homeownerCounter) parts.push('---HOMEOWNER COUNTER---\n' + thread.homeownerCounter);
        if (thread.rooferEscalationTemplate) parts.push('---ROOFER ESCALATION TEMPLATE---\n' + thread.rooferEscalationTemplate);
        allText = parts.filter(Boolean).join('\n\n');
      }
      if (!allText) continue;
      entries.push({
        id: 'gm-email:' + (thread.threadId || f.replace(/\.json$/, '')),
        source: 'Gmail: ' + (thread.subject || f),
        sourceType: 'gmail-thread',
        carrier: thread.carrier || guessCarrierFromText(allText),
        adjuster: thread.adjuster || extractAdjusterFromText(allText),
        denialText: cleanText(allText).slice(0, 14000),
        counterText: thread.counterText || null,
        outcome: thread.outcome || null,
        denialCategory: thread.denialCategory || null,
        dateOfDenial: thread.dateOfDenial || null,
        caseRef: thread.caseRef || thread.claimNumber || null,
        keyDenialLanguage: thread.keyDenialLanguage || null,
        carrierTactic: thread.carrierTactic || null,
        rooferTactic: thread.rooferTactic || null,
        patentMapping: thread.patentMapping || null,
        lessonForAnalyzer: thread.lessonForAnalyzer || null,
        dateAdded: new Date().toISOString(),
      });
      kept++;
    } catch (e) {
      console.log(`  ✗ gmail ${f}: ${e.message}`);
    }
  }
  console.log(`  ✓ Gmail dump: ${kept} threads`);
}

// ============ Helpers ============
function cleanText(s) {
  return String(s || '')
    .replace(/\s+/g, ' ')
    .replace(/[​-‏﻿]/g, '')
    .trim();
}

const CARRIER_PATTERNS = [
  ['Nationwide', /\bnationwide\b/i],
  ['State Farm', /\bstate\s*farm\b/i],
  ['Allstate', /\ballstate\b/i],
  ['USAA', /\busaa\b/i],
  ['Travelers', /\btravelers\b/i],
  ['Liberty Mutual', /\bliberty\s*mutual\b/i],
  ['Erie', /\berie\b/i],
  ['Safeco', /\bsafeco\b/i],
  ['Progressive', /\bprogressive\b/i],
  ['Farmers', /\bfarmers\b/i],
  ['Lemonade', /\blemonade\b/i],
  ['Geico', /\bgeico\b/i],
  ['Chubb', /\bchubb\b/i],
  ['MetLife', /\bmetlife\b/i],
  ['Encompass', /\bencompass\b/i],
  ['Hartford', /\bhartford\b/i],
  ['Plymouth Rock', /\bplymouth\s*rock\b/i],
  ['Amica', /\bamica\b/i],
];
function guessCarrierFromText(text) {
  const t = String(text || '');
  for (const [name, re] of CARRIER_PATTERNS) {
    if (re.test(t)) return name;
  }
  return null;
}

function extractAdjusterFromText(text) {
  const t = String(text || '');
  // Look for "<name>, claims adjuster" or "adjuster <name>" or "sincerely, <name>"
  const patterns = [
    /(?:claims?\s+adjuster|claim\s+rep|sr\.?\s+claims?\s+adjuster|senior\s+claims?\s+adjuster)\s*[:\-]?\s*([A-Z][a-z]+(?:\s+[A-Z]\.?)?\s+[A-Z][a-z]+)/i,
    /([A-Z][a-z]+\s+[A-Z][a-z]+)\s*,\s*(?:claims?\s+adjuster|senior\s+claims?\s+adjuster|claim\s+rep)/i,
    /sincerely\s*,?\s*([A-Z][a-z]+(?:\s+[A-Z]\.?)?\s+[A-Z][a-z]+)/i,
  ];
  for (const re of patterns) {
    const m = t.match(re);
    if (m && m[1].length < 60) return m[1].trim();
  }
  return null;
}

function extractDateFromText(text) {
  const t = String(text || '');
  // "Date prepared August 29, 2024" or "August 29, 2024"
  const m = t.match(/(?:date\s+prepared\s*[:\-]?\s*)?((?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2},?\s+\d{4})/i);
  if (m) {
    try {
      const d = new Date(m[1]);
      if (Number.isFinite(d.getTime())) return d.toISOString().slice(0, 10);
    } catch {}
  }
  return null;
}

function extractOutcomeFromText(text) {
  const t = String(text || '').toLowerCase();
  if (/\bapproved (off|after|via)\b|\bgot it approved\b|\bflipped\b|\bfull approval\b/.test(t)) return 'approved';
  if (/\bpartial below deductible\b|\bbelow deductible\b/.test(t)) return 'below-deductible';
  if (/\bpartial approval\b|\bpartialed\b/.test(t)) return 'partial';
  if (/\bdenied\b|\bdenial\b/.test(t)) return 'denied';
  return null;
}

// ============ Run ============
console.log('=== Building denial corpus ===');
pullPdfDenials();
pullGroupMe();
pullSusan();
pullGmailDump();

// Dedupe by id
const seen = new Set();
const unique = entries.filter((e) => {
  if (seen.has(e.id)) return false;
  seen.add(e.id);
  return true;
});

// ============ Pass 2: adjuster-name inference for unknown-carrier entries ============
// Build map of adjuster (last-name) → carrier from entries that have both,
// then re-tag entries that mention those adjuster names but have no carrier.
// Filter out title/role words that aren't actually personal names.
const TITLE_BLOCKLIST = new Set([
  'Adjuster','Claim','Claims','Senior','Specialist','Professional','Resolution',
  'Property','Field','Manager','Supervisor','Coordinator','Representative',
  'Catastrophe','Mutual','Insurance','Company','Group','Indemnity','National',
  'Inc','LLC','Department','Service','Services','Center','Team','Auto',
  'Casualty','Property','America','American','Mobile','Office','Phone','Fax',
  'Cell','Email','Direct','Sincerely','Best','Regards','Thanks','Hello','Dear',
  'Mr','Ms','Mrs','State','Farm','Allstate','Travelers','USAA','Nationwide',
  'Liberty','Erie','Encompass','Hartford','Chubb','Geico','Progressive','Lemonade',
  'Safeco','Plymouth','Amica','Selective','Cincinnati','Modern','Federal','License',
  'Toll','Free','Box','PO','Property','Resolution','Reliance','Capacity',
  'Catastrophic','Wcc','Wccs','Deployed','Outside','Inside','Virtual','Loss',
  'Roof','Roof-ER','Inside','Outside','Workforce',
]);
const adjusterToCarrier = new Map();
for (const e of unique) {
  if (!e.adjuster || !e.carrier) continue;
  const tokens = e.adjuster.match(/\b[A-Z][a-z]{3,}\b/g) || [];
  // Names usually come as FIRST + LAST pairs at the start of the field — take the FIRST 2 non-blocklist tokens
  let firstName = null, lastName = null;
  for (const t of tokens) {
    if (TITLE_BLOCKLIST.has(t)) continue;
    if (!firstName) { firstName = t; continue; }
    if (!lastName) { lastName = t; break; }
  }
  if (firstName && lastName) {
    const fullName = firstName + ' ' + lastName;
    if (!adjusterToCarrier.has(fullName)) adjusterToCarrier.set(fullName, e.carrier);
    // Also map last-name-only IF distinctive (5+ chars)
    if (lastName.length >= 5 && !adjusterToCarrier.has(lastName)) {
      adjusterToCarrier.set(lastName, e.carrier);
    }
  }
}
let inferred = 0;
for (const e of unique) {
  if (e.carrier) continue;
  const txt = e.denialText || '';
  for (const [name, carrier] of adjusterToCarrier) {
    if (TITLE_BLOCKLIST.has(name)) continue;
    if (new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(txt)) {
      e.carrier = carrier;
      e.carrierInferredFrom = 'adjuster:' + name;
      inferred++;
      break;
    }
  }
}
console.log(`Adjuster-name inference: ${inferred} entries re-tagged from ${adjusterToCarrier.size} known adjuster names`);

// Stats
const byCarrier = {};
const bySource = {};
for (const e of unique) {
  const c = e.carrier || '(unknown)';
  byCarrier[c] = (byCarrier[c] || 0) + 1;
  bySource[e.sourceType] = (bySource[e.sourceType] || 0) + 1;
}

const result = {
  generated: new Date().toISOString(),
  stats: { totalEntries: unique.length, byCarrier, bySource },
  entries: unique,
};

fs.writeFileSync(OUT, JSON.stringify(result, null, 2));
const mb = (fs.statSync(OUT).size / 1024).toFixed(1);
console.log(`\n=== Wrote ${OUT} (${mb} KB) ===`);
console.log('Total:', unique.length);
console.log('By carrier:', JSON.stringify(byCarrier, null, 2));
console.log('By source:', JSON.stringify(bySource, null, 2));
