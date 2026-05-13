#!/usr/bin/env node
/**
 * RIQ 21 Denial Corpus — Coverage Stats
 *
 * Reports what's in the denial-corpus + carrier-boilerplate + adjuster rosters
 * so Ahmed can see at a glance: who's well-covered, who has gaps, what the
 * analyzer can actually handle.
 *
 * Run: node scripts/roofdocs/corpus-stats.mjs
 */
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { normalizeCarrier, listCanonicalCarriers } from '../../server/intel/carrier-normalize.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '../..');
const DENIAL_DIR = path.join(ROOT, 'data', 'denial-sources');
const BOILERPLATE_FILE = path.join(ROOT, 'data', 'carrier-boilerplate.json');

const CARRIERS = listCanonicalCarriers();

async function main() {
  // Pull every denial-source JSON
  const files = (await fs.readdir(DENIAL_DIR)).filter(f => f.endsWith('.json'));
  const stats = {
    totalFiles: files.length,
    perCarrier: {},
    rosters: {},
    postureCounts: {
      'full-denial': 0,
      'partial-approval-undersized': 0,
      'partial-approval-coverage-limited': 0,
      'acv-payment-only': 0,
      'supplement-rejected': 0,
      'approval-full': 0,
      'unknown': 0,
    },
    adjustersByCarrier: {},
    rosterFiles: [],
  };

  for (const f of files) {
    const raw = await fs.readFile(path.join(DENIAL_DIR, f), 'utf-8');
    let json;
    try { json = JSON.parse(raw); } catch { continue; }

    const carrier = normalizeCarrier(json.carrier);

    // Roster files
    if (Array.isArray(json.adjusterRoster)) {
      stats.rosterFiles.push(f);
      stats.adjustersByCarrier[carrier || json.carrier] = stats.adjustersByCarrier[carrier || json.carrier] || new Set();
      for (const a of json.adjusterRoster) {
        if (a.name) stats.adjustersByCarrier[carrier || json.carrier].add(a.name);
      }
      continue;
    }

    if (!carrier) continue;

    stats.perCarrier[carrier] = stats.perCarrier[carrier] || {
      total: 0, withDenialText: 0, withClaimNumber: 0, withAdjuster: 0, withCounter: 0, files: [],
    };
    const s = stats.perCarrier[carrier];
    s.total += 1;
    s.files.push(f);
    if (json.denialText || json.messages?.length) s.withDenialText += 1;
    if (json.claimNumber || json.claim) s.withClaimNumber += 1;
    if (json.adjuster) s.withAdjuster += 1;
    if (json.counterText || json.homeownerCounter || json.rooferEscalationTemplate) s.withCounter += 1;

    // Posture inference from category/outcome
    const cat = (json.denialCategory || '').toLowerCase();
    const out = (json.outcome || '').toLowerCase();
    let posture = 'unknown';
    if (cat.includes('partial-scope') || cat.includes('under-count') || cat.includes('omission')) posture = 'partial-approval-undersized';
    else if (cat.includes('full-denial') || cat.includes('denied')) posture = 'full-denial';
    else if (cat.includes('partial')) posture = 'partial-approval-coverage-limited';
    else if (cat.includes('acv') || cat.includes('depreciation')) posture = 'acv-payment-only';
    else if (cat.includes('supplement')) posture = 'supplement-rejected';
    else if (out.includes('approval') && !out.includes('partial')) posture = 'approval-full';
    stats.postureCounts[posture] = (stats.postureCounts[posture] || 0) + 1;

    // Track adjusters from non-roster files too
    if (json.adjuster) {
      stats.adjustersByCarrier[carrier] = stats.adjustersByCarrier[carrier] || new Set();
      const name = json.adjuster.split(/[,(]|—/)[0].trim();
      if (name && name.length < 60) stats.adjustersByCarrier[carrier].add(name);
    }
  }

  // Boilerplate
  let boilerplate;
  try {
    boilerplate = JSON.parse(await fs.readFile(BOILERPLATE_FILE, 'utf-8'));
  } catch { boilerplate = null; }

  // Output
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  RIQ 21 Denial Corpus Coverage Report');
  console.log('  Generated:', new Date().toISOString());
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log(`Total denial-source files: ${stats.totalFiles}`);
  console.log(`Roster files: ${stats.rosterFiles.length}`);
  console.log(`Carriers tracked: ${Object.keys(stats.perCarrier).length}\n`);

  console.log('── PER-CARRIER COVERAGE ──');
  const carrierOrder = Object.keys(stats.perCarrier).sort((a, b) => stats.perCarrier[b].total - stats.perCarrier[a].total);
  for (const c of carrierOrder) {
    const s = stats.perCarrier[c];
    const adjusterCount = stats.adjustersByCarrier[c]?.size || 0;
    const bp = boilerplate?.byCarrier?.[c];
    const phraseCount = (bp?.phrases?.length || 0) + (bp?.curatedPhrases?.length || 0);
    const flag = s.total < 2 ? '⚠️  LOW' : s.total < 4 ? '🟡 OK' : '✅ STRONG';
    console.log(`  ${c.padEnd(34)} ${flag}  · ${s.total} denials · ${adjusterCount} named adjusters · ${phraseCount} boilerplate phrases`);
  }

  console.log('\n── POSTURE DISTRIBUTION ──');
  for (const [posture, count] of Object.entries(stats.postureCounts)) {
    if (count > 0) console.log(`  ${posture.padEnd(36)} ${count}`);
  }

  console.log('\n── KNOWN GAPS ──');
  const gaps = [];
  for (const c of CARRIERS) {
    const s = stats.perCarrier[c];
    if (!s) gaps.push(`  ❌ ${c}: NO denial files`);
    else if (s.total < 2) gaps.push(`  ⚠️  ${c}: only ${s.total} denial — boilerplate extraction skipped (need ≥2)`);
    else if ((stats.adjustersByCarrier[c]?.size || 0) === 0) gaps.push(`  ⚠️  ${c}: ${s.total} denials but ZERO named adjusters captured`);
  }
  if (gaps.length === 0) console.log('  (none — every tracked carrier has ≥2 denials + ≥1 adjuster)');
  else for (const g of gaps) console.log(g);

  console.log('\n── BOILERPLATE FILE ──');
  if (boilerplate) {
    console.log(`  ${BOILERPLATE_FILE}`);
    console.log(`  carriers: ${Object.keys(boilerplate.byCarrier || {}).length}`);
    let totalPhrases = 0;
    for (const c of Object.values(boilerplate.byCarrier || {})) {
      totalPhrases += (c.phrases?.length || 0) + (c.curatedPhrases?.length || 0);
    }
    console.log(`  total phrases: ${totalPhrases}`);
  } else {
    console.log('  ⚠️  carrier-boilerplate.json not found — run extract-boilerplate.mjs');
  }

  console.log('\n═══════════════════════════════════════════════════════════════');
}

main().catch(e => { console.error(e); process.exit(1); });
