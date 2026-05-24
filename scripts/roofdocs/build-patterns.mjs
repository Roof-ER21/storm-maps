#!/usr/bin/env node
// Mine statistical patterns across carrier × adjuster × zip × storm × rep × trade.
// Outputs patterns.json — consumed by field-guide.html + predictor.html.

import fs from 'node:fs';

const RIQ_BASE = process.env.RIQ_BASE || "/Users/a21/RIQ21";

const PROJECTS = `${RIQ_BASE}/data/projects.json`;
const OUT = `${RIQ_BASE}/data/patterns.json`;

const projects = JSON.parse(fs.readFileSync(PROJECTS, 'utf8'));
console.log(`Loaded ${projects.length} projects`);

const isCompleted = (r) => /completed|finalized/i.test(r.stage || '');
const isDead = (r) => /dead|cancel/i.test(r.stage || '');

function median(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}
function pct(n, d) { return d ? n / d : 0; }

// Defensive carrier-value check — should already be null/clean after flatten-v3's
// normCarrier(), but legacy or partial-refresh data can still slip placeholders through.
const PLACEHOLDER_CARRIER = /^(n\/?a|none|null|unknown|other|tbd|n\.?\s*a\.?|\?+)$/i;
const isRealCarrier = (v) => !!v && !PLACEHOLDER_CARRIER.test(String(v).trim());

// ===== 1. CARRIER PATTERNS =====
const carriers = {};
for (const j of projects) {
  if (!isRealCarrier(j.insurance)) continue;
  if (!carriers[j.insurance]) {
    carriers[j.insurance] = {
      name: j.insurance, jobs: 0, completed: 0, dead: 0, open: 0,
      completedRev: 0, deductibles: [], upliftValues: [],
      acvs: [], depreciations: [],
      daysLossToSign: [], daysToComplete: [],
      trades: {}, zips: {}, hailMags: [],
      stateBreakdown: { VA: 0, MD: 0, PA: 0, DC: 0, OTHER: 0 },
    };
  }
  const c = carriers[j.insurance];
  c.jobs++;
  if (isCompleted(j)) { c.completed++; c.completedRev += j.jobTotal || 0; }
  else if (isDead(j)) c.dead++;
  else c.open++;
  if (j.deductible && j.deductible <= 50000) c.deductibles.push(j.deductible);
  if (j.initialEstimate && j.revisedEstimate && j.initialEstimate > 0) {
    c.upliftValues.push((j.revisedEstimate - j.initialEstimate) / j.initialEstimate);
  }
  if (j.acv) c.acvs.push(j.acv);
  if (j.depreciation) c.depreciations.push(j.depreciation);
  if (j.daysLossToSign != null && j.daysLossToSign >= 0 && j.daysLossToSign < 365) c.daysLossToSign.push(j.daysLossToSign);
  if (j.daysToComplete != null && j.daysToComplete >= 0 && j.daysToComplete < 730) c.daysToComplete.push(j.daysToComplete);
  for (const t of (j.trades || [])) c.trades[t] = (c.trades[t] || 0) + 1;
  if (j.zip) {
    const z = j.zip.slice(0, 5);
    c.zips[z] = (c.zips[z] || 0) + 1;
  }
  if (j.stormMatch && j.stormMatch.stormType === 'HAIL' && j.stormMatch.stormMagnitude) {
    c.hailMags.push(j.stormMatch.stormMagnitude);
  }
  const st = j.state || 'OTHER';
  if (c.stateBreakdown[st] != null) c.stateBreakdown[st]++;
  else c.stateBreakdown.OTHER++;
}
const carrierProfiles = Object.values(carriers).map((c) => ({
  name: c.name, jobs: c.jobs, completed: c.completed, dead: c.dead, open: c.open,
  completedRev: c.completedRev,
  approvalRate: pct(c.completed, c.jobs - c.dead),  // exclude dead from denom = signed→completed
  closeRate: pct(c.completed, c.jobs - c.open),     // all-time close rate
  deathRate: pct(c.dead, c.jobs),
  medianDeductible: median(c.deductibles),
  medianAcv: median(c.acvs),
  medianDepreciation: median(c.depreciations),
  medianUplift: median(c.upliftValues),
  pctOver50Uplift: c.upliftValues.length ? c.upliftValues.filter((v) => v > 0.5).length / c.upliftValues.length : 0,
  medianDaysLossToSign: median(c.daysLossToSign),
  medianDaysToComplete: median(c.daysToComplete),
  avgApprovedJob: c.completed ? c.completedRev / c.completed : 0,
  medianHailMag: median(c.hailMags),
  topTrades: Object.entries(c.trades).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([t, n]) => ({ trade: t, jobs: n })),
  topZips: Object.entries(c.zips).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([z, n]) => ({ zip: z, jobs: n })),
  stateBreakdown: c.stateBreakdown,
})).sort((a, b) => b.jobs - a.jobs);

