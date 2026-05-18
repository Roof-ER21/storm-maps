#!/usr/bin/env node
// v2 flatten: merges job export + detail + invoice into a single record.
// Adds customerID for proper grouping. Strips bcrypt password hashes.

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

const RIQ_BASE = process.env.RIQ_BASE || "/Users/a21/storm-maps";

const DETAIL_DIR = `${RIQ_BASE}/data/roofdocs-pull`;
const INVOICE_DIR = `${RIQ_BASE}/data/roofdocs-invoices`;
const EXPORT_FILE = '/tmp/jobs-export.json';
const OUT_FILE = `${RIQ_BASE}/data/projects.json`;

const stateMap = { virginia: 'VA', maryland: 'MD', pennsylvania: 'PA' };
function normState(s) {
  if (!s) return null;
  const t = String(s).trim();
  const low = t.toLowerCase();
  if (stateMap[low]) return stateMap[low];
  return t.toUpperCase().slice(0, 2);
}
function isoDate(d) {
  if (!d || d === 'N/A') return null;
  const m = String(d).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  return String(d).slice(0, 10);
}
function num(v) {
  return typeof v === 'number' ? v : (v != null && !isNaN(Number(v)) ? Number(v) : null);
}

console.log('Loading export…');
const exp = JSON.parse(fs.readFileSync(EXPORT_FILE, 'utf8')).data;
const expById = new Map(exp.map((r) => [r.jobID, r]));
console.log(`Export records: ${exp.length}`);

const files = (await fsp.readdir(DETAIL_DIR))
  .filter((f) => f.endsWith('.json') && !f.startsWith('_'));
console.log(`Detail files: ${files.length}`);
const invoiceFiles = new Set(
  (await fsp.readdir(INVOICE_DIR)).filter((f) => f.endsWith('.json') && !f.startsWith('_')),
);
console.log(`Invoice files: ${invoiceFiles.size}`);

const all = [];
let kept = 0;
let skipped = 0;

