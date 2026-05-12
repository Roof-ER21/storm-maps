// Identify insurance-typed jobs missing a carrier so ops can backfill in the portal.
// Output: data/carrier-orphans.json — sortable JSON consumed by the orphan-list page.
//
// Why this matters: a carrier-less Insurance job pollutes nothing in patterns
// (we already filter), but it IS a customer who has insurance we don't know about.
// Resurrection campaigns, storm playbooks, and rep handoffs all degrade when
// the carrier is unknown — reps can't pre-call the right adjuster line.
//
// Action: backfill from portal "Insurance" section, OR mark job as Retail.

import fs from 'fs';

const RIQ_BASE = process.env.RIQ_BASE || "/Users/a21/Desktop/storm-maps";

const PROJECTS = `${RIQ_BASE}/data/projects.json`;
const OUT = `${RIQ_BASE}/data/carrier-orphans.json`;

const flat = JSON.parse(fs.readFileSync(PROJECTS, 'utf8'));

const INSURANCE_TYPES = new Set(['Insurance', 'Insurance Conversion', 'Public Adjuster']);
const orphans = flat.filter((j) => INSURANCE_TYPES.has(j.jobType) && !j.insurance);

// Score by recoverability + business value. The team should work the high-value ones first.
//   actionable score = stage urgency × dollars-at-stake
const STAGE_URGENCY = {
  'Inspection Pending': 10,
  'Pending Approval': 10,
  'Request Pending': 9,
  'Appointment Pending': 8,
  'Scheduled': 9,
  'Downpayment': 9,
  'Schedule Pending': 9,
  'Job Completed': 6, // we already missed it; backfill is nice-to-have
  'Post-Install Service': 5,
  'Balance Pending': 7,
  'Dead': 1, // probably let go
};

const scored = orphans.map((j) => ({
  jobId: j.id,
  customer: j.customer,
  customerEmail: j.customerEmail,
  customerCell: j.customerCell,
  address: [j.addressLine1, j.city, j.state, j.zip].filter(Boolean).join(', '),
  jobType: j.jobType,
  stage: j.stage,
  signedDate: j.signedDate,
  completedDate: j.completedDate,
  jobTotal: j.jobTotal || 0,
  salesRep: j.salesRep,
  adjusterName: j.adjusterName || null,
  claimNumber: j.claimNumber || null,
  // signals the team can use to backfill
  hasAdjuster: !!j.adjusterName,
  hasClaim: !!j.claimNumber,
  hasDocs: !!(j.adjusterName || j.claimNumber),
  // priority: stage urgency × ($-at-stake / $10k, capped at 5×)
  priority: (STAGE_URGENCY[j.stage] || 1) * Math.min(5, Math.max(1, (j.jobTotal || 0) / 10000)),
  portalUrl: `https://portal.theroofdocs.com/jobs/${j.id}`,
}));

scored.sort((a, b) => b.priority - a.priority);

const summary = {
  generated: new Date().toISOString(),
  totalOrphans: scored.length,
  byStage: scored.reduce((acc, j) => ({ ...acc, [j.stage || 'null']: (acc[j.stage || 'null'] || 0) + 1 }), {}),
  byRep: Object.entries(scored.reduce((acc, j) => ({ ...acc, [j.salesRep || 'unassigned']: (acc[j.salesRep || 'unassigned'] || 0) + 1 }), {}))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([rep, count]) => ({ rep, count })),
  // jobs with any backfill signal (adjuster or claim#) — easiest wins
  withDocs: scored.filter((j) => j.hasDocs).length,
  // the actually-actionable subset: not dead, signed/completed/in-progress
  actionable: scored.filter((j) => j.stage !== 'Dead'),
  // top 50 priority orphans for the team to attack first
  topPriority: scored.slice(0, 50),
  all: scored,
};

fs.writeFileSync(OUT, JSON.stringify(summary, null, 2));
console.log(`Wrote ${OUT}`);
console.log(`  Total orphans: ${summary.totalOrphans}`);
console.log(`  Actionable (not Dead): ${summary.actionable.length}`);
console.log(`  With documentation hints: ${summary.withDocs}`);
console.log(`  Top reps with orphans:`);
for (const r of summary.byRep.slice(0, 5)) console.log(`    ${r.rep.padEnd(28)} ${r.count}`);
console.log(`  By stage:`);
for (const [s, n] of Object.entries(summary.byStage).sort((a, b) => b[1] - a[1])) {
  console.log(`    ${s.padEnd(28)} ${n}`);
}
