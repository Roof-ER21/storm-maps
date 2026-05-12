#!/usr/bin/env node
// v3 flatten — adds dashboard-active fields (email/phone/PCname/bidFlags/downpaymentStatus)
// + invoice payment flow + storm-of-record.

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

const RIQ_BASE = process.env.RIQ_BASE || "/Users/a21/Desktop/storm-maps";

const DETAIL_DIR = `${RIQ_BASE}/data/roofdocs-pull`;
const INVOICE_DIR = `${RIQ_BASE}/data/roofdocs-invoices`;
const EXPORT_FILE = '/tmp/jobs-export.json';
const DASHBOARD_FILE = `${RIQ_BASE}/data/roofdocs-reference/dashboard-jobs-active.json`;
const JOB_STORMS_FILE = `${RIQ_BASE}/data/job-storms.json`;
const GEOCODED_FILE = `${RIQ_BASE}/data/geocoded.json`;
const OUT_FILE = `${RIQ_BASE}/data/projects.json`;

const stateMap = { virginia: 'VA', maryland: 'MD', pennsylvania: 'PA' };
const normState = (s) => {
  if (!s) return null;
  const t = String(s).trim();
  return stateMap[t.toLowerCase()] || t.toUpperCase().slice(0, 2);
};
const isoDate = (d) => {
  if (!d || d === 'N/A') return null;
  const m = String(d).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  return String(d).slice(0, 10);
};
const num = (v) => typeof v === 'number' ? v : (v != null && !isNaN(Number(v)) ? Number(v) : null);

// Insurance-carrier types only — Retail/Repair/Cancellation/Add-On are cash deals
// and should never carry a carrier even when the portal accidentally stored "N/A".
const INSURANCE_JOB_TYPES = new Set(['Insurance', 'Insurance Conversion', 'Public Adjuster']);

// Normalize carrier: strip whitespace, drop placeholder strings, return null when not a real carrier.
// "N/A", "n/a", "None", "Unknown", "other", "tbd", empty, or pure punctuation all become null.
const normCarrier = (raw, jobType) => {
  if (!raw) return null;
  const t = String(raw).trim();
  if (!t) return null;
  if (/^(n\/?a|none|null|unknown|other|tbd|n\.?\s*a\.?|\?+)$/i.test(t)) return null;
  // Cash-deal job types should never have a carrier even if a stray value was entered.
  if (jobType && !INSURANCE_JOB_TYPES.has(jobType)) return null;
  return t;
};

console.log('Loading sources…');
const exp = JSON.parse(fs.readFileSync(EXPORT_FILE, 'utf8')).data;
const expById = new Map(exp.map((r) => [r.jobID, r]));
const dash = JSON.parse(fs.readFileSync(DASHBOARD_FILE, 'utf8')).data;
const dashById = new Map(dash.map((r) => [r.jobID, r]));
const jobStorms = JSON.parse(fs.readFileSync(JOB_STORMS_FILE, 'utf8'));
const stormById = new Map(jobStorms.map((s) => [s.jobId, s]));
const geocoded = fs.existsSync(GEOCODED_FILE) ? JSON.parse(fs.readFileSync(GEOCODED_FILE, 'utf8')) : {};
console.log(`  export=${exp.length} dashboard=${dash.length} stormMatches=${jobStorms.length} geocoded=${Object.keys(geocoded).length}`);

const files = (await fsp.readdir(DETAIL_DIR)).filter((f) => f.endsWith('.json') && !f.startsWith('_'));
const invoiceFiles = new Set((await fsp.readdir(INVOICE_DIR)).filter((f) => f.endsWith('.json') && !f.startsWith('_')));
console.log(`  details=${files.length} invoices=${invoiceFiles.size}`);

const all = [];
let kept = 0, skipped = 0;

