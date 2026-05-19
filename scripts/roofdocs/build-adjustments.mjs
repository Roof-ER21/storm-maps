#!/usr/bin/env node
// Strip PII + bcrypt password hashes from raw adjustments-open.json.
// Output: data/adjustments-open.json (PA-tracker records, ~22 entries).

import fs from 'node:fs';

const RIQ_BASE = process.env.RIQ_BASE || '/Users/a21/storm-maps';
const IN = `${RIQ_BASE}/data/roofdocs-reference/adjustments-open.json`;
const OUT = `${RIQ_BASE}/data/adjustments-open.json`;

const raw = JSON.parse(fs.readFileSync(IN, 'utf8'));
const data = raw.data || [];

function cleanUser(u) {
  if (!u) return null;
  return {
    firstName: u.firstName,
    lastName: u.lastName,
    email: u.email,
    cellPhoneNumber: u.cellPhoneNumber,
  };
}

const out = data.map((a) => ({
  publicAdjustmentID: a.publicAdjustmentID,
  status: a.status,
  dateAdded: a.dateAdded,
  lastModified: a.lastModified,
  comments: a.comments,
  tasks: a.tasks,
  photosNeeded: a.photosNeeded,
  jobId: a.jobId,
  customerId: a.customerId,
  assigneeId: a.assigneeId,
  customer: cleanUser(a.user),
  assignee: cleanUser(a.assignee),
  job: a.job ? {
    jobID: a.job.jobID,
    addressLine1: a.job.addressLine1,
    city: a.job.city,
    state: a.job.state,
    zipCode: a.job.zipCode,
    jobTotal: a.job.currentJobTotal,
  } : null,
  insurance: a.insuranceInfo ? {
    company: a.insuranceInfo.insuranceCompany,
    claimNumber: a.insuranceInfo.insuranceClaimNumber,
    adjusterName: a.insuranceInfo.adjusterName,
  } : null,
}));

fs.writeFileSync(OUT, JSON.stringify({ adjustments: out }));

// Stats
const byStatus = {};
for (const a of out) byStatus[a.status || '(unknown)'] = (byStatus[a.status || '(unknown)'] || 0) + 1;
const byAssignee = {};
for (const a of out) {
  const k = a.assignee ? `${a.assignee.firstName} ${a.assignee.lastName}` : '(unassigned)';
  byAssignee[k] = (byAssignee[k] || 0) + 1;
}
console.log(`Wrote ${OUT} — ${out.length} open public adjustments`);
console.log('  by status:', byStatus);
console.log('  by assignee:', byAssignee);
