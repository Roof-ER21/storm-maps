#!/usr/bin/env node
// Final pass on stubborn addresses. Aggressive cleaning + try address-only without state.

import fs from 'node:fs';

const RIQ_BASE = process.env.RIQ_BASE || "/Users/a21/storm-maps";

const FAILED = `${RIQ_BASE}/data/geocoded-failed.jsonl`;
const OUT = `${RIQ_BASE}/data/geocoded.json`;

const existing = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : {};

function aggressive(addr) {
  return addr
    .replace(/,\s*,/g, ',')
    .replace(/\s+,/g, ',')
    .replace(/\s+/g, ' ')
    .replace(/,\s*$/g, '')
    .trim()
    .split(/(\s|,)/)
    .map((w) => /^[a-z]+$/.test(w) && w.length > 2 ? w[0].toUpperCase() + w.slice(1) : w)
    .join('')
    .replace(/(\d+)([A-Za-z])/, '$1 $2')   // 62004 Crestwood → 62004 Crestwood
    .replace(/\bDrive\b/gi, 'Dr')
    .replace(/\bStreet\b/gi, 'St')
    .replace(/\bRoad\b/gi, 'Rd');
}

function dropApt(addr) {
  // Strip "Apt X" / "#X" / unit markers — sometimes confuses geocoder
  return addr.replace(/\s+(apt|unit|#)\s*[a-z0-9-]+/gi, '');
}

async function tryCensus(addr) {
  const url = `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=${encodeURIComponent(addr)}&benchmark=Public_AR_Current&format=json`;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!r.ok) return null;
    const b = await r.json();
    const m = b.result?.addressMatches || [];
    if (m.length) return { lat: m[0].coordinates.y, lng: m[0].coordinates.x };
  } catch {}
  return null;
}

async function tryNominatim(addr) {
  await new Promise((res) => setTimeout(res, 1200));
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(addr)}&format=json&limit=1`;
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'RoofDocs-Intel/1.0' }, signal: AbortSignal.timeout(15000) });
    if (!r.ok) return null;
    const b = await r.json();
    if (Array.isArray(b) && b.length > 0) return { lat: Number(b[0].lat), lng: Number(b[0].lon) };
  } catch {}
  return null;
}

const records = fs.readFileSync(FAILED, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
console.log(`Final cleanup pass on ${records.length} records…`);

let ok = 0, fail = 0, skipped = 0;
const stillFail = [];
for (const r of records) {
  // Skip "No Address" placeholders — can't geocode
  if (/no address/i.test(r.addr)) {
    skipped++;
    stillFail.push({ ...r, reason: 'no_address_placeholder' });
    continue;
  }
  const variants = [
    aggressive(r.addr),
    dropApt(aggressive(r.addr)),
    aggressive(r.addr).replace(/^\d+\s+/, ''),  // drop street number
  ];
  let coords = null;
  for (const v of variants) {
    coords = await tryCensus(v);
    if (coords) break;
  }
  if (!coords) coords = await tryNominatim(aggressive(r.addr));
  if (coords) {
    existing[r.jobID] = coords;
    ok++;
  } else {
    fail++;
    stillFail.push(r);
  }
  if ((ok + fail + skipped) % 10 === 0) console.log(`  [${ok + fail + skipped}/${records.length}] ok=${ok} fail=${fail} skipped=${skipped}`);
}
fs.writeFileSync(OUT, JSON.stringify(existing));
console.log(`\nDone. ${ok} recovered, ${fail} still failed, ${skipped} unresolvable.`);
console.log(`Total geocoded: ${Object.keys(existing).length}`);
fs.writeFileSync(FAILED, stillFail.map((r) => JSON.stringify(r)).join('\n') + (stillFail.length > 0 ? '\n' : ''));
