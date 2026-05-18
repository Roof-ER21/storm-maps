#!/usr/bin/env node
// Re-try the 110 failed records with address cleaning + Nominatim fallback.

import fs from 'node:fs';

const RIQ_BASE = process.env.RIQ_BASE || "/Users/a21/storm-maps";

const FAILED = `${RIQ_BASE}/data/geocoded-failed.jsonl`;
const OUT = `${RIQ_BASE}/data/geocoded.json`;

const existing = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : {};

function clean(addr) {
  return addr
    .replace(/\s+,/g, ',')
    .replace(/,,/g, ',')
    .replace(/\s+/g, ' ')
    .replace(/\bSt\b/gi, 'St')
    .replace(/\bRd\b/gi, 'Rd')
    .replace(/\bAve\b/gi, 'Ave')
    .trim();
}

async function tryCensus(addr) {
  const url = `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=${encodeURIComponent(addr)}&benchmark=Public_AR_Current&format=json`;
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const b = await r.json();
    const m = b.result?.addressMatches || [];
    if (m.length) return { lat: m[0].coordinates.y, lng: m[0].coordinates.x };
  } catch {}
  return null;
}

async function tryNominatim(addr) {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(addr)}&format=json&limit=1`;
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'RoofDocs-Intel-RoundTwo/1.0' } });
    if (!r.ok) return null;
    const b = await r.json();
    if (Array.isArray(b) && b.length > 0) {
      return { lat: Number(b[0].lat), lng: Number(b[0].lon) };
    }
  } catch {}
  return null;
}

const records = fs.readFileSync(FAILED, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
console.log(`Retrying ${records.length} records…`);

let ok = 0, fail = 0;
const newFail = [];
for (const r of records) {
  const cleaned = clean(r.addr);
  let coords = await tryCensus(cleaned);
  if (!coords) {
    // Nominatim is rate-limited to 1/sec
    await new Promise((res) => setTimeout(res, 1100));
    coords = await tryNominatim(cleaned);
  }
  if (coords) {
    existing[r.jobID] = coords;
    ok++;
  } else {
    fail++;
    newFail.push(r);
  }
  if ((ok + fail) % 10 === 0) console.log(`  [${ok + fail}/${records.length}] ok=${ok} fail=${fail}`);
}
fs.writeFileSync(OUT, JSON.stringify(existing));
console.log(`\nDone. ${ok} OK, ${fail} still failed. Total geocoded: ${Object.keys(existing).length}`);
if (newFail.length > 0) {
  fs.writeFileSync(FAILED, newFail.map((r) => JSON.stringify(r)).join('\n') + '\n');
  console.log('Remaining failed addresses saved back to geocoded-failed.jsonl');
}