for (const f of files) {
  const raw = JSON.parse(fs.readFileSync(path.join(DETAIL_DIR, f), 'utf8'));
  const j = raw.data;
  if (!j) { skipped++; continue; }
  const c = j.coordinates;
  let lat = null, lng = null;
  if (c && c.type === 'Point' && Array.isArray(c.coordinates) && c.coordinates.length === 2) {
    [lat, lng] = c.coordinates;
  }
  // Fallback to Census-geocoded coords if portal didn't set them
  if ((lat == null || lng == null) && geocoded[j.jobID]) {
    lat = geocoded[j.jobID].lat;
    lng = geocoded[j.jobID].lng;
  }
  if (lat == null || lng == null) { skipped++; continue; }

  const e = expById.get(j.jobID) || {};
  const da = dashById.get(j.jobID) || {};
  const ii = j.insuranceInfo || {};
  const jp = j.jobProgress || {};
  const cust = j.customer || {};
  const customerId = cust.userID || j.userId || null;

  const trades = [];
  if (Array.isArray(jp.jobProgress_trades)) {
    for (const t of jp.jobProgress_trades) {
      const name = (t.trade || {}).name;
      if (name) trades.push(name);
    }
  }

  const signed = isoDate(e.agreementSignedDate || j.agreementSignedDate);
  const dol = isoDate(ii.dateOfLoss || j.dateOfLoss);
  const completed = isoDate(e.jobCompletedDate || j.jobCompletedDate);
  let daysLossToSign = null, daysToComplete = null;
  if (signed && dol) {
    const d = (new Date(signed).getTime() - new Date(dol).getTime()) / 86400000;
    if (Number.isFinite(d)) daysLossToSign = Math.round(d);
  }
  if (signed && completed) {
    const d = (new Date(completed).getTime() - new Date(signed).getTime()) / 86400000;
    if (Number.isFinite(d)) daysToComplete = Math.round(d);
  }

  let invoice = null;
  if (invoiceFiles.has(`${j.jobID}.json`)) {
    try { invoice = JSON.parse(fs.readFileSync(path.join(INVOICE_DIR, `${j.jobID}.json`), 'utf8')).data; } catch {}
  }
  const inv = invoice || {};
  const sm = stormById.get(j.jobID) || null;

  const flat = {
    id: j.jobID,
    customerId,
    customer: e.customer || null,
    customerEmail: da.email || cust.email || null,
    customerSecondaryEmail: da.secondaryEmail || null,
    customerCell: da.cellPhoneNumber || cust.cellPhoneNumber || null,
    customerHome: da.homePhoneNumber || null,
    phonePreference: da.phonePreference || cust.phonePreference || null,
    addressLine1: j.addressLine1 || null,
    addressLine2: j.addressLine2 || null,
    city: (j.city || e.city || '').trim() || null,
    state: normState(j.state || e.state),
    zip: j.zipCode || null,
    lat, lng,
    statusId: jp.statusId ?? null,
    substatusId: jp.substatusId ?? null,
    stage: e.stage || null,
    jobType: e.jobType || j.type || null,
    houseType: e.houseType || j.houseType || null,
    leadSource: e.leadSource || j.leadSource || null,
    salesRep: e.salesRep || da.salesRepName || null,
    projectCoordinator: da.projectCoordinatorName || (e.projectCoordinator !== 'N/A' ? e.projectCoordinator : null),
    estimator: e.estimator && e.estimator !== 'N/A' ? e.estimator : null,
    insurance: normCarrier(
      ii.insuranceCompany || e.insuranceCompany || da.insuranceCompany,
      e.jobType || j.type,
    ),
    claimType: ii.claimType || j.claimType || null,
    dateOfLoss: dol,
    signedDate: signed,
    projectSignedDate: isoDate(e.projectAgreementSignedDate || j.projectAgreementSignedDate),
    completedDate: completed,
    finalizedDate: isoDate(e.jobFinalizedDate || j.jobFinalizedDate),
    expectedWorkStartDate: isoDate(da.expectedWorkStartDate),
    createdAt: da.createdAt ? da.createdAt.slice(0, 10) : null,
    lastUpdated: da.lastUpdated ? da.lastUpdated.slice(0, 10) : null,
    daysLossToSign, daysToComplete,
    initialEstimate: num(e.initialEstimate),
    revisedEstimate: num(e.revisedEstimate),
    insuranceTotal: num(e.insuranceTotal),
    jobTotal: num(e.currentJobTotal) ?? num(da.jobTotal),
    upgrades: num(e.upgrades),
    additionalWork: num(e.additionalWork),
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
    quickbooksInvoiceId: inv.quickbooksInvoiceId || null,
    paymentLink: inv.paymentLink || null,
    // Bid flags (from dashboard) — what was supplementary-bid
    drywallPaintingBid: da.drywallPaintingBid === 1,
    metalRoofingBid: da.metalRoofingBid === 1,
    solarBid: da.solarBid === 1,
    otherBid: da.otherBid === 1,
    // Status tracking from dashboard
    downpaymentStatus: da.downpaymentStatus || null,
    supplementTrackerStatus: da.supplementTrackerStatus || null,
    readyForInstall: da.readyForInstallJob === 1,
    publicAdjustmentStatus: da.publicAdjustmentStatus || null,
    warrantyAvailable: da.warrantyAvailable === 1 || j.warrantyAvailable === true,
    // Insurance details
    adjusterName: ii.adjusterName || null,
    adjusterEmail: ii.adjusterEmail || null,
    adjusterPhone: ii.adjusterPhoneNumber || null,
    deskAdjusterName: ii.deskAdjusterName || null,
    supervisorName: ii.supervisorName || null,
    deductible: num(ii.deductible),
    claimNumber: ii.insuranceClaimNumber || null,
    // Scope
    trades,
    tradeCount: trades.length,
    roofAccess: j.roofAccess || null,
    plywoodCondition: j.plywoodCondition || null,
    aluminumSiding: j.aluminumSiding === true || e.aluminumSiding === 'Yes',
    // Friction
    paused: j.paused === true,
    pauseCount: Array.isArray(j.pauseHistory) ? j.pauseHistory.length : 0,
    hasSupplement: j.supplementTracker != null,
    // Team
    estimatorId: j.estimatorId || null,
    fieldTechId: da.fieldTechId || j.fieldTechId || null,
    projectManagerId: da.projectManagerId || j.projectManagerId || null,
    salesManagerId: j.salesManagerId || null,
    projectCoordinatorId: da.projectCoordinatorId || j.projectCoordinatorId || null,
    repId: da.repId || j.repId || null,
    commissionRep: num(j.estimatedCommissionTotalRep),
    commissionEstimator: num(j.estimatedCommissionTotalEstimator),
    commissionPC: num(j.estimatedCommissionTotalPC),
    commissionSalesManager: num(j.estimatedCommissionTotalSalesManager),
    // Storm match
    stormMatch: sm ? {
      stormId: sm.stormId, stormDate: sm.stormDate, stormType: sm.stormType,
      stormMagnitude: sm.stormMagnitude, stormUnit: sm.stormUnit,
      stormDistanceMiles: sm.stormDistanceMiles, daysFromLossToStorm: sm.daysFromLossToStorm,
    } : null,
  };
  all.push(flat);
  kept++;
}

fs.writeFileSync(OUT_FILE, JSON.stringify(all));
console.log(`Kept ${kept}, skipped ${skipped}, size ${(fs.statSync(OUT_FILE).size / 1024 / 1024).toFixed(1)} MB`);

// Stats
const withEmail = all.filter((r) => r.customerEmail).length;
const withPhone = all.filter((r) => r.customerCell || r.customerHome).length;
const withSolarBid = all.filter((r) => r.solarBid).length;
const withMetalBid = all.filter((r) => r.metalRoofingBid).length;
const withDrywallBid = all.filter((r) => r.drywallPaintingBid).length;
console.log(`\nContact info:`);
console.log(`  With customerEmail: ${withEmail}`);
console.log(`  With phone:         ${withPhone}`);
console.log(`Bid flags:`);
console.log(`  solarBid=true:      ${withSolarBid}`);
console.log(`  metalRoofingBid:    ${withMetalBid}`);
console.log(`  drywallPaintingBid: ${withDrywallBid}`);
