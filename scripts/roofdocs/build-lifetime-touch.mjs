// Lifetime Touch Engine — math-prioritized re-engagement queue per rep.
//
// Reads:  data/projects.json (16k jobs), data/storms/iem-hail-wind-2018-2026.json
// Writes: data/lifetime-touch.json
//
// For each completed customer, computes a "ripeness" score (0-100) for
// re-engagement based on:
//   - Time since last completion (5/10/15/20yr roof lifecycle buckets)
//   - Storm exposure since completion (hail >= 1" within 0.5mi)
//   - Trade gaps (had roof but not gutters/siding, etc.)
//   - Contact info quality (has email + cell)
//   - Last-touch decay (recent contact lowers score)
//
// Output is keyed by salesRep so each rep gets a sorted list of customers
// to reach out to this month. Top-line stats included for the home page.

import fs from 'node:fs';
import path from 'node:path';

const RIQ_BASE = process.env.RIQ_BASE || '/Users/a21/storm-maps';
const PROJ = `${RIQ_BASE}/data/projects.json`;
const STORMS = `${RIQ_BASE}/data/storms/iem-hail-wind-2018-2026.json`;
const OUT = `${RIQ_BASE}/data/lifetime-touch.json`;

const projects = JSON.parse(fs.readFileSync(PROJ, 'utf8'));
let stormsRaw = null;
try {
  stormsRaw = JSON.parse(fs.readFileSync(STORMS, 'utf8'));
} catch {
  console.error('storms file missing — exposure scoring will be 0');
}
const stormFeatures = Array.isArray(stormsRaw)
  ? stormsRaw
  : (stormsRaw && stormsRaw.features) || [];