for (const f of files) {
  const raw = JSON.parse(fs.readFileSync(path.join(DETAIL_DIR, f), 'utf8'));
  const j = raw.data;
  if (!j) { skipped++; continue; }

  const c = j.coordinates;
  let lat = null, lng = null;
  if (c && c.type === 'Point' && Array.isArray(c.coordinates) && c.coordinates.length === 2) {
    [lat, lng] = c.coordinates;
  }
  if (lat == null || lng == null) { skipped++; continue; }

  const e = expById.get(j.jobID) || {};
  const ii = j.insuranceInfo || {};
  const jp = j.jobProgress || {};
  const cust = j.customer || {};

  // Customer ID — for grouping multi-job customers
  const customerId = cust.userID || j.userId || null;

  // Trades
  const trades = [];
  if (Array.isArray(jp.jobProgress_trades)) {
    for (const t of jp.jobProgress_trades) {
      const name = (t.trade || {}).name;
      if (name) trades.push(name);
    }
  }

  // Dates
  const signed = isoDate(e.agreementSignedDate || j.agreementSignedDate);
  const dol = isoDate(ii.dateOfLoss || j.dateOfLoss);
  const completed = isoDate(e.jobCompletedDate || j.jobCompletedDate);
  let daysLossToSign = null;
  let daysToComplete = null;
  if (signed && dol) {
    const d = (new Date(signed).getTime() - new Date(dol).getTime()) / 86400000;
    if (Number.isFinite(d)) daysLossToSign = Math.round(d);
  }
  if (signed && completed) {
    const d = (new Date(completed).getTime() - new Date(signed).getTime()) / 86400000;
    if (Number.isFinite(d)) daysToComplete = Math.round(d);
  }

  // Invoice data (if present)
  let invoice = null;
  if (invoiceFiles.has(`${j.jobID}.json`)) {
    try {
      invoice = JSON.parse(fs.readFileSync(path.join(INVOICE_DIR, `${j.jobID}.json`), 'utf8')).data;
    } catch {}
  }
  const inv = invoice || {};

  const flat = {
    id: j.jobID,
    customerId,
    customer: e.customer || null,
    addressLine1: j.addressLine1 || null,
    addressLine2: j.addressLine2 || null,
    city: (j.city || e.city || '').trim() || null,
    state: normState(j.state || e.state),
    zip: j.zipCode || null,
    lat,
    lng,
    statusId: jp.statusId ?? null,
    substatusId: jp.substatusId ?? null,
    stage: e.stage || null,
    jobType: e.jobType || j.type || null,
    houseType: e.houseType || j.houseType || null,
    leadSource: e.leadSource || j.leadSource || null,
    salesRep: e.salesRep || null,
    insurance: ii.insuranceCompany || e.insuranceCompany || null,
    claimType: ii.claimType || j.claimType || null,
    dateOfLoss: dol,
    signedDate: signed,
    projectSignedDate: isoDate(e.projectAgreementSignedDate || j.projectAgreementSignedDate),
    completedDate: completed,
    finalizedDate: isoDate(e.jobFinalizedDate || j.jobFinalizedDate),
    daysLossToSign,
    daysToComplete,
    // financials from export
    initialEstimate: num(e.initialEstimate),
    revisedEstimate: num(e.revisedEstimate),
    insuranceTotal: num(e.insuranceTotal),
    jobTotal: num(e.currentJobTotal),
    upgrades: num(e.upgrades),
    additionalWork: num(e.additionalWork),
    // financials from invoice
    acv: num(inv.acv),
    depreciation: num(inv.depreciation),
    pwi: num(inv.pwi),
    downpayment: num(inv.downpayment),
    completionPayment: num(inv.completionPayment),
    finalPayment: num(inv.finalPayment),
    upgradeAmount: num(inv.upgradeAmount),
    changeOrderAmount: num(inv.changeOrderAmount),
    additionalWorkAmount: num(inv.additionalWorkAmount),
    workNotDoingAmount: num(inv.workNotDoingAmount),
    upgradeItems: Array.isArray(inv.upgradeItems) ? inv.upgradeItems.length : 0,
    changeOrderItems: Array.isArray(inv.changeOrderItems) ? inv.changeOrderItems.length : 0,
    additionalWorkItems: Array.isArray(inv.additionalWorkItems) ? inv.additionalWorkItems.length : 0,
    workNotDoingItems: Array.isArray(inv.workNotDoingItems) ? inv.workNotDoingItems.length : 0,
    creditAmount: num(inv.creditAmount),
    discountAmount: num(inv.discountAmount),
    feeAmount: num(inv.feeAmount),
    quickbooksInvoiceId: inv.quickbooksInvoiceId || null,
    paymentLink: inv.paymentLink || null,
    // adjuster
    adjusterName: ii.adjusterName || null,
    adjusterEmail: ii.adjusterEmail || null,
    adjusterPhone: ii.adjusterPhoneNumber || null,
    deskAdjusterName: ii.deskAdjusterName || null,
    supervisorName: ii.supervisorName || null,
    deductible: num(ii.deductible),
    claimNumber: ii.insuranceClaimNumber || null,
    // scope
    trades,
    tradeCount: trades.length,
    roofAccess: j.roofAccess || null,
    plywoodCondition: j.plywoodCondition || null,
    aluminumSiding: j.aluminumSiding === true || e.aluminumSiding === 'Yes',
    numberOfTrades: j.numberOfTrades ?? e.numberOfTrades ?? null,
    // friction
    paused: j.paused === true,
    pauseCount: Array.isArray(j.pauseHistory) ? j.pauseHistory.length : 0,
    hasSupplement: j.supplementTracker != null,
    // team
    estimatorId: j.estimatorId || null,
    fieldTechId: j.fieldTechId || null,
    projectManagerId: j.projectManagerId || null,
    salesManagerId: j.salesManagerId || null,
    projectCoordinatorId: j.projectCoordinatorId || null,
    repId: j.repId || null,
    // commissions
    commissionRep: num(j.estimatedCommissionTotalRep),
    commissionEstimator: num(j.estimatedCommissionTotalEstimator),
    commissionPC: num(j.estimatedCommissionTotalPC),
    commissionSalesManager: num(j.estimatedCommissionTotalSalesManager),
  };
  all.push(flat);
  kept++;
}

fs.writeFileSync(OUT_FILE, JSON.stringify(all));
console.log(`Kept ${kept}, skipped ${skipped}, size ${(fs.statSync(OUT_FILE).size / 1024 / 1024).toFixed(1)} MB`);