// ===== 2. ADJUSTER PATTERNS =====
const adjusters = {};
for (const j of projects) {
  if (!j.adjusterName) continue;
  const carrier = isRealCarrier(j.insurance) ? j.insurance : 'Unknown';
  const key = `${j.adjusterName}|${carrier}`;
  if (!adjusters[key]) adjusters[key] = {
    name: j.adjusterName, carrier,
    jobs: 0, completed: 0, dead: 0, completedRev: 0,
    upliftValues: [], deductibles: [], zips: {},
  };
  const a = adjusters[key];
  a.jobs++;
  if (isCompleted(j)) { a.completed++; a.completedRev += j.jobTotal || 0; }
  else if (isDead(j)) a.dead++;
  if (j.initialEstimate && j.revisedEstimate && j.initialEstimate > 0) {
    a.upliftValues.push((j.revisedEstimate - j.initialEstimate) / j.initialEstimate);
  }
  if (j.deductible && j.deductible <= 50000) a.deductibles.push(j.deductible);
  if (j.zip) a.zips[j.zip.slice(0, 5)] = (a.zips[j.zip.slice(0, 5)] || 0) + 1;
}
const adjusterProfiles = Object.values(adjusters).filter((a) => a.jobs >= 2).map((a) => ({
  name: a.name, carrier: a.carrier,
  jobs: a.jobs, completed: a.completed, dead: a.dead,
  approvalRate: pct(a.completed, a.jobs - a.dead),
  avgApprovedJob: a.completed ? a.completedRev / a.completed : 0,
  medianUplift: median(a.upliftValues),
  medianDeductible: median(a.deductibles),
  topZips: Object.entries(a.zips).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([z, n]) => ({ zip: z, jobs: n })),
})).sort((a, b) => b.completed - a.completed);

// ===== 3. ZIP PATTERNS =====
const zips = {};
for (const j of projects) {
  if (!j.zip) continue;
  const z = j.zip.slice(0, 5);
  if (!zips[z]) zips[z] = {
    zip: z, jobs: 0, completed: 0, dead: 0, revenue: 0,
    carriers: {}, cities: {}, deductibles: [], hailHits: 0,
  };
  const e = zips[z];
  e.jobs++;
  if (isCompleted(j)) { e.completed++; e.revenue += j.jobTotal || 0; }
  else if (isDead(j)) e.dead++;
  if (isRealCarrier(j.insurance)) {
    e.carriers[j.insurance] = e.carriers[j.insurance] || { signed: 0, completed: 0, dead: 0, revenue: 0 };
    e.carriers[j.insurance].signed++;
    if (isCompleted(j)) { e.carriers[j.insurance].completed++; e.carriers[j.insurance].revenue += j.jobTotal || 0; }
    else if (isDead(j)) e.carriers[j.insurance].dead++;
  }
  if (j.city) e.cities[j.city] = (e.cities[j.city] || 0) + 1;
  if (j.deductible && j.deductible <= 50000) e.deductibles.push(j.deductible);
  if (j.stormMatch && j.stormMatch.stormType === 'HAIL') e.hailHits++;
}
const zipProfiles = Object.values(zips).filter((z) => z.jobs >= 3).map((z) => ({
  zip: z.zip,
  city: Object.entries(z.cities).sort((a, b) => b[1] - a[1])[0]?.[0] || '',
  jobs: z.jobs, completed: z.completed, dead: z.dead, revenue: z.revenue,
  approvalRate: pct(z.completed, z.jobs - z.dead),
  avgApprovedJob: z.completed ? z.revenue / z.completed : 0,
  medianDeductible: median(z.deductibles),
  hailHits: z.hailHits,
  dominantCarrier: Object.entries(z.carriers).sort((a, b) => b[1].signed - a[1].signed)[0]?.[0] || null,
  carrierBreakdown: Object.entries(z.carriers).sort((a, b) => b[1].signed - a[1].signed).slice(0, 5).map(([c, s]) => ({
    carrier: c,
    signed: s.signed, completed: s.completed, dead: s.dead,
    approvalRate: pct(s.completed, s.signed - s.dead),
  })),
})).sort((a, b) => b.jobs - a.jobs);