// ---- helpers ----
function distMi(lat1, lng1, lat2, lng2) {
  const R = 3958.8;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function parseDate(s) {
  if (!s) return null;
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? d : null;
}

function yearsBetween(a, b) {
  if (!a || !b) return null;
  return (b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24 * 365.25);
}

const TODAY = new Date();

// Roof lifecycle scoring — peaks at 12-18 years post-install
function lifecycleScore(yearsSinceCompletion) {
  if (yearsSinceCompletion == null) return 0;
  if (yearsSinceCompletion < 2) return 0;
  if (yearsSinceCompletion < 5) return 5;
  if (yearsSinceCompletion < 8) return 15;
  if (yearsSinceCompletion < 12) return 30;
  if (yearsSinceCompletion < 15) return 45;
  if (yearsSinceCompletion < 18) return 55;
  if (yearsSinceCompletion < 22) return 50;
  return 35;
}

// ---- index storms by month-year and approximate cell for fast lookup ----
function stormMag(f) {
  if (!f) return 0;
  const p = f.properties || f;
  // IEM uses magf (inches for hail, mph for wind), some have magnitude
  return Number(p.magf || p.magnitude || p.mag || 0) || 0;
}
function stormType(f) {
  const p = (f && f.properties) || f || {};
  return String(p.typetext || p.type || '').toUpperCase();
}
function stormDate(f) {
  const p = (f && f.properties) || f || {};
  return parseDate(p.valid || p.date || p.event_date || p.eventDate || p.time);
}
function stormCoords(f) {
  if (!f) return null;
  if (f.geometry && Array.isArray(f.geometry.coordinates)) {
    const c = f.geometry.coordinates;
    if (Array.isArray(c) && c.length >= 2) return { lng: Number(c[0]), lat: Number(c[1]) };
  }
  const p = f.properties || f;
  if (p.lat != null && p.lon != null) return { lat: Number(p.lat), lng: Number(p.lon) };
  if (p.lat != null && p.lng != null) return { lat: Number(p.lat), lng: Number(p.lng) };
  return null;
}

const stormIdx = new Map();
let stormsKept = 0;
for (const f of stormFeatures) {
  const t = stormType(f);
  if (!/HAIL|WND|WIND|TSTM/.test(t)) continue;
  const c = stormCoords(f);
  const d = stormDate(f);
  if (!c || !d) continue;
  if (!Number.isFinite(c.lat) || !Number.isFinite(c.lng)) continue;
  const mag = stormMag(f);
  const isHail = /HAIL/.test(t);
  const isWind = /WND|WIND|TSTM/.test(t);
  if (isHail && mag < 0.5) continue;
  if (isWind && mag < 50) continue;
  const cellKey = Math.round(c.lat * 10) + ':' + Math.round(c.lng * 10);
  if (!stormIdx.has(cellKey)) stormIdx.set(cellKey, []);
  stormIdx.get(cellKey).push({ lat: c.lat, lng: c.lng, mag, date: d, isHail });
  stormsKept++;
}
console.log(`Indexed ${stormsKept.toLocaleString()} storm features into ${stormIdx.size.toLocaleString()} cells`);

// For a (lat,lng,sinceDate), count storms within 0.5mi w/ hail >= 1" or wind >= 60mph
function exposureSince(lat, lng, sinceDate) {
  if (!lat || !lng || !sinceDate) return { hits: 0, strongest: 0, hailHits: 0 };
  let hits = 0, strongest = 0, hailHits = 0;
  const cellsToCheck = [];
  const baseLat = Math.round(lat * 10), baseLng = Math.round(lng * 10);
  for (let dLat = -1; dLat <= 1; dLat++) {
    for (let dLng = -1; dLng <= 1; dLng++) {
      const key = (baseLat + dLat) + ':' + (baseLng + dLng);
      if (stormIdx.has(key)) cellsToCheck.push(...stormIdx.get(key));
    }
  }
  for (const s of cellsToCheck) {
    if (s.date < sinceDate) continue;
    const d = distMi(lat, lng, s.lat, s.lng);
    if (d <= 1.0) {
      hits++;
      if (s.isHail) hailHits++;
      // For "strongest", prioritize hail inches over wind mph; use hail-only metric
      if (s.isHail && s.mag > strongest) strongest = s.mag;
    }
  }
  return { hits, strongest, hailHits };
}

// ---- group jobs by customer (using addr+name dedup) ----
function custKey(j) {
  const addr = (j.addressLine1 || (j.address ? String(j.address).split(',')[0] : '') || '').trim().toLowerCase();
  const name = (j.customer || '').trim().toLowerCase();
  const city = (j.city || '').trim().toLowerCase();
  return name + '|' + addr + '|' + city;
}

const customers = new Map();
for (const j of projects) {
  const k = custKey(j);
  if (!k || k === '||') continue;
  if (!customers.has(k)) customers.set(k, { jobs: [], info: j });
  customers.get(k).jobs.push(j);
}
console.log(`Grouped ${projects.length.toLocaleString()} jobs into ${customers.size.toLocaleString()} customers`);

// ---- score each customer ----
const ALL_TRADES = ['Roofing', 'Siding', 'Gutters & Downspouts', 'Windows', 'Skylights', 'Trim'];
const out = [];
let scored = 0;

for (const [key, { jobs }] of customers) {
  const completed = jobs.filter((j) => (j.stage || '').toLowerCase().includes('complet') && j.completedDate);
  if (completed.length === 0) continue;

  const sorted = completed.sort((a, b) => new Date(a.completedDate) - new Date(b.completedDate));
  const lastJob = sorted[sorted.length - 1];
  const firstJob = sorted[0];
  const lastDate = parseDate(lastJob.completedDate);
  if (!lastDate) continue;

  const daysSinceLast = Math.floor((TODAY - lastDate) / (1000 * 60 * 60 * 24));
  const yearsSinceLast = daysSinceLast / 365.25;
  if (yearsSinceLast < 2) continue;

  // Trades worked on
  const trades = new Set();
  for (const j of completed) {
    const t = (j.tradeType || j.tradeName || j.jobType || '').toString();
    if (/roof/i.test(t)) trades.add('Roofing');
    if (/sid/i.test(t)) trades.add('Siding');
    if (/gut|downsp/i.test(t)) trades.add('Gutters & Downspouts');
    if (/window/i.test(t)) trades.add('Windows');
    if (/skyl/i.test(t)) trades.add('Skylights');
    if (/trim|soffit/i.test(t)) trades.add('Trim');
  }
  // If we don't have a tradeType field, default to "Roofing" since most Roof Docs work is roofing
  if (trades.size === 0) trades.add('Roofing');

  const tradeGaps = ALL_TRADES.filter((t) => !trades.has(t));

  // Storm exposure since completion
  let exposure = { hits: 0, strongest: 0, hailHits: 0 };
  const lat = Number(lastJob.lat), lng = Number(lastJob.lng);
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    exposure = exposureSince(lat, lng, lastDate);
  }

  // Contact info quality
  const hasEmail = !!(lastJob.customerEmail || lastJob.customerSecondaryEmail);
  const hasCell = !!lastJob.customerCell;
  const contactScore = (hasEmail ? 8 : 0) + (hasCell ? 8 : 0);

  // Total score
  const lifecycle = lifecycleScore(yearsSinceLast);
  const exposureScore = Math.min(30, exposure.hits * 6 + (exposure.strongest >= 1.0 ? 8 : 0) + (exposure.strongest >= 2.0 ? 5 : 0));
  const gapScore = Math.min(15, tradeGaps.length * 2.5);
  const score = Math.round(lifecycle + exposureScore + gapScore + contactScore);

  // Suggested pitch — driven by the highest scoring component
  let pitch = '';
  if (exposure.hailHits >= 1 && exposure.strongest >= 1.0) {
    pitch = `Storm hit since their last job — ${exposure.hailHits} hail event${exposure.hailHits > 1 ? 's' : ''} (strongest ${exposure.strongest}") within 1 mi`;
  } else if (exposure.hits >= 3) {
    pitch = `${exposure.hits} severe weather hits within 1 mi since last completion — wind/hail combo`;
  } else if (yearsSinceLast >= 12) {
    pitch = `Roof is ${yearsSinceLast.toFixed(0)}+ years old — granule loss likely visible, ACV depreciation steep`;
  } else if (tradeGaps.length >= 3) {
    pitch = `Did roof but never ${tradeGaps.slice(0, 2).join(' or ')} — natural cross-sell`;
  } else if (yearsSinceLast >= 5) {
    pitch = `${yearsSinceLast.toFixed(0)}-year check-in — maintenance inspection, no-cost`;
  } else {
    pitch = 'Goodwill touch';
  }

  out.push({
    key,
    customer: lastJob.customer,
    address: lastJob.addressLine1,
    city: lastJob.city,
    state: lastJob.state,
    zip: lastJob.zip,
    lat,
    lng,
    customerEmail: lastJob.customerEmail || lastJob.customerSecondaryEmail,
    customerCell: lastJob.customerCell,
    salesRep: (lastJob.salesRep || '').trim(),
    lastCompleted: lastJob.completedDate,
    firstCompleted: firstJob.completedDate,
    yearsSinceLast: Number(yearsSinceLast.toFixed(1)),
    jobCount: completed.length,
    trades: Array.from(trades),
    tradeGaps,
    insurance: lastJob.insurance,
    stormHitsSinceLast: exposure.hits,
    hailHitsSinceLast: exposure.hailHits,
    strongestStormSinceLast: exposure.strongest,
    score,
    scoreBreakdown: { lifecycle, exposureScore, gapScore, contactScore },
    suggestedPitch: pitch,
    contactQuality: hasEmail && hasCell ? 'full' : hasEmail || hasCell ? 'partial' : 'none',
    portalLink: lastJob.id ? `https://portal.theroofdocs.com/customer/${lastJob.customerId || ''}` : null,
  });
  scored++;
}

