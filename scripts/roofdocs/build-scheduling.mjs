#!/usr/bin/env node
// Build scheduling intelligence from projects.json.
// Outputs data/scheduling.json — job-level scheduling data for the
// scheduling.html page. Pre-computed so the page loads fast.
//
//   RIQ_BASE=D:/RIQ21 node scripts/roofdocs/build-scheduling.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RIQ_BASE = process.env.RIQ_BASE || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PROJECTS = `${RIQ_BASE}/data/projects.json`;
const OUT = `${RIQ_BASE}/data/scheduling.json`;

const projects = JSON.parse(fs.readFileSync(PROJECTS, 'utf8'));
const now = new Date();
const in7  = new Date(now.getTime() + 7  * 86400000);
const in30 = new Date(now.getTime() + 30 * 86400000);

function daysSince(dateStr) {
  if (!dateStr) return null;
  return Math.floor((now - new Date(dateStr)) / 86400000);
}
function daysUntil(dateStr) {
  if (!dateStr) return null;
  return Math.floor((new Date(dateStr) - now) / 86400000);
}
function isActive(p) {
  return !/dead|completed|finalized|job completed/i.test(p.stage || '');
}
function slim(p) {
  return {
    id: p.id,
    customer: p.customer,
    address: [p.addressLine1, p.city, p.state].filter(Boolean).join(', '),
    carrier: p.insurance || null,
    stage: p.stage,
    salesRep: p.salesRep,
    projectCoordinator: p.projectCoordinator,
    trades: p.trades || [],
    signedDate: p.signedDate || null,
    expectedWorkStartDate: p.expectedWorkStartDate || null,
    readyForInstall: !!p.readyForInstall,
    claimNumber: p.claimNumber || null,
    adjusterName: p.adjusterName || null,
    daysSinceSigned: daysSince(p.signedDate),
  };
}

const thisWeek = projects
  .filter(p => p.expectedWorkStartDate && isActive(p))
  .filter(p => { const d = new Date(p.expectedWorkStartDate); return d >= now && d < in7; })
  .sort((a, b) => new Date(a.expectedWorkStartDate) - new Date(b.expectedWorkStartDate))
  .map(p => ({ ...slim(p), daysUntilStart: daysUntil(p.expectedWorkStartDate) }));

const next30 = projects
  .filter(p => p.expectedWorkStartDate && isActive(p))
  .filter(p => { const d = new Date(p.expectedWorkStartDate); return d >= in7 && d < in30; })
  .sort((a, b) => new Date(a.expectedWorkStartDate) - new Date(b.expectedWorkStartDate))
  .map(p => ({ ...slim(p), daysUntilStart: daysUntil(p.expectedWorkStartDate) }));

const overdue = projects
  .filter(p => p.expectedWorkStartDate && isActive(p))
  .filter(p => new Date(p.expectedWorkStartDate) < now)
  .sort((a, b) => new Date(a.expectedWorkStartDate) - new Date(b.expectedWorkStartDate))
  .map(p => ({ ...slim(p), daysOverdue: Math.abs(daysUntil(p.expectedWorkStartDate)) }));

const unscheduledReady = projects
  .filter(p => p.readyForInstall && !p.expectedWorkStartDate && isActive(p))
  .sort((a, b) => (daysSince(b.signedDate) || 0) - (daysSince(a.signedDate) || 0))
  .map(slim);

const activeSigned = projects.filter(p => p.signedDate && isActive(p));
const ageBuckets = {
  '0-30d':   activeSigned.filter(p => (daysSince(p.signedDate)||0) <  30).length,
  '31-60d':  activeSigned.filter(p => { const d=daysSince(p.signedDate)||0; return d>=30  && d<60;  }).length,
  '61-90d':  activeSigned.filter(p => { const d=daysSince(p.signedDate)||0; return d>=60  && d<90;  }).length,
  '91-180d': activeSigned.filter(p => { const d=daysSince(p.signedDate)||0; return d>=90  && d<180; }).length,
  '181-365d':activeSigned.filter(p => { const d=daysSince(p.signedDate)||0; return d>=180 && d<365; }).length,
  '365d+':   activeSigned.filter(p => (daysSince(p.signedDate)||0) >= 365).length,
};

const P90_BENCHMARK = 246;
const stale = activeSigned
  .filter(p => (daysSince(p.signedDate)||0) > P90_BENCHMARK)
  .sort((a, b) => (daysSince(b.signedDate)||0) - (daysSince(a.signedDate)||0))
  .slice(0, 100)
  .map(p => ({ ...slim(p), ageNote: daysSince(p.signedDate) + 'd since signed' }));

const repMap = {};
const addRep = (rep, bucket) => {
  if (!rep) return;
  if (!repMap[rep]) repMap[rep] = { rep, thisWeek:0, next30:0, overdue:0, unscheduledReady:0, total:0 };
  repMap[rep][bucket]++;
  repMap[rep].total++;
};
thisWeek.forEach(p => addRep(p.salesRep, 'thisWeek'));
next30.forEach(p => addRep(p.salesRep, 'next30'));
overdue.forEach(p => addRep(p.salesRep, 'overdue'));
unscheduledReady.forEach(p => addRep(p.salesRep, 'unscheduledReady'));
const byRep = Object.values(repMap).sort((a,b) => b.overdue-a.overdue || b.total-a.total).slice(0,30);

const overdueStages = {};
overdue.forEach(p => { overdueStages[p.stage||'?'] = (overdueStages[p.stage||'?']||0)+1; });

const completedWithDates = projects
  .filter(p => p.completedDate && p.signedDate)
  .map(p => Math.floor((new Date(p.completedDate) - new Date(p.signedDate)) / 86400000))
  .filter(d => d >= 0 && d < 2000)
  .sort((a, b) => a - b);
const pct = (arr, p) => arr[Math.floor(arr.length * p)];
const benchmarks = {
  p25: pct(completedWithDates, 0.25),
  p50: pct(completedWithDates, 0.50),
  p75: pct(completedWithDates, 0.75),
  p90: pct(completedWithDates, 0.90),
  sampleSize: completedWithDates.length,
};

const out = {
  generated: now.toISOString(),
  summary: {
    thisWeekCount:         thisWeek.length,
    next30Count:           next30.length,
    overdueCount:          overdue.length,
    unscheduledReadyCount: unscheduledReady.length,
    activeSignedCount:     activeSigned.length,
    staleCount:            stale.length,
  },
  benchmarks,
  ageBuckets,
  overdueStages,
  thisWeek,
  next30,
  overdue: overdue.slice(0, 200),
  unscheduledReady: unscheduledReady.slice(0, 200),
  stale,
  byRep,
};

fs.writeFileSync(OUT, JSON.stringify(out));
const kb = Math.round(fs.statSync(OUT).size / 1024);
console.log(`Wrote ${OUT} — ${kb} KB`);
console.log(`  thisWeek:${thisWeek.length}  next30:${next30.length}  overdue:${overdue.length}  unscheduledReady:${unscheduledReady.length}  stale:${stale.length}`);
console.log(`  P25=${benchmarks.p25}d  P50=${benchmarks.p50}d  P90=${benchmarks.p90}d`);
