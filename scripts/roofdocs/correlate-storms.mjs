#!/usr/bin/env node
// For each job + each dead-insurance job, find nearby hail/wind events from IEM LSR.
// Outputs:
//   data/job-storms.json — every job → its storm-of-record at dateOfLoss (within ±30d, ≤5mi)
//   data/resurrection.json — dead insurance jobs (2024+) → new storms since dead date

import fs from 'node:fs';

const RIQ_BASE = process.env.RIQ_BASE || "/Users/a21/Desktop/storm-maps";

const PROJECTS_FILE = `${RIQ_BASE}/data/projects.json`;
const STORMS_FILE = `${RIQ_BASE}/data/storms/iem-hail-wind-2018-2026.json`;

const OUT_JOB_STORMS = `${RIQ_BASE}/data/job-storms.json`;
const OUT_RESURRECTION = `${RIQ_BASE}/data/resurrection.json`;

const MILES_PER_DEG_LAT = 69.0;
function milesPerDegLng(lat) { return 69.172 * Math.cos((lat * Math.PI) / 180); }
function haversine(lat1, lng1, lat2, lng2) {
  const R = 3958.7613; // miles
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const dφ = ((lat2 - lat1) * Math.PI) / 180;
  const dλ = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(dλ / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

console.log('Loading projects…');
const projects = JSON.parse(fs.readFileSync(PROJECTS_FILE, 'utf8'));
console.log(`  ${projects.length} projects`);

console.log('Loading storm LSRs…');
const stormFC = JSON.parse(fs.readFileSync(STORMS_FILE, 'utf8'));
const storms = stormFC.features.map((f) => {
  const p = f.properties || {};
  const g = f.geometry || {};
  const c = g.coordinates;
  if (!Array.isArray(c) || c.length < 2) return null;
  return {
    id: p.product_id,
    type: p.typetext,
    magnitude: p.magnitude != null ? Number(p.magnitude) : null,
    unit: p.unit,
    lat: c[1],
    lng: c[0],
    valid: p.valid,                          // ISO UTC
    state: p.state,
    county: p.county,
    city: p.city,
    source: p.source,
    remark: p.remark,
  };
}).filter((s) => s && Number.isFinite(s.lat) && Number.isFinite(s.lng));
console.log(`  ${storms.length} storm events`);

// Bucket storms by 1-deg lat × 1-deg lng grid for fast prefilter
const grid = new Map();
function gridKey(lat, lng) { return Math.floor(lat) + ',' + Math.floor(lng); }
for (const s of storms) {
  const k = gridKey(s.lat, s.lng);
  if (!grid.has(k)) grid.set(k, []);
  grid.get(k).push(s);
}

function nearbyStorms(lat, lng, maxMiles) {
  const out = [];
  const ilat = Math.floor(lat);
  const ilng = Math.floor(lng);
  for (let dlat = -1; dlat <= 1; dlat++) {
    for (let dlng = -1; dlng <= 1; dlng++) {
      const arr = grid.get((ilat + dlat) + ',' + (ilng + dlng));
      if (!arr) continue;
      for (const s of arr) {
        const dist = haversine(lat, lng, s.lat, s.lng);
        if (dist <= maxMiles) out.push({ ...s, distance: dist });
      }
    }
  }
  return out;
}

const isCompleted = (r) => /completed|finalized/i.test(r.stage || '');
const isDead = (r) => /dead|cancel/i.test(r.stage || '');

// ===== 1) Storm-of-record: storm closest in time to dateOfLoss, within 5mi, within ±30 days =====
console.log('\n=== Storm-of-record pass ===');
const jobStorms = [];
const MAX_MILES_LOSS = 5;
const MAX_DAYS_LOSS = 30;
let matched = 0;
for (const j of projects) {
  if (!j.dateOfLoss || j.lat == null || j.lng == null) continue;
  const lossTs = new Date(j.dateOfLoss).getTime();
  if (!Number.isFinite(lossTs)) continue;
  const candidates = nearbyStorms(j.lat, j.lng, MAX_MILES_LOSS);
  let best = null;
  let bestScore = Infinity;
  for (const s of candidates) {
    if (!s.valid) continue;
    const sd = new Date(s.valid).getTime();
    const days = Math.abs(sd - lossTs) / 86400000;
    if (days > MAX_DAYS_LOSS) continue;
    // Prefer hail > wind, closer in time, then closer in space
    const typeWeight = s.type === 'HAIL' ? 0.5 : 1.0;
    const score = days * typeWeight + s.distance * 2;
    if (score < bestScore) { bestScore = score; best = s; }
  }
  if (best) {
    matched++;
    jobStorms.push({
      jobId: j.id,
      stormId: best.id,
      stormDate: best.valid,
      stormType: best.type,
      stormMagnitude: best.magnitude,
      stormUnit: best.unit,
      stormDistanceMiles: Math.round(best.distance * 100) / 100,
      stormCity: best.city,
      stormCounty: best.county,
      stormState: best.state,
      daysFromLossToStorm: Math.round((new Date(best.valid).getTime() - lossTs) / 86400000),
    });
  }
}
console.log(`  ${matched} of ${projects.length} projects matched to a storm-of-record`);
fs.writeFileSync(OUT_JOB_STORMS, JSON.stringify(jobStorms));
console.log(`  wrote ${OUT_JOB_STORMS}`);

// ===== 2) Resurrection: dead insurance jobs since 2023, new storms AFTER dead date =====
console.log('\n=== Resurrection pass ===');
const MAX_MILES_NEW = 3;
const MIN_DEAD_YEAR = 2023;
const today = new Date();
const resurrection = [];
for (const j of projects) {
  if (!isDead(j)) continue;
  if (j.jobType !== 'Insurance' && j.jobType !== 'Insurance Conversion') continue;
  if (j.lat == null || j.lng == null) continue;
  // Use signed date as the "last alive" timestamp if no completedDate; if there's a finalized/cancelled date use that
  const lastTouch = j.finalizedDate || j.completedDate || j.signedDate;
  if (!lastTouch) continue;
  const lastTs = new Date(lastTouch).getTime();
  if (!Number.isFinite(lastTs)) continue;
  if (new Date(lastTouch).getFullYear() < MIN_DEAD_YEAR) continue;
  const candidates = nearbyStorms(j.lat, j.lng, MAX_MILES_NEW);
  const newStorms = [];
  for (const s of candidates) {
    if (s.type !== 'HAIL' && !s.type.includes('WND')) continue;
    if (!s.valid) continue;
    const sd = new Date(s.valid).getTime();
    if (sd <= lastTs) continue; // must be AFTER dead date
    if (sd > today.getTime()) continue;
    // Strong storms only — hail >= 1.0" or wind >= 60mph
    const mag = s.magnitude;
    if (s.type === 'HAIL' && (mag == null || mag < 1.0)) continue;
    if (s.type.includes('WND') && (mag == null || mag < 60)) continue;
    newStorms.push({
      stormId: s.id, stormDate: s.valid, stormType: s.type,
      stormMagnitude: mag, stormUnit: s.unit,
      stormDistanceMiles: Math.round(s.distance * 100) / 100,
      stormCity: s.city, stormCounty: s.county,
      daysSinceDead: Math.round((sd - lastTs) / 86400000),
    });
  }
  if (newStorms.length > 0) {
    // Sort storms by date desc (most recent first)
    newStorms.sort((a, b) => b.stormDate.localeCompare(a.stormDate));
    resurrection.push({
      jobId: j.id,
      customer: j.customer,
      address: [j.addressLine1, j.city, j.state, j.zip].filter(Boolean).join(', '),
      city: j.city, state: j.state, zip: j.zip,
      lat: j.lat, lng: j.lng,
      salesRep: j.salesRep,
      insurance: j.insurance,
      claimType: j.claimType,
      jobType: j.jobType,
      stage: j.stage,
      signedDate: j.signedDate,
      lastTouchDate: lastTouch,
      daysSinceDead: Math.floor((today.getTime() - lastTs) / 86400000),
      newStormCount: newStorms.length,
      strongestStorm: newStorms[0],
      allStorms: newStorms.slice(0, 5),  // cap to top 5 to keep file small
      // Trade context for upsell hooks
      trades: j.trades,
      adjusterName: j.adjusterName,
      deductible: j.deductible,
    });
  }
}
// Rank by strongest recent storm + recency
resurrection.sort((a, b) => {
  const am = a.strongestStorm.stormMagnitude || 0;
  const bm = b.strongestStorm.stormMagnitude || 0;
  if (bm !== am) return bm - am;
  return b.strongestStorm.stormDate.localeCompare(a.strongestStorm.stormDate);
});
console.log(`  ${resurrection.length} resurrection candidates (dead insurance jobs ${MIN_DEAD_YEAR}+ with new strong storms)`);
fs.writeFileSync(OUT_RESURRECTION, JSON.stringify(resurrection));
console.log(`  wrote ${OUT_RESURRECTION}`);

// Summary
const byCarrier = {};
for (const r of resurrection) {
  const c = r.insurance || 'Unknown';
  byCarrier[c] = (byCarrier[c] || 0) + 1;
}
console.log('\nTop carriers in resurrection list:');
Object.entries(byCarrier).sort((a, b) => b[1] - a[1]).slice(0, 8).forEach(([c, n]) => console.log(`  ${c}: ${n}`));
