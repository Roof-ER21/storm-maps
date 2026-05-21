#!/usr/bin/env node
// For every customer (deduped by name+address), find every storm event that hit them.
// Strong storms (hail ≥0.75" or wind ≥55mph) within 2 miles of their lat/lng
// since their first contact with Roof Docs.
//
// Outputs storm-exposure.json — one record per customer with their storm history
// and which trades they've ALREADY done vs which are still gap (upsell signal).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const RIQ_BASE = process.env.RIQ_BASE || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const PROJECTS = `${RIQ_BASE}/data/projects.json`;
const STORMS = `${RIQ_BASE}/data/storms/iem-hail-wind-2018-2026.json`;
const OUT = `${RIQ_BASE}/data/storm-exposure.json`;
const OUT_PLAYBOOK = `${RIQ_BASE}/data/storm-playbook.json`;

const ROOF_TRADES = new Set(['Roofing', 'Metal Roofing', 'Flat Roofing', 'Cedar Shake Roofing', 'Slate Roofing']);
const ALL_UPSELL_TRADES = ['Siding', 'Gutters & Downspouts', 'Skylights', 'Trim', 'Windows', 'Soffit & Ventilation'];

const MAX_MILES = 2;
const MIN_HAIL = 0.75;
const MIN_WIND = 55;

