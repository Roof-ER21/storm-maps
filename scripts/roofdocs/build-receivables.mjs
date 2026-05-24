#!/usr/bin/env node
// Extract clean AR records from receivables-open.json — strip bcrypt password hashes.

import fs from 'node:fs';

const RIQ_BASE = process.env.RIQ_BASE || "/Users/a21/RIQ21";

const IN = `${RIQ_BASE}/data/roofdocs-reference/receivables-open.json`;
const PROJECTS = `${RIQ_BASE}/data/projects.json`;
const OUT = `${RIQ_BASE}/data/receivables.json`;

const raw = JSON.parse(fs.readFileSync(IN, 'utf8')).data;
const projects = JSON.parse(fs.readFileSync(PROJECTS, 'utf8'));
const projById = new Map(projects.map((p) => [p.id, p]));

function cleanUser(u) {
  if (!u) return null;
  return {
    firstName: u.firstName, lastName: u.lastName,
    email: u.email, cellPhoneNumber: u.cellPhoneNumber, homePhoneNumber: u.homePhoneNumber,
  };
}

const accounts = (raw.accounts || []).map((a) => {
  const proj = projById.get(a.jobId);
  return {
    accountsReceivableID: a.accountsReceivableID,
    status: a.status,
    lastModified: a.lastModified,
    completionPayment: a.completionPayment,
    finalPayment: a.finalPayment,
    sentOn: a.sentOn,
    comments: a.comments,
    jobId: a.jobId,
    customerId: a.customerId,
    assigneeId: a.assigneeId,
    // Preserve assignee name so AR-collector views don't show raw UUIDs.
    // assignee is the AR collector working this account, not the customer.
    assigneeName: a.assignee ? `${a.assignee.firstName || ''} ${a.assignee.lastName || ''}`.trim() : null,
    invoiceId: a.invoiceId,
    customer: cleanUser(a.user),
    job: a.job ? { jobID: a.job.jobID, addressLine1: a.job.addressLine1, city: a.job.city, state: a.job.state, zipCode: a.job.zipCode, jobTotal: a.job.currentJobTotal, completedDate: a.job.jobCompletedDate, finalizedDate: a.job.jobFinalizedDate } : null,
    insurance: a.insuranceInfo ? { company: a.insuranceInfo.insuranceCompany, claimNumber: a.insuranceInfo.insuranceClaimNumber, deductible: a.insuranceInfo.deductible, adjusterName: a.insuranceInfo.adjusterName } : null,
    // Enrich with project lookup
    proj: proj ? {
      jobTotal: proj.jobTotal,
      insuranceTotal: proj.insuranceTotal,
      acv: proj.acv,
      depreciation: proj.depreciation,
      salesRep: proj.salesRep,
      lat: proj.lat, lng: proj.lng,
      stage: proj.stage,
    } : null,
  };
});

const downpayments = (raw.downpayments || []).map((d) => ({
  downpaymentTrackerID: d.downpaymentTrackerID,
  status: d.status,
  dateAdded: d.dateAdded,
  lastModified: d.lastModified,
  comments: d.comments,
  jobId: d.jobId,
  customerId: d.customerId,
  customer: cleanUser(d.user),
  insurance: d.insuranceInfo ? { company: d.insuranceInfo.insuranceCompany, deductible: d.insuranceInfo.deductible } : null,
  job: d.job ? { addressLine1: d.job.addressLine1, city: d.job.city, state: d.job.state, jobTotal: d.job.currentJobTotal } : null,
}));

const out = { accounts, downpayments };
fs.writeFileSync(OUT, JSON.stringify(out));

// Stats
const onTable = accounts.reduce((s, a) => s + (a.proj?.jobTotal || a.job?.jobTotal || 0), 0);
const downpaymentTotal = downpayments.reduce((s, d) => s + (d.job?.jobTotal || 0), 0);
console.log(`Wrote ${OUT}`);
console.log(`  AR accounts:  ${accounts.length} — total job value $${onTable.toLocaleString()}`);
console.log(`  Downpayments: ${downpayments.length} — total job value $${downpaymentTotal.toLocaleString()}`);

// Status breakdown
const arByStatus = {};
for (const a of accounts) arByStatus[a.status || 'Unknown'] = (arByStatus[a.status || 'Unknown'] || 0) + 1;
console.log('  AR by status:', arByStatus);
const dpByStatus = {};
for (const d of downpayments) dpByStatus[d.status || 'Unknown'] = (dpByStatus[d.status || 'Unknown'] || 0) + 1;
console.log('  Downpayments by status:', dpByStatus);
