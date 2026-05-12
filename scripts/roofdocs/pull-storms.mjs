#!/usr/bin/env node
// Pull IEM LSR by month (full unfiltered) to stay under the 10k/call cap.
// Filter to hail/wind client-side after.

import fs from 'node:fs';
import fsp from 'node:fs/promises';

const OUT_DIR = '/Users/a21/Desktop/storm-maps/data/storms';
const STATES = 'VA,MD,PA,DC,DE,NJ,WV';
const START_YEAR = 2018;
const END_YEAR = 2026;
const END_MONTH = 5;

await fsp.mkdir(OUT_DIR, { recursive: true });

async function fetchMonth(year, month) {
  const sm = month.toString().padStart(2, '0');
  const nm = (month + 1).toString().padStart(2, '0');
  const sts = `${year}-${sm}-01T00:00`;
  const ets = month === 12 ? `${year + 1}-01-01T00:00` : `${year}-${nm}-01T00:00`;
  const url = `https://mesonet.agron.iastate.edu/geojson/lsr.geojson?sts=${sts}&ets=${ets}&states=${STATES}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${year}-${sm}`);
  const body = await res.json();
  return body.features || [];
}

const all = [];
const seen = new Set();
for (let y = START_YEAR; y <= END_YEAR; y++) {
  const lastMonth = y === END_YEAR ? END_MONTH : 12;
  for (let m = 1; m <= lastMonth; m++) {
    try {
      const feats = await fetchMonth(y, m);
      let added = 0;
      for (const f of feats) {
        // Dedupe by product_id + valid + lat/lon (covers cross-month edge cases)
        const p = f.properties || {};
        const key = `${p.product_id}|${p.valid}|${(f.geometry || {}).coordinates}`;
        if (seen.has(key)) continue;
        seen.add(key);
        all.push(f);
        added++;
      }
      const flag = feats.length >= 10000 ? ' ⚠ AT LIMIT' : '';
      console.log(`  ${y}-${m.toString().padStart(2, '0')}: ${feats.length} reports, +${added} new (total ${all.length})${flag}`);
    } catch (e) {
      console.error(`  FAIL ${y}-${m}: ${e}`);
    }
  }
}

// Stats by typetext
const typeCounter = {};
const stateCounter = {};
for (const f of all) {
  const p = f.properties || {};
  typeCounter[p.typetext] = (typeCounter[p.typetext] || 0) + 1;
  stateCounter[p.state] = (stateCounter[p.state] || 0) + 1;
}
console.log('\nState distribution:', Object.entries(stateCounter).sort((a, b) => b[1] - a[1]).slice(0, 12));
console.log('Top types:', Object.entries(typeCounter).sort((a, b) => b[1] - a[1]).slice(0, 15));

const fc = { type: 'FeatureCollection', features: all };
const outFile = `${OUT_DIR}/iem-lsr-monthly-${START_YEAR}-${END_YEAR}.json`;
await fsp.writeFile(outFile, JSON.stringify(fc));
console.log(`\nWrote ${outFile} — ${all.length} unique features`);

// Also write a filtered hail/wind-only file for fast cross-reference
const HAIL_WIND = ['HAIL', 'TSTM WND DMG', 'TSTM WND GST', 'NON-TSTM WND DMG', 'NON-TSTM WND GST', 'TORNADO', 'FUNNEL CLOUD'];
const hailWind = all.filter((f) => HAIL_WIND.includes((f.properties || {}).typetext));
const hwFile = `${OUT_DIR}/iem-hail-wind-${START_YEAR}-${END_YEAR}.json`;
await fsp.writeFile(hwFile, JSON.stringify({ type: 'FeatureCollection', features: hailWind }));
console.log(`Wrote ${hwFile} — ${hailWind.length} hail/wind features`);