function haversine(lat1, lng1, lat2, lng2) {
  const R = 3958.7613;
  const φ1 = (lat1 * Math.PI) / 180; const φ2 = (lat2 * Math.PI) / 180;
  const dφ = ((lat2 - lat1) * Math.PI) / 180; const dλ = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(dλ / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

console.log('Loading projects…');
const projects = JSON.parse(fs.readFileSync(PROJECTS, 'utf8'));
console.log(`  ${projects.length} projects`);

console.log('Loading storms…');
const stormFC = JSON.parse(fs.readFileSync(STORMS, 'utf8'));
const storms = stormFC.features.map((f) => {
  const p = f.properties || {};
  const c = (f.geometry || {}).coordinates;
  if (!Array.isArray(c)) return null;
  const mag = p.magnitude != null ? Number(p.magnitude) : null;
  // Filter: strong only
  if (p.typetext === 'HAIL' && (mag == null || mag < MIN_HAIL)) return null;
  if ((p.typetext || '').includes('WND') && (mag == null || mag < MIN_WIND)) return null;
  if (p.typetext !== 'HAIL' && !(p.typetext || '').includes('WND') && p.typetext !== 'TORNADO') return null;
  return { id: p.product_id, type: p.typetext, mag, unit: p.unit, valid: p.valid,
           lat: c[1], lng: c[0], city: p.city, county: p.county, state: p.state };
}).filter((s) => s && Number.isFinite(s.lat) && Number.isFinite(s.lng));
console.log(`  ${storms.length} strong storm events (hail ≥${MIN_HAIL}", wind ≥${MIN_WIND}mph)`);

// Grid index for storms
const grid = new Map();
for (const s of storms) {
  const k = Math.floor(s.lat) + ',' + Math.floor(s.lng);
  if (!grid.has(k)) grid.set(k, []);
  grid.get(k).push(s);
}
function nearbyStorms(lat, lng) {
  const out = [];
  const ilat = Math.floor(lat); const ilng = Math.floor(lng);
  for (let dlat = -1; dlat <= 1; dlat++) {
    for (let dlng = -1; dlng <= 1; dlng++) {
      const arr = grid.get((ilat + dlat) + ',' + (ilng + dlng));
      if (!arr) continue;
      for (const s of arr) {
        const dist = haversine(lat, lng, s.lat, s.lng);
        if (dist <= MAX_MILES) out.push({ ...s, distance: dist });
      }
    }
  }
  return out;
}

// Group projects by customer key
function custKey(r) {
  return ((r.customer || '').trim().toLowerCase() + '|' +
          (r.addressLine1 || '').trim().toLowerCase() + '|' +
          (r.city || '').trim().toLowerCase());
}
const byCust = new Map();
for (const p of projects) {
  const k = custKey(p);
  if (!k.replace(/\|/g, '').trim()) continue;
  if (!byCust.has(k)) byCust.set(k, []);
  byCust.get(k).push(p);
}
console.log(`  ${byCust.size} unique customers`);

const today = new Date();
const out = [];
let customersHit = 0;
let totalHits = 0;

for (const [k, jobs] of byCust) {
  const j0 = jobs[0];
  if (j0.lat == null || j0.lng == null) continue;
  const firstContact = jobs.map((j) => j.createdAt || j.signedDate).filter(Boolean).sort()[0];
  if (!firstContact) continue;
  const firstTs = new Date(firstContact).getTime();
  if (!Number.isFinite(firstTs)) continue;

  // Storms hitting since first contact
  const stormsHit = nearbyStorms(j0.lat, j0.lng)
    .filter((s) => s.valid)
    .map((s) => ({ ...s, ts: new Date(s.valid).getTime() }))
    .filter((s) => s.ts >= firstTs && s.ts <= today.getTime())
    .sort((a, b) => b.ts - a.ts);
  if (stormsHit.length === 0) continue;

  // What trades have they done?
  const tradesDone = new Set();
  for (const j of jobs) for (const t of (j.trades || [])) tradesDone.add(t);
  const hasRoof = [...tradesDone].some((t) => ROOF_TRADES.has(t));
  const tradeGaps = ALL_UPSELL_TRADES.filter((t) => !tradesDone.has(t));

  // Most recent strong storm
  const top = stormsHit[0];
  const totalRev = jobs.reduce((s, j) => s + (j.jobTotal || 0), 0);
  const completedJob = jobs.find((j) => /completed|finalized/i.test(j.stage || ''));
  const lastDate = jobs.map((j) => j.completedDate || j.signedDate).filter(Boolean).sort().reverse()[0];
  const allCarriers = [...new Set(jobs.map((j) => j.insurance).filter(Boolean))];
  const allReps = [...new Set(jobs.map((j) => j.salesRep).filter(Boolean))];

  // Claim outcome summary — gives campaign reps context on what this customer actually experienced.
  const insJobs = jobs.filter((j) => j.insurance && j.jobType === 'Insurance');
  const claimHistory = insJobs.map((j) => {
    const isDead = /dead/i.test(j.stage || '');
    const isComplete = /completed|finalized|wrap.up/i.test(j.stage || '');
    const paidOut = j.insuranceTotal || 0;
    const estimated = j.revisedEstimate || j.initialEstimate || 0;
    const gap = estimated > 0 ? Math.round(((estimated - paidOut) / estimated) * 100) : null;
    const supStatus = j.supplementTrackerStatus || null;
    const hasSup = j.hasSupplement === true || /supplement/i.test(supStatus || '');
    let outcome = 'unknown';
    if (isDead && paidOut === 0) outcome = 'denied';
    else if (isDead && paidOut > 0) outcome = 'partial-dead';
    else if (isComplete && gap !== null && gap > 15) outcome = 'partial-paid';
    else if (isComplete) outcome = 'full-paid';
    else if (!isDead) outcome = 'in-progress';
    return {
      carrier: j.insurance,
      stage: j.stage,
      outcome,
      paidOut,
      estimated,
      gapPct: gap,
      hasSupplement: hasSup,
      supplementStatus: supStatus,
      acv: j.acv || 0,
      depreciation: j.depreciation || 0,
      claimNumber: j.claimNumber || null,
      adjuster: j.adjusterName || null,
      dateOfLoss: j.dateOfLoss || null,
    };
  });
  const hasDenied = claimHistory.some((c) => c.outcome === 'denied');
  const hasPartial = claimHistory.some((c) => c.outcome === 'partial-paid' || c.outcome === 'partial-dead');
  const bestPayout = Math.max(0, ...claimHistory.map((c) => c.paidOut));
  const activeSupplements = claimHistory.filter((c) => /in.progress|pending/i.test(c.supplementStatus || '')).length;

  customersHit++;
  totalHits += stormsHit.length;
  out.push({
    customer: j0.customer,
    addressLine1: j0.addressLine1, city: j0.city, state: j0.state, zip: j0.zip,
    lat: j0.lat, lng: j0.lng,
    customerEmail: j0.customerEmail,
    customerCell: j0.customerCell,
    firstContact,
    lastDate,
    daysSinceLast: lastDate ? Math.floor((today - new Date(lastDate)) / 86400000) : null,
    jobCount: jobs.length,
    completedJobCount: jobs.filter((j) => /completed|finalized/i.test(j.stage || '')).length,
    totalRev,
    trades: [...tradesDone].sort(),
    hasRoof,
    tradeGaps,
    carriers: allCarriers,
    reps: allReps,
    claimHistory,
    hasDenied,
    hasPartial,
    bestPayout,
    activeSupplements,
    stormCount: stormsHit.length,
    strongestStorm: stormsHit.reduce((best, s) => {
      const sc = (s.type === 'HAIL' ? 10 : 1) * (s.mag || 0);
      const bc = (best.type === 'HAIL' ? 10 : 1) * (best.mag || 0);
      return sc > bc ? s : best;
    }, stormsHit[0]),
    mostRecentStorm: stormsHit[0],
    allStorms: stormsHit.slice(0, 10).map((s) => ({
      id: s.id, type: s.type, mag: s.mag, unit: s.unit,
      date: s.valid, distance: Math.round(s.distance * 100) / 100,
      city: s.city, state: s.state,
    })),
  });
}

// Sort by strongest recent + most recent
out.sort((a, b) => {
  const am = (a.strongestStorm.type === 'HAIL' ? 10 : 1) * (a.strongestStorm.mag || 0);
  const bm = (b.strongestStorm.type === 'HAIL' ? 10 : 1) * (b.strongestStorm.mag || 0);
  if (bm !== am) return bm - am;
  return new Date(b.mostRecentStorm.valid).getTime() - new Date(a.mostRecentStorm.valid).getTime();
});

fs.writeFileSync(OUT, JSON.stringify(out));
console.log(`\nWrote ${OUT}`);
console.log(`  ${customersHit} customers hit by ≥1 strong storm since first contact`);
console.log(`  ${totalHits} total storm hits across all customers`);
console.log(`  ${(totalHits / customersHit).toFixed(1)} hits per affected customer (avg)`);

// =====  STORM PLAYBOOK: For each RECENT strong storm, list all customers ≤2mi who haven't done specific trades
//        Used for "this week's outreach list"
console.log('\nBuilding storm playbook (recent strong storms × trade gaps)…');
const DAYS_RECENT = 730;  // 2 years = the insurance claim filing window
const recentTs = today.getTime() - DAYS_RECENT * 86400000;
const recentStorms = storms.filter((s) => {
  if (!s.valid) return false;
  const ts = new Date(s.valid).getTime();
  return ts >= recentTs && ts <= today.getTime();
});
console.log(`  ${recentStorms.length} recent strong storms (last ${DAYS_RECENT}d)`);

const playbook = [];
for (const s of recentStorms) {
  // Find affected customers
  const cusKeys = new Set();
  for (const c of out) {
    const dist = haversine(s.lat, s.lng, c.lat, c.lng);
    if (dist <= MAX_MILES) {
      cusKeys.add(c.customer + '|' + c.addressLine1);
    }
  }
  if (cusKeys.size < 3) continue; // skip storms with low impact

  const customers = out.filter((c) => cusKeys.has(c.customer + '|' + c.addressLine1));
  // Bucket by trade gap
  const buckets = {};
  for (const c of customers) {
    for (const gap of c.tradeGaps) {
      if (!buckets[gap]) buckets[gap] = [];
      buckets[gap].push({ customer: c.customer, address: c.addressLine1, city: c.city, state: c.state, zip: c.zip, email: c.customerEmail, phone: c.customerCell, lat: c.lat, lng: c.lng, carrier: c.carriers[0], rep: c.reps[0], trades: c.trades });
    }
  }
  playbook.push({
    stormId: s.id, stormDate: s.valid, stormType: s.type, stormMagnitude: s.mag, stormUnit: s.unit,
    stormCity: s.city, stormCounty: s.county, stormState: s.state, stormLat: s.lat, stormLng: s.lng,
    affectedCustomers: customers.length,
    tradeGapBuckets: Object.fromEntries(Object.entries(buckets).map(([t, list]) => [t, list.slice(0, 50)])),
  });
}
playbook.sort((a, b) => b.affectedCustomers - a.affectedCustomers);
fs.writeFileSync(OUT_PLAYBOOK, JSON.stringify(playbook));
console.log(`Wrote ${OUT_PLAYBOOK}`);
console.log(`  ${playbook.length} recent storms with ≥3 affected customers`);
if (playbook.length) {
  console.log(`  Top storm: ${playbook[0].stormDate.slice(0, 10)} ${playbook[0].stormType} ${playbook[0].stormMagnitude} ${playbook[0].stormUnit} — ${playbook[0].affectedCustomers} customers affected`);
}