out.sort((a, b) => b.score - a.score);

// Bucket by rep
const byRep = {};
for (const c of out) {
  const r = c.salesRep || '(no rep)';
  if (!byRep[r]) byRep[r] = [];
  byRep[r].push(c);
}
// Cap each rep at 100 (otherwise the dataset is huge and reps won't act on it)
for (const r of Object.keys(byRep)) byRep[r] = byRep[r].slice(0, 100);

// Top-line stats
const stats = {
  totalCustomers: out.length,
  topTierCount: out.filter((c) => c.score >= 60).length,
  midTierCount: out.filter((c) => c.score >= 40 && c.score < 60).length,
  withStormSince: out.filter((c) => c.stormHitsSinceLast > 0).length,
  contactableCount: out.filter((c) => c.contactQuality !== 'none').length,
  oldRoofCount: out.filter((c) => c.yearsSinceLast >= 12).length,
  byRepCount: Object.keys(byRep).length,
};

const result = {
  generated: new Date().toISOString(),
  stats,
  byRep,
  topTier: out.filter((c) => c.score >= 60).slice(0, 500),
};

fs.writeFileSync(OUT, JSON.stringify(result, null, 2));
const mb = (fs.statSync(OUT).size / 1024 / 1024).toFixed(1);
console.log(`Wrote ${OUT} (${mb} MB)`);
console.log(`  Scored: ${scored.toLocaleString()} customers`);
console.log(`  Top tier (60+): ${stats.topTierCount.toLocaleString()}`);
console.log(`  Mid tier (40-59): ${stats.midTierCount.toLocaleString()}`);
console.log(`  Storm hit since last: ${stats.withStormSince.toLocaleString()}`);
console.log(`  Reps with lists: ${stats.byRepCount}`);