// ===== 4. REP PATTERNS =====
const reps = {};
for (const j of projects) {
  if (!j.salesRep) continue;
  if (!reps[j.salesRep]) reps[j.salesRep] = {
    name: j.salesRep, jobs: 0, completed: 0, dead: 0, revenue: 0,
    carriers: {}, zips: {}, trades: {}, daysLossToSign: [],
  };
  const r = reps[j.salesRep];
  r.jobs++;
  if (isCompleted(j)) { r.completed++; r.revenue += j.jobTotal || 0; }
  else if (isDead(j)) r.dead++;
  if (isRealCarrier(j.insurance)) {
    r.carriers[j.insurance] = r.carriers[j.insurance] || { signed: 0, completed: 0 };
    r.carriers[j.insurance].signed++;
    if (isCompleted(j)) r.carriers[j.insurance].completed++;
  }
  if (j.zip) r.zips[j.zip.slice(0, 5)] = (r.zips[j.zip.slice(0, 5)] || 0) + 1;
  for (const t of (j.trades || [])) r.trades[t] = (r.trades[t] || 0) + 1;
  if (j.daysLossToSign != null && j.daysLossToSign >= 0 && j.daysLossToSign < 365) r.daysLossToSign.push(j.daysLossToSign);
}
const repProfiles = Object.values(reps).filter((r) => r.jobs >= 5).map((r) => ({
  name: r.name, jobs: r.jobs, completed: r.completed, dead: r.dead, revenue: r.revenue,
  approvalRate: pct(r.completed, r.jobs - r.dead),
  avgApprovedJob: r.completed ? r.revenue / r.completed : 0,
  medianDaysLossToSign: median(r.daysLossToSign),
  bestCarrier: Object.entries(r.carriers)
    .filter(([_, s]) => s.signed >= 5)
    .map(([c, s]) => ({ carrier: c, ...s, approvalRate: pct(s.completed, s.signed) }))
    .sort((a, b) => b.approvalRate - a.approvalRate)[0] || null,
  topZip: Object.entries(r.zips).sort((a, b) => b[1] - a[1])[0]?.[0] || null,
  topTrade: Object.entries(r.trades).sort((a, b) => b[1] - a[1])[0]?.[0] || null,
})).sort((a, b) => b.completed - a.completed);

// ===== 5. HAIL MAGNITUDE TIERS — approval rate by hail size =====
const hailTiers = { 'lt_0.75': 0, '0.75_1.0': 0, '1.0_1.25': 0, '1.25_1.5': 0, '1.5_2.0': 0, 'gte_2.0': 0 };
const hailTiersCompleted = JSON.parse(JSON.stringify(hailTiers));
const hailTiersDead = JSON.parse(JSON.stringify(hailTiers));
for (const j of projects) {
  if (!j.stormMatch || j.stormMatch.stormType !== 'HAIL') continue;
  const m = j.stormMatch.stormMagnitude;
  if (m == null) continue;
  let bucket;
  if (m < 0.75) bucket = 'lt_0.75';
  else if (m < 1.0) bucket = '0.75_1.0';
  else if (m < 1.25) bucket = '1.0_1.25';
  else if (m < 1.5) bucket = '1.25_1.5';
  else if (m < 2.0) bucket = '1.5_2.0';
  else bucket = 'gte_2.0';
  hailTiers[bucket]++;
  if (isCompleted(j)) hailTiersCompleted[bucket]++;
  if (isDead(j)) hailTiersDead[bucket]++;
}
const hailTierPatterns = Object.keys(hailTiers).map((b) => ({
  bucket: b,
  jobs: hailTiers[b], completed: hailTiersCompleted[b], dead: hailTiersDead[b],
  approvalRate: pct(hailTiersCompleted[b], hailTiers[b] - hailTiersDead[b]),
}));

// ===== 6. SPEED-TO-SIGN PATTERNS =====
const speedTiers = { '0-7d': [], '8-30d': [], '31-90d': [], '91-180d': [], '181-365d': [] };
for (const j of projects) {
  if (j.daysLossToSign == null || j.daysLossToSign < 0) continue;
  let bucket;
  if (j.daysLossToSign <= 7) bucket = '0-7d';
  else if (j.daysLossToSign <= 30) bucket = '8-30d';
  else if (j.daysLossToSign <= 90) bucket = '31-90d';
  else if (j.daysLossToSign <= 180) bucket = '91-180d';
  else if (j.daysLossToSign <= 365) bucket = '181-365d';
  else continue;
  speedTiers[bucket].push(j);
}
const speedPatterns = Object.entries(speedTiers).map(([b, jobs]) => ({
  bucket: b, jobs: jobs.length,
  completed: jobs.filter(isCompleted).length,
  dead: jobs.filter(isDead).length,
  approvalRate: pct(jobs.filter(isCompleted).length, jobs.length - jobs.filter(isDead).length),
  avgApprovedJob: jobs.filter(isCompleted).length ? jobs.filter(isCompleted).reduce((s, j) => s + (j.jobTotal || 0), 0) / jobs.filter(isCompleted).length : 0,
}));

