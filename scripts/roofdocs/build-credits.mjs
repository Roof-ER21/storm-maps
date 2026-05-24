#!/usr/bin/env node
// Strip PII (bcrypt password hashes) from raw credits.json.
// Output: data/credits.json — vendor credit records ready to collect.

import fs from 'node:fs';

const RIQ_BASE = process.env.RIQ_BASE || '/Users/a21/RIQ21';
const IN = `${RIQ_BASE}/data/roofdocs-reference/credits.json`;
const OUT = `${RIQ_BASE}/data/credits.json`;

const raw = JSON.parse(fs.readFileSync(IN, 'utf8'));
const data = raw.data || [];

const out = data.map((c) => ({
  creditTrackerID: c.creditTrackerID,
  creditor: c.creditor,
  amount: c.amount,
  status: c.status,
  createdAt: c.createdAt,
  memo: c.memo,
  jobId: c.jobId,
  job: c.job ? {
    jobID: c.job.jobID,
    customer: c.job.customer ? {
      firstName: c.job.customer.firstName,
      lastName: c.job.customer.lastName,
    } : null,
  } : null,
}));

// Aggregate
const byCreditor = {};
const byStatus = {};
let totalAmount = 0;
let collected = 0;
let unrequested = 0;
for (const c of out) {
  const cr = c.creditor || '(unknown)';
  if (!byCreditor[cr]) byCreditor[cr] = { count: 0, amount: 0 };
  byCreditor[cr].count += 1;
  byCreditor[cr].amount += c.amount || 0;
  byStatus[c.status || '(unknown)'] = (byStatus[c.status || '(unknown)'] || 0) + 1;
  totalAmount += c.amount || 0;
  if (c.status === 'Collected') collected += c.amount || 0;
  if (c.status === 'Unrequested') unrequested += c.amount || 0;
}

const summary = {
  totalCount: out.length,
  totalAmount: Math.round(totalAmount * 100) / 100,
  collectedAmount: Math.round(collected * 100) / 100,
  unrequestedAmount: Math.round(unrequested * 100) / 100,
  byStatus,
  byCreditor: Object.entries(byCreditor)
    .map(([creditor, v]) => ({ creditor, count: v.count, amount: Math.round(v.amount * 100) / 100 }))
    .sort((a, b) => b.amount - a.amount),
};

fs.writeFileSync(OUT, JSON.stringify({ summary, credits: out }));
console.log(`Wrote ${OUT} — ${out.length} vendor credits`);
console.log(`  total: $${summary.totalAmount.toLocaleString()} (${summary.unrequestedAmount.toLocaleString()} unrequested)`);
console.log('  top creditors:');
for (const c of summary.byCreditor.slice(0, 5)) console.log(`    ${c.creditor}: ${c.count} credits / $${c.amount.toLocaleString()}`);
