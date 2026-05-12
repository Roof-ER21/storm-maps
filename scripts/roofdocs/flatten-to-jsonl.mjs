#!/usr/bin/env node
// Walks data/roofdocs-pull/*.json and merges with the bulk export to produce
// a flat projects.json the map viewer can load.
//
// Detail endpoint gives: street, coords, statusId, substatusId.
// Export endpoint gives: financials, stage, customer/rep as strings (no PII bcrypt).

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

const RIQ_BASE = process.env.RIQ_BASE || "/Users/a21/Desktop/storm-maps";

const IN_DIR = `${RIQ_BASE}/data/roofdocs-pull`;
const EXPORT_FILE = '/tmp/jobs-export.json';
const OUT_FILE = `${RIQ_BASE}/data/projects.jsonl`;
const OUT_JSON = `${RIQ_BASE}/data/projects.json`;

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
  // MM/DD/YYYY → YYYY-MM-DD
  const m = String(d).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  // already ISO
  return String(d).slice(0, 10);
}

// Load export → map by jobID
console.log('Loading export…');
const exp = JSON.parse(fs.readFileSync(EXPORT_FILE, 'utf8')).data;
const expById = new Map(exp.map((r) => [r.jobID, r]));
console.log(`Export records: ${exp.length}`);

const files = (await fsp.readdir(IN_DIR))
  .filter((f) => f.endsWith('.json') && !f.startsWith('_'));
console.log(`Detail files: ${files.length}`);

const out = fs.createWriteStream(OUT_FILE);
const all = [];
let kept = 0;
let skipped = 0;
const reasons = new Map();
function bump(k) { reasons.set(k, (reasons.get(k) || 0) + 1); }

for (const f of files) {
  const raw = JSON.parse(fs.readFileSync(path.join(IN_DIR, f), 'utf8'));
  const j = raw.data;
  if (!j) { skipped++; bump('no_data'); continue; }

  const c = j.coordinates;
  let lat = null;
  let lng = null;
  if (c && c.type === 'Point' && Array.isArray(c.coordinates) && c.coordinates.length === 2) {
    [lat, lng] = c.coordinates;
  }
  if (lat == null || lng == null) { skipped++; bump('no_coords'); continue; }

  const e = expById.get(j.jobID) || {};
  const ii = j.insuranceInfo || {};
  const jp = j.jobProgress || {};

  const insurance = ii.insuranceCompany || e.insuranceCompany || null;
  const claimType = ii.claimType || j.claimType || null;
  const dateOfLoss = ii.dateOfLoss || j.dateOfLoss || null;

  // Trades — array of trade name strings
  const trades = [];
  if (Array.isArray(jp.jobProgress_trades)) {
    for (const t of jp.jobProgress_trades) {
      const name = (t.trade || {}).name;
      if (name) trades.push(name);
    }
  }

  // Days from loss to sign — response speed proxy
  let daysLossToSign = null;
  const signed = isoDate(e.agreementSignedDate || j.agreementSignedDate);
  const dol = isoDate(dateOfLoss);
  if (signed && dol) {
    const ds = new Date(signed).getTime();
    const dl = new Date(dol).getTime();
    if (Number.isFinite(ds) && Number.isFinite(dl)) {
      daysLossToSign = Math.round((ds - dl) / 86400000);
    }
  }
  // Days from sign to completion
  let daysToComplete = null;
  const completed = isoDate(e.jobCompletedDate || j.jobCompletedDate);
  if (signed && completed) {
    const ds = new Date(signed).getTime();
    const dc = new Date(completed).getTime();
    if (Number.isFinite(ds) && Number.isFinite(dc)) {
      daysToComplete = Math.round((dc - ds) / 86400000);
    }
  }

  const flat = {
    id: j.jobID,
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
    salesRepCommissionPercent: e.salesRepCommissionPercent || null,
    projectCoordinator: e.projectCoordinator && e.projectCoordinator !== 'N/A' ? e.projectCoordinator : null,
    estimator: e.estimator && e.estimator !== 'N/A' ? e.estimator : null,
    insurance,
    claimType,
    dateOfLoss: isoDate(dateOfLoss),
    signedDate: signed,
    projectSignedDate: isoDate(e.projectAgreementSignedDate || j.projectAgreementSignedDate),
    completedDate: completed,
    finalizedDate: isoDate(e.jobFinalizedDate || j.jobFinalizedDate),
    daysLossToSign,
    daysToComplete,
    initialEstimate: typeof e.initialEstimate === 'number' ? e.initialEstimate : null,
    revisedEstimate: typeof e.revisedEstimate === 'number' ? e.revisedEstimate : null,
    insuranceTotal: typeof e.insuranceTotal === 'number' ? e.insuranceTotal : null,
    jobTotal: typeof e.currentJobTotal === 'number' ? e.currentJobTotal : null,
    upgrades: typeof e.upgrades === 'number' ? e.upgrades : null,
    additionalWork: typeof e.additionalWork === 'number' ? e.additionalWork : null,
    // NEW: insurance details
    adjusterName: ii.adjusterName || null,
    adjusterEmail: ii.adjusterEmail || null,
    adjusterPhone: ii.adjusterPhoneNumber || null,
    deskAdjusterName: ii.deskAdjusterName || null,
    supervisorName: ii.supervisorName || null,
    deductible: typeof ii.deductible === 'number' ? ii.deductible : null,
    claimNumber: ii.insuranceClaimNumber || null,
    // NEW: scope + property characteristics
    trades,
    tradeCount: trades.length,
    roofAccess: j.roofAccess || null,
    plywoodCondition: j.plywoodCondition || null,
    aluminumSiding: j.aluminumSiding === true || e.aluminumSiding === 'Yes',
    numberOfTrades: j.numberOfTrades ?? e.numberOfTrades ?? null,
    // NEW: friction signals
    paused: j.paused === true,
    pauseCount: Array.isArray(j.pauseHistory) ? j.pauseHistory.length : 0,
    hasSupplement: j.supplementTracker != null,
    // NEW: team attribution
    estimatorId: j.estimatorId || null,
    fieldTechId: j.fieldTechId || null,
    projectManagerId: j.projectManagerId || null,
    salesManagerId: j.salesManagerId || null,
    projectCoordinatorId: j.projectCoordinatorId || null,
    paidSalesManagerId: j.paidSalesManagerId || null,
    repId: j.repId || null,
    // NEW: financial detail
    commissionRep: j.estimatedCommissionTotalRep ?? null,
    commissionEstimator: j.estimatedCommissionTotalEstimator ?? null,
    commissionPC: j.estimatedCommissionTotalPC ?? null,
    commissionSalesManager: j.estimatedCommissionTotalSalesManager ?? null,
  };
  out.write(JSON.stringify(flat) + '\n');
  all.push(flat);
  kept++;
}

await new Promise((res) => out.end(res));
fs.writeFileSync(OUT_JSON, JSON.stringify(all));

console.log(`Kept (with coords): ${kept}`);
console.log(`Skipped: ${skipped}`);
for (const [r, n] of reasons) console.log(`  ${r}: ${n}`);
console.log(`Wrote ${OUT_FILE} (${(fs.statSync(OUT_FILE).size / 1024 / 1024).toFixed(1)} MB)`);
console.log(`Wrote ${OUT_JSON} (${(fs.statSync(OUT_JSON).size / 1024 / 1024).toFixed(1)} MB)`);
