#!/usr/bin/env node
// Geocode the ~3,851 missing-coord records via the US Census Geocoder.
// Free, unlimited, US-only. Saves to data/geocoded.json keyed by jobID.

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

const RIQ_BASE = process.env.RIQ_BASE || "/Users/a21/storm-maps";

const DETAIL_DIR = `${RIQ_BASE}/data/roofdocs-pull`;
const OUT = `${RIQ_BASE}/data/geocoded.json`;
const FAILED = `${RIQ_BASE}/data/geocoded-failed.jsonl`;
const CONCURRENCY = 12;

const existing = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : {};

const files = (await fsp.readdir(DETAIL_DIR)).filter((f) => f.endsWith('.json') && !f.startsWith('_'));
const todo = [];
for (const f of files) {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(DETAIL_DIR, f), 'utf8'));
    const d = raw.data;
    if (!d) continue;
    if (d.coordinates && d.coordinates.coordinates) continue;
    if (!d.addressLine1 || !d.city || !d.state) continue;
    if (existing[d.jobID]) continue;
    const addr = `${d.addressLine1}, ${d.city}, ${d.state} ${d.zipCode || ''}`.trim();
    todo.push({ jobID: d.jobID, addr });
  } catch {}
}
console.log(`To geocode: ${todo.length}`);

let done = 0, ok = 0, fail = 0;
const startedAt = Date.now();

async function fetchOne(item) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const url = `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=${encodeURIComponent(item.addr)}&benchmark=Public_AR_Current&format=json`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      const matches = body.result?.addressMatches || [];
      if (matches.length === 0) return { ok: false, reason: 'no_match' };
      const c = matches[0].coordinates;
      return { ok: true, lat: c.y, lng: c.x };
    } catch (e) {
      if (attempt === 3) return { ok: false, reason: String(e) };
      await new Promise((r) => setTimeout(r, 800 * attempt));
    }
  }
  return { ok: false, reason: 'exhausted' };
}

async function worker(q) {
  while (q.length > 0) {
    const item = q.shift();
    if (!item) break;
    const r = await fetchOne(item);
    done++;
    if (r.ok) {
      ok++;
      existing[item.jobID] = { lat: r.lat, lng: r.lng };
    } else {
      fail++;
      await fsp.appendFile(FAILED, JSON.stringify({ jobID: item.jobID, addr: item.addr, reason: r.reason }) + '\n');
    }
    if (done % 100 === 0 || done === todo.length) {
      const elapsed = (Date.now() - startedAt) / 1000;
      const rate = done / elapsed;
      console.log(`[${done}/${todo.length}] ok=${ok} fail=${fail} rate=${rate.toFixed(1)}/s eta=${((todo.length - done) / rate / 60).toFixed(1)}min`);
      // Persist every 100
      fs.writeFileSync(OUT, JSON.stringify(existing));
    }
  }
}

const q = [...todo];
await Promise.all(Array.from({ length: CONCURRENCY }, () => worker(q)));
fs.writeFileSync(OUT, JSON.stringify(existing));
const elapsed = (Date.now() - startedAt) / 1000;
console.log(`\nDone. ${ok} OK, ${fail} failed in ${(elapsed / 60).toFixed(1)} min.`);
console.log(`Total geocoded so far: ${Object.keys(existing).length}`);