// ===== 7. DAY-OF-WEEK PATTERNS =====
const dowJobs = { Sun: [], Mon: [], Tue: [], Wed: [], Thu: [], Fri: [], Sat: [] };
const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
for (const j of projects) {
  if (!j.signedDate) continue;
  const d = new Date(j.signedDate);
  if (!Number.isFinite(d.getTime())) continue;
  dowJobs[days[d.getUTCDay()]].push(j);
}
const dowPatterns = days.map((d) => ({
  day: d, jobs: dowJobs[d].length,
  completed: dowJobs[d].filter(isCompleted).length,
  approvalRate: pct(dowJobs[d].filter(isCompleted).length, dowJobs[d].length - dowJobs[d].filter(isDead).length),
}));

// ===== 8. MONTH-OF-YEAR PATTERNS =====
const monJobs = Array.from({ length: 12 }, () => []);
for (const j of projects) {
  if (!j.signedDate) continue;
  const d = new Date(j.signedDate);
  if (!Number.isFinite(d.getTime())) continue;
  monJobs[d.getUTCMonth()].push(j);
}
const monNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monPatterns = monJobs.map((jobs, i) => ({
  month: monNames[i], jobs: jobs.length,
  completed: jobs.filter(isCompleted).length,
  approvalRate: pct(jobs.filter(isCompleted).length, jobs.length - jobs.filter(isDead).length),
  avgApprovedJob: jobs.filter(isCompleted).length ? jobs.filter(isCompleted).reduce((s, j) => s + (j.jobTotal || 0), 0) / jobs.filter(isCompleted).length : 0,
}));

// ===== 9. CARRIER × STATE INTERACTIONS =====
const carrierState = {};
for (const j of projects) {
  if (!isRealCarrier(j.insurance) || !j.state) continue;
  const k = `${j.insurance}|${j.state}`;
  if (!carrierState[k]) carrierState[k] = { carrier: j.insurance, state: j.state, jobs: 0, completed: 0, dead: 0 };
  carrierState[k].jobs++;
  if (isCompleted(j)) carrierState[k].completed++;
  else if (isDead(j)) carrierState[k].dead++;
}
const carrierStatePatterns = Object.values(carrierState).filter((c) => c.jobs >= 5).map((c) => ({
  ...c, approvalRate: pct(c.completed, c.jobs - c.dead),
})).sort((a, b) => b.jobs - a.jobs);

// ===== 10. HIGH-CONFIDENCE COMBOS (most-tested patterns) =====
// For each carrier × zip combo with ≥10 jobs, compute approval rate
const carrierZip = {};
for (const j of projects) {
  if (!isRealCarrier(j.insurance) || !j.zip) continue;
  const k = `${j.insurance}|${j.zip.slice(0, 5)}`;
  if (!carrierZip[k]) carrierZip[k] = { carrier: j.insurance, zip: j.zip.slice(0, 5), jobs: 0, completed: 0, dead: 0, city: j.city };
  carrierZip[k].jobs++;
  if (isCompleted(j)) carrierZip[k].completed++;
  else if (isDead(j)) carrierZip[k].dead++;
}
const carrierZipPatterns = Object.values(carrierZip).filter((c) => c.jobs >= 10).map((c) => ({
  ...c, approvalRate: pct(c.completed, c.jobs - c.dead),
})).sort((a, b) => b.approvalRate - a.approvalRate);

// ===== OUTPUT =====
const out = {
  generated: new Date().toISOString(),
  totalProjects: projects.length,
  carriers: carrierProfiles,
  adjusters: adjusterProfiles,
  zips: zipProfiles,
  reps: repProfiles,
  hailTiers: hailTierPatterns,
  speedToSign: speedPatterns,
  dayOfWeek: dowPatterns,
  monthOfYear: monPatterns,
  carrierByState: carrierStatePatterns,
  carrierByZip: carrierZipPatterns,
};
fs.writeFileSync(OUT, JSON.stringify(out));
console.log(`\nWrote ${OUT} (${(fs.statSync(OUT).size / 1024).toFixed(1)} KB)`);
console.log(`\nKey findings:`);
console.log(`  Carriers tracked: ${carrierProfiles.length}`);
console.log(`  Adjusters with 2+ jobs: ${adjusterProfiles.length}`);
console.log(`  ZIPs with 3+ jobs: ${zipProfiles.length}`);
console.log(`  Reps with 5+ jobs: ${repProfiles.length}`);
console.log(`  Carrier×ZIP combos with 10+ jobs: ${carrierZipPatterns.length}`);
console.log('\nHail tier approval rates:');
for (const t of hailTierPatterns) console.log(`  ${t.bucket}: ${t.jobs} jobs, ${(t.approvalRate * 100).toFixed(1)}% approval`);
console.log('\nSpeed-to-sign approval rates:');
for (const t of speedPatterns) console.log(`  ${t.bucket}: ${t.jobs} jobs, ${(t.approvalRate * 100).toFixed(1)}% approval`);
