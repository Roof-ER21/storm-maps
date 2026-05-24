#!/usr/bin/env node
// Derive active-work intel from raw dashboard-jobs-active.json.
// Surfaces: supplement tracker by carrier × status, cross-sell pipeline,
// install readiness, active-PA tags. Small rollup so /api/intel/active-work
// stays snappy even though the source is 5.8 MB.

import fs from 'node:fs';

const RIQ_BASE = process.env.RIQ_BASE || '/Users/a21/RIQ21';
const IN = `${RIQ_BASE}/data/roofdocs-reference/dashboard-jobs-active.json`;
const OUT = `${RIQ_BASE}/data/active-work.json`;

const raw = JSON.parse(fs.readFileSync(IN, 'utf8'));
const jobs = raw.data || [];

const today = new Date();

// --- Supplement tracker rollup ---
const suppByStatus = {};
const suppByCarrier = {};
for (const j of jobs) {
  const status = j.supplementTrackerStatus;
  if (!status) continue;
  suppByStatus[status] = (suppByStatus[status] || 0) + 1;
  const c = j.insuranceCompany || '(unknown)';
  if (!suppByCarrier[c]) suppByCarrier[c] = { total: 0, byStatus: {}, totalValue: 0 };
  suppByCarrier[c].total += 1;
  suppByCarrier[c].byStatus[status] = (suppByCarrier[c].byStatus[status] || 0) + 1;
  suppByCarrier[c].totalValue += j.jobTotal || 0;
}
const supplementByCarrier = Object.entries(suppByCarrier)
  .map(([carrier, v]) => ({ carrier, total: v.total, totalValue: Math.round(v.totalValue), byStatus: v.byStatus }))
  .sort((a, b) => b.total - a.total);

// --- Cross-sell pipeline ---
const XSELL_TYPES = [
  { key: 'drywallPaintingBid', label: 'Drywall/Painting', pr: 'drywallPaintingBidPR' },
  { key: 'metalRoofingBid',    label: 'Metal Roofing',    pr: 'metalRoofingBidPR' },
  { key: 'solarBid',           label: 'Solar',            pr: 'solarBidPR' },
  { key: 'otherBid',           label: 'Other',            pr: 'otherBidPR' },
];
const xsellSummary = XSELL_TYPES.map((t) => {
  const open = jobs.filter((j) => j[t.key]).length;
  const pr = jobs.filter((j) => j[t.pr]).length;
  const value = jobs.filter((j) => j[t.key]).reduce((s, j) => s + (j.jobTotal || 0), 0);
  return { type: t.label, openBids: open, postRecheck: pr, baseJobValue: Math.round(value) };
});
const xsellJobs = jobs.filter((j) =>
  j.drywallPaintingBid || j.metalRoofingBid || j.solarBid || j.otherBid
);
const xsellByCarrier = {};
for (const j of xsellJobs) {
  const c = j.insuranceCompany || '(unknown)';
  if (!xsellByCarrier[c]) xsellByCarrier[c] = { count: 0, value: 0, bids: [] };
  xsellByCarrier[c].count += 1;
  xsellByCarrier[c].value += j.jobTotal || 0;
  for (const t of XSELL_TYPES) if (j[t.key]) xsellByCarrier[c].bids.push(t.label);
}
const crossSellByCarrier = Object.entries(xsellByCarrier)
  .map(([carrier, v]) => {
    const bidCounts = {};
    for (const b of v.bids) bidCounts[b] = (bidCounts[b] || 0) + 1;
    return { carrier, count: v.count, baseJobValue: Math.round(v.value), bidCounts };
  })
  .sort((a, b) => b.count - a.count);

// --- Install readiness ---
const ready = jobs.filter((j) => j.readyForInstallJob);
const withDate = jobs.filter((j) => j.expectedWorkStartDate);
let overdue = 0;
let thisWeek = 0;
let next30 = 0;
for (const j of withDate) {
  const d = new Date(j.expectedWorkStartDate);
  if (Number.isNaN(d.getTime())) continue;
  const days = Math.floor((d - today) / 86400000);
  if (days < 0) overdue += 1;
  else if (days <= 7) thisWeek += 1;
  else if (days <= 30) next30 += 1;
}
const installReadiness = {
  readyForInstallCount: ready.length,
  scheduledCount: withDate.length,
  overdue,
  startingThisWeek: thisWeek,
  startingNext30Days: next30,
};

// --- Active PA flags on active jobs ---
const activePA = jobs.filter((j) => j.publicAdjustmentID && !j.publicAdjustmentRemoved);
const paOnActiveJobs = {
  count: activePA.length,
  byStatus: activePA.reduce((acc, j) => {
    const s = j.publicAdjustmentStatus || '(unknown)';
    acc[s] = (acc[s] || 0) + 1;
    return acc;
  }, {}),
};

// --- Cross-totals ---
const totals = {
  activeJobs: jobs.length,
  withOpenSupplement: jobs.filter((j) => j.supplementTrackerStatus).length,
  withCrossSellBid: xsellJobs.length,
  crossSellBaseValue: Math.round(xsellJobs.reduce((s, j) => s + (j.jobTotal || 0), 0)),
};

const out = {
  generated: new Date().toISOString(),
  totals,
  supplement: {
    byStatus: suppByStatus,
    byCarrier: supplementByCarrier,
  },
  crossSell: {
    summary: xsellSummary,
    byCarrier: crossSellByCarrier,
  },
  install: installReadiness,
  publicAdjustment: paOnActiveJobs,
};

fs.writeFileSync(OUT, JSON.stringify(out));
console.log(`Wrote ${OUT} — derived from ${jobs.length} active jobs`);
console.log(`  Active supplements: ${totals.withOpenSupplement} (across ${supplementByCarrier.length} carriers)`);
console.log(`  Cross-sell pipeline: ${totals.withCrossSellBid} jobs, $${totals.crossSellBaseValue.toLocaleString()} base value`);
console.log(`  Install: ${installReadiness.readyForInstallCount} ready, ${installReadiness.scheduledCount} scheduled, ${installReadiness.overdue} overdue`);
console.log(`  Active PAs on jobs: ${paOnActiveJobs.count}`);
