// Build per-entity "cheat sheets" — math-backed track records for every rep,
// carrier, adjuster, state, and ZIP. Different from patterns.json (which is
// market-wide aggregates) — this is entity-centric drill-downs with sample
// sizes attached to every percentage so users know what to trust.
//
// Rules:
//   • Never expose a % without its N (sample size).
//   • Hide stats where N < MIN_N (configurable, default 5).
//   • Use raw fields from projects.json — same as Field Portal + Sales Report:
//       Insurance jobs:  insuranceTotal on signed jobs in {Insurance, Insurance Conversion, Public Adjuster}.
//       Retail jobs:     currentJobTotal (jobTotal) on signed jobs in {Retail}.
//   • Cohort deltas are vs the OVERALL team baseline (so + means above the
//     team's median performance, - means below).
//
// Outputs: data/cheat-sheets.json
// Consumed by: public/cheat-sheet.html

import fs from 'node:fs';

const RIQ_BASE = process.env.RIQ_BASE || '/Users/a21/Desktop/storm-maps';

const PROJECTS = `${RIQ_BASE}/data/projects.json`;
const OUT = `${RIQ_BASE}/data/cheat-sheets.json`;

const MIN_N = 5; // sample-size floor — under this we mark "insufficient data"

const INS_TYPES = new Set(['Insurance', 'Insurance Conversion', 'Public Adjuster']);
const RETAIL_TYPES = new Set(['Retail']);

const PLACEHOLDER_CARRIER = /^(n\/?a|none|null|unknown|other|tbd|n\.?\s*a\.?|\?+)$/i;
const isRealCarrier = (v) => !!v && !PLACEHOLDER_CARRIER.test(String(v).trim());

const isCompleted = (j) => /completed|finalized/i.test(j.stage || '');
const isDead = (j) => /dead|cancel/i.test(j.stage || '');
const isSigned = (j) => !!j.signedDate;

function pct(n, d) { return d > 0 ? n / d : 0; }
function median(arr) {
  if (!arr.length) return null;
  const s = [...arr].filter((x) => x != null && Number.isFinite(x)).sort((a, b) => a - b);
  if (!s.length) return null;
  return s[Math.floor(s.length / 2)];
}
function p25p75(arr) {
  const s = [...arr].filter((x) => x != null && Number.isFinite(x)).sort((a, b) => a - b);
  if (s.length < 4) return [null, null];
  return [s[Math.floor(s.length * 0.25)], s[Math.floor(s.length * 0.75)]];
}

// Hail tiers — same buckets as patterns.json so the carrier×hail matrix lines up.
function hailBucket(mag) {
  if (mag == null) return null;
  if (mag < 0.75) return '<0.75';
  if (mag < 1.0) return '0.75-1.0';
  if (mag < 1.25) return '1.0-1.25';
  if (mag < 1.5) return '1.25-1.5';
  if (mag < 2.0) return '1.5-2.0';
  return '≥2.0';
}

const projects = JSON.parse(fs.readFileSync(PROJECTS, 'utf8'));
console.log(`Loaded ${projects.length} projects`);

// Normalize: trim rep + carrier names so 'Jason Brown ' lines up with 'Jason Brown'.
for (const j of projects) {
  if (j.salesRep) j.salesRep = String(j.salesRep).trim();
  if (j.adjusterName) j.adjusterName = String(j.adjusterName).trim();
  if (j.insurance) j.insurance = String(j.insurance).trim();
}

// Team baselines — the cohort to compare individuals against.
const insSignedTeam = projects.filter((j) => isSigned(j) && INS_TYPES.has(j.jobType));
const teamApprovedCount = insSignedTeam.filter(isCompleted).length;
const teamDeadCount = insSignedTeam.filter(isDead).length;
const teamBaselineApproval = pct(teamApprovedCount, insSignedTeam.length - teamDeadCount);
const teamMedianDaysLossToSign = median(insSignedTeam.map((j) => j.daysLossToSign).filter((v) => v != null && v >= 0 && v < 365));
const teamMedianDaysSignToComplete = median(insSignedTeam.map((j) => j.daysToComplete).filter((v) => v != null && v >= 0 && v < 730));

console.log(`Team baseline approval (Insurance signed): ${(teamBaselineApproval * 100).toFixed(1)}% across ${insSignedTeam.length} jobs`);
console.log(`Team median days loss→sign: ${teamMedianDaysLossToSign}`);
console.log(`Team median days sign→complete: ${teamMedianDaysSignToComplete}`);

// ===== REPS =====
const reps = {};
for (const j of projects) {
  const rep = j.salesRep;
  if (!rep || !isSigned(j)) continue;
  if (!reps[rep]) {
    reps[rep] = {
      name: rep,
      _ins: [], _retail: [],
      _byCarrier: {}, _byAdjuster: {}, _byZip: {}, _byTrade: {},
      _signOffsetDays: [], _completeOffsetDays: [],
      _byStorm: {},
    };
  }
  const r = reps[rep];
  if (INS_TYPES.has(j.jobType)) {
    r._ins.push(j);
    if (j.daysLossToSign != null && j.daysLossToSign >= 0 && j.daysLossToSign < 365) r._signOffsetDays.push(j.daysLossToSign);
    if (j.daysToComplete != null && j.daysToComplete >= 0 && j.daysToComplete < 730) r._completeOffsetDays.push(j.daysToComplete);
    if (isRealCarrier(j.insurance)) {
      if (!r._byCarrier[j.insurance]) r._byCarrier[j.insurance] = { jobs: [], approved: 0, dead: 0, insTotal: 0 };
      const c = r._byCarrier[j.insurance];
      c.jobs.push(j);
      if (isCompleted(j)) c.approved++;
      if (isDead(j)) c.dead++;
      c.insTotal += j.insuranceTotal || 0;
    }
    if (j.adjusterName) {
      const key = `${j.adjusterName}|${j.insurance || 'Unknown'}`;
      if (!r._byAdjuster[key]) r._byAdjuster[key] = { name: j.adjusterName, carrier: j.insurance || 'Unknown', jobs: 0, approved: 0, dead: 0 };
      const a = r._byAdjuster[key];
      a.jobs++;
      if (isCompleted(j)) a.approved++;
      if (isDead(j)) a.dead++;
    }
    if (j.stormMatch && j.stormMatch.stormId) {
      const sid = j.stormMatch.stormId;
      if (!r._byStorm[sid]) r._byStorm[sid] = { stormId: sid, date: j.stormMatch.stormDate, type: j.stormMatch.stormType, mag: j.stormMatch.stormMagnitude, jobs: 0 };
      r._byStorm[sid].jobs++;
    }
  } else if (RETAIL_TYPES.has(j.jobType)) {
    r._retail.push(j);
  }
  // ZIP + Trade tally regardless of jobType
  if (j.zip) {
    const z = j.zip.slice(0, 5);
    if (!r._byZip[z]) r._byZip[z] = { zip: z, city: j.city || '', jobs: 0, approved: 0, revenue: 0 };
    r._byZip[z].jobs++;
    if (isCompleted(j)) {
      r._byZip[z].approved++;
      r._byZip[z].revenue += (INS_TYPES.has(j.jobType) ? (j.insuranceTotal || 0) : (j.jobTotal || 0));
    }
  }
  for (const t of (j.trades || [])) {
    if (!r._byTrade[t]) r._byTrade[t] = { trade: t, jobs: 0, approved: 0 };
    r._byTrade[t].jobs++;
    if (isCompleted(j)) r._byTrade[t].approved++;
  }
}

const repCheats = Object.values(reps).map((r) => {
  const insSignedCount = r._ins.length;
  const insApproved = r._ins.filter(isCompleted).length;
  const insDead = r._ins.filter(isDead).length;
  const insTotal = r._ins.reduce((s, j) => s + (j.insuranceTotal || 0), 0);
  const retSigned = r._retail.length;
  const retApproved = r._retail.filter(isCompleted).length;
  const retTotal = r._retail.reduce((s, j) => s + (j.jobTotal || 0), 0);
  const repApproval = pct(insApproved, insSignedCount - insDead);
  const byCarrier = Object.entries(r._byCarrier)
    .map(([carrier, c]) => ({
      carrier,
      jobs: c.jobs.length,
      approved: c.approved,
      dead: c.dead,
      approvalRate: pct(c.approved, c.jobs.length - c.dead),
      insTotal: c.insTotal,
      avgApprovedJob: c.approved > 0 ? c.insTotal / c.approved : null,
      deltaVsRepBaseline: pct(c.approved, c.jobs.length - c.dead) - repApproval,
    }))
    .sort((a, b) => b.jobs - a.jobs);

  const byAdjuster = Object.values(r._byAdjuster)
    .filter((a) => a.jobs >= 2)
    .map((a) => ({
      ...a,
      approvalRate: pct(a.approved, a.jobs - a.dead),
      deltaVsRepBaseline: pct(a.approved, a.jobs - a.dead) - repApproval,
    }))
    .sort((a, b) => b.jobs - a.jobs)
    .slice(0, 20);

  const byZip = Object.values(r._byZip)
    .sort((a, b) => b.jobs - a.jobs)
    .slice(0, 15);

  const byTrade = Object.values(r._byTrade)
    .sort((a, b) => b.jobs - a.jobs)
    .map((t) => ({ ...t, approvalRate: pct(t.approved, t.jobs) }));

  const topStorms = Object.values(r._byStorm)
    .sort((a, b) => b.jobs - a.jobs)
    .slice(0, 8);

  const medianSign = median(r._signOffsetDays);
  const medianComplete = median(r._completeOffsetDays);

  // best/worst carrier (require N >= MIN_N for credibility)
  const carriersN = byCarrier.filter((c) => c.jobs >= MIN_N);
  const sortedByRate = [...carriersN].sort((a, b) => b.approvalRate - a.approvalRate);
  const best = sortedByRate[0];
  const worst = sortedByRate[sortedByRate.length - 1];

  return {
    name: r.name,
    totals: {
      insSigned: insSignedCount,
      insApproved, insDead,
      insTotal,
      insApprovalRate: repApproval,
      retailSigned: retSigned, retailApproved: retApproved, retailTotal: retTotal,
      combinedSignedTotal: insTotal + retTotal,
    },
    cohortDelta: {
      approvalRate: repApproval - teamBaselineApproval,
      medianDaysLossToSign: medianSign != null && teamMedianDaysLossToSign != null ? medianSign - teamMedianDaysLossToSign : null,
      medianDaysSignToComplete: medianComplete != null && teamMedianDaysSignToComplete != null ? medianComplete - teamMedianDaysSignToComplete : null,
    },
    speed: { medianDaysLossToSign: medianSign, medianDaysSignToComplete: medianComplete },
    byCarrier, byAdjuster, byZip, byTrade,
    topStorms,
    bestCarrier: best ? { carrier: best.carrier, approvalRate: best.approvalRate, jobs: best.jobs, deltaPp: best.deltaVsRepBaseline } : null,
    worstCarrier: worst && worst !== best ? { carrier: worst.carrier, approvalRate: worst.approvalRate, jobs: worst.jobs, deltaPp: worst.deltaVsRepBaseline } : null,
  };
}).sort((a, b) => b.totals.combinedSignedTotal - a.totals.combinedSignedTotal);

console.log(`Built ${repCheats.length} rep cheat sheets`);

// ===== CARRIERS =====
const carriers = {};
for (const j of projects) {
  if (!isRealCarrier(j.insurance) || !isSigned(j) || !INS_TYPES.has(j.jobType)) continue;
  if (!carriers[j.insurance]) {
    carriers[j.insurance] = {
      name: j.insurance,
      _jobs: [],
      _byAdjuster: {}, _byRep: {}, _byState: {}, _byHail: {}, _byZip: {},
    };
  }
  const c = carriers[j.insurance];
  c._jobs.push(j);
  if (j.adjusterName) {
    if (!c._byAdjuster[j.adjusterName]) c._byAdjuster[j.adjusterName] = { name: j.adjusterName, jobs: 0, approved: 0, dead: 0, uplifts: [] };
    const a = c._byAdjuster[j.adjusterName];
    a.jobs++;
    if (isCompleted(j)) a.approved++;
    if (isDead(j)) a.dead++;
    if (j.initialEstimate && j.revisedEstimate && j.initialEstimate > 0) {
      a.uplifts.push((j.revisedEstimate - j.initialEstimate) / j.initialEstimate);
    }
  }
  if (j.salesRep) {
    if (!c._byRep[j.salesRep]) c._byRep[j.salesRep] = { name: j.salesRep, jobs: 0, approved: 0, dead: 0, insTotal: 0 };
    const rp = c._byRep[j.salesRep];
    rp.jobs++;
    if (isCompleted(j)) rp.approved++;
    if (isDead(j)) rp.dead++;
    rp.insTotal += j.insuranceTotal || 0;
  }
  if (j.state) {
    if (!c._byState[j.state]) c._byState[j.state] = { state: j.state, jobs: 0, approved: 0, dead: 0, deductibles: [] };
    const st = c._byState[j.state];
    st.jobs++;
    if (isCompleted(j)) st.approved++;
    if (isDead(j)) st.dead++;
    if (j.deductible && j.deductible <= 50000) st.deductibles.push(j.deductible);
  }
  const hb = j.stormMatch && j.stormMatch.stormType === 'HAIL' ? hailBucket(j.stormMatch.stormMagnitude) : null;
  if (hb) {
    if (!c._byHail[hb]) c._byHail[hb] = { tier: hb, jobs: 0, approved: 0, dead: 0 };
    const h = c._byHail[hb];
    h.jobs++;
    if (isCompleted(j)) h.approved++;
    if (isDead(j)) h.dead++;
  }
  if (j.zip) {
    const z = j.zip.slice(0, 5);
    if (!c._byZip[z]) c._byZip[z] = { zip: z, city: j.city || '', jobs: 0, approved: 0 };
    c._byZip[z].jobs++;
    if (isCompleted(j)) c._byZip[z].approved++;
  }
}

const carrierCheats = Object.values(carriers).map((c) => {
  const jobs = c._jobs;
  const approved = jobs.filter(isCompleted).length;
  const dead = jobs.filter(isDead).length;
  const approvalRate = pct(approved, jobs.length - dead);
  const carrierBaseline = approvalRate;
  const deductibles = jobs.map((j) => j.deductible).filter((v) => v && v <= 50000);
  const acvs = jobs.map((j) => j.acv).filter((v) => v != null);
  const depreciations = jobs.map((j) => j.depreciation).filter((v) => v != null);
  const insTotals = jobs.map((j) => j.insuranceTotal).filter((v) => v != null && v > 0);
  const uplifts = jobs
    .filter((j) => j.initialEstimate && j.revisedEstimate && j.initialEstimate > 0)
    .map((j) => (j.revisedEstimate - j.initialEstimate) / j.initialEstimate);
  const dlts = jobs.map((j) => j.daysLossToSign).filter((v) => v != null && v >= 0 && v < 365);
  const dtcs = jobs.map((j) => j.daysToComplete).filter((v) => v != null && v >= 0 && v < 730);

  const adjusters = Object.values(c._byAdjuster)
    .filter((a) => a.jobs >= MIN_N)
    .map((a) => ({
      name: a.name, jobs: a.jobs, approved: a.approved, dead: a.dead,
      approvalRate: pct(a.approved, a.jobs - a.dead),
      medianUplift: median(a.uplifts),
      deltaVsCarrier: pct(a.approved, a.jobs - a.dead) - carrierBaseline,
    }))
    .sort((a, b) => b.jobs - a.jobs).slice(0, 25);

  const reps = Object.values(c._byRep)
    .filter((r) => r.jobs >= MIN_N)
    .map((r) => ({
      name: r.name, jobs: r.jobs, approved: r.approved, dead: r.dead,
      approvalRate: pct(r.approved, r.jobs - r.dead),
      insTotal: r.insTotal,
      deltaVsCarrier: pct(r.approved, r.jobs - r.dead) - carrierBaseline,
    }))
    .sort((a, b) => b.insTotal - a.insTotal).slice(0, 20);

  const byState = Object.values(c._byState).map((s) => ({
    ...s,
    approvalRate: pct(s.approved, s.jobs - s.dead),
    medianDeductible: median(s.deductibles),
  })).sort((a, b) => b.jobs - a.jobs);

  const byHail = Object.values(c._byHail).map((h) => ({
    ...h, approvalRate: pct(h.approved, h.jobs - h.dead),
  })).sort((a, b) => {
    const order = ['<0.75', '0.75-1.0', '1.0-1.25', '1.25-1.5', '1.5-2.0', '≥2.0'];
    return order.indexOf(a.tier) - order.indexOf(b.tier);
  });

  const topZips = Object.values(c._byZip)
    .filter((z) => z.jobs >= MIN_N)
    .sort((a, b) => b.jobs - a.jobs).slice(0, 15);

  return {
    name: c.name,
    totals: {
      jobs: jobs.length, approved, dead, approvalRate,
      insTotal: jobs.reduce((s, j) => s + (j.insuranceTotal || 0), 0),
    },
    medianDeductible: median(deductibles),
    medianAcv: median(acvs),
    medianDepreciation: median(depreciations),
    medianInsuranceTotal: median(insTotals),
    medianUplift: median(uplifts),
    pctOver50Uplift: uplifts.length > 0 ? uplifts.filter((u) => u > 0.5).length / uplifts.length : 0,
    medianDaysLossToSign: median(dlts),
    medianDaysSignToComplete: median(dtcs),
    deathRate: pct(dead, jobs.length),
    adjusters, reps, byState, byHail, topZips,
  };
}).sort((a, b) => b.totals.jobs - a.totals.jobs);

console.log(`Built ${carrierCheats.length} carrier cheat sheets`);

// ===== ADJUSTERS =====
const adjusters = {};
for (const j of projects) {
  if (!j.adjusterName || !isSigned(j) || !INS_TYPES.has(j.jobType)) continue;
  const key = `${j.adjusterName}|${j.insurance || 'Unknown'}`;
  if (!adjusters[key]) {
    adjusters[key] = {
      name: j.adjusterName,
      carrier: j.insurance || 'Unknown',
      _jobs: [],
      _byRep: {}, _byCity: {},
    };
  }
  const a = adjusters[key];
  a._jobs.push(j);
  if (j.salesRep) {
    if (!a._byRep[j.salesRep]) a._byRep[j.salesRep] = { name: j.salesRep, jobs: 0, approved: 0, dead: 0 };
    const r = a._byRep[j.salesRep];
    r.jobs++;
    if (isCompleted(j)) r.approved++;
    if (isDead(j)) r.dead++;
  }
  if (j.city) {
    if (!a._byCity[j.city]) a._byCity[j.city] = 0;
    a._byCity[j.city]++;
  }
}

// Get carrier baselines so we can compute "stricter / lenient than carrier"
const carrierBaselines = {};
for (const c of carrierCheats) carrierBaselines[c.name] = c.totals.approvalRate;

const adjusterCheats = Object.values(adjusters)
  .filter((a) => a._jobs.length >= MIN_N - 2) // 3 jobs minimum for adjuster (lower bar; otherwise too many drop out)
  .map((a) => {
    const jobs = a._jobs;
    const approved = jobs.filter(isCompleted).length;
    const dead = jobs.filter(isDead).length;
    const approvalRate = pct(approved, jobs.length - dead);
    const carrierBaseline = carrierBaselines[a.carrier] ?? null;
    const uplifts = jobs.filter((j) => j.initialEstimate && j.revisedEstimate && j.initialEstimate > 0)
      .map((j) => (j.revisedEstimate - j.initialEstimate) / j.initialEstimate);
    const deductibles = jobs.map((j) => j.deductible).filter((v) => v && v <= 50000);
    const reps = Object.values(a._byRep).map((r) => ({
      ...r, approvalRate: pct(r.approved, r.jobs - r.dead),
    })).sort((a, b) => b.jobs - a.jobs).slice(0, 10);
    const cities = Object.entries(a._byCity).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([city, n]) => ({ city, jobs: n }));
    return {
      name: a.name,
      carrier: a.carrier,
      jobs: jobs.length,
      approved, dead, approvalRate,
      carrierBaseline,
      deltaVsCarrier: carrierBaseline != null ? approvalRate - carrierBaseline : null,
      stance: carrierBaseline != null ? (approvalRate - carrierBaseline > 0.05 ? 'lenient' : approvalRate - carrierBaseline < -0.05 ? 'strict' : 'baseline') : 'unknown',
      medianUplift: median(uplifts),
      medianDeductible: median(deductibles),
      reps, cities,
      insufficient: jobs.length < MIN_N,
    };
  }).sort((a, b) => b.jobs - a.jobs);

console.log(`Built ${adjusterCheats.length} adjuster cheat sheets`);

// ===== STATES =====
const STATE_LAW = {
  VA: 'Long 5-year statute of limitations on suing the insurance carrier. Weak bad-faith leverage (§38.2-209). Matching law: silent. Procedural escalation works.',
  MD: 'Strongest bad-faith leverage in the DMV (§27-303). 3-year SOL. Matching law: silent but reasonable interpretation by Insurance Administration.',
  PA: 'Adverse matching precedent (Greene v. USAA 2007). 4-year SOL. Bad faith statute (42 Pa.C.S. § 8371) but limited damages.',
  DC: '3-year SOL. Bad faith law uncertain.',
  WV: '10-year SOL on contract; UCSPA gives private right of action.',
  DE: '3-year SOL. UTPA bad-faith claim allowed.',
};

const stateCheats = {};
for (const j of projects) {
  if (!j.state || !isSigned(j)) continue;
  if (!stateCheats[j.state]) stateCheats[j.state] = { state: j.state, _ins: [], _retail: [], _carriers: {}, _adjusters: {} };
  const s = stateCheats[j.state];
  if (INS_TYPES.has(j.jobType)) s._ins.push(j);
  if (RETAIL_TYPES.has(j.jobType)) s._retail.push(j);
  if (INS_TYPES.has(j.jobType) && isRealCarrier(j.insurance)) {
    if (!s._carriers[j.insurance]) s._carriers[j.insurance] = { name: j.insurance, jobs: 0, approved: 0, dead: 0 };
    const c = s._carriers[j.insurance];
    c.jobs++;
    if (isCompleted(j)) c.approved++;
    if (isDead(j)) c.dead++;
  }
  if (INS_TYPES.has(j.jobType) && j.adjusterName) {
    if (!s._adjusters[j.adjusterName]) s._adjusters[j.adjusterName] = { name: j.adjusterName, jobs: 0, approved: 0, dead: 0, carriers: new Set() };
    const a = s._adjusters[j.adjusterName];
    a.jobs++;
    if (isCompleted(j)) a.approved++;
    if (isDead(j)) a.dead++;
    if (j.insurance) a.carriers.add(j.insurance);
  }
}
const stateOut = Object.values(stateCheats).map((s) => {
  const ins = s._ins;
  const insApproved = ins.filter(isCompleted).length;
  const insDead = ins.filter(isDead).length;
  const insTotal = ins.reduce((sum, j) => sum + (j.insuranceTotal || 0), 0);
  const deductibles = ins.map((j) => j.deductible).filter((v) => v && v <= 50000);
  const topCarriers = Object.values(s._carriers).filter((c) => c.jobs >= MIN_N)
    .map((c) => ({ ...c, approvalRate: pct(c.approved, c.jobs - c.dead) }))
    .sort((a, b) => b.jobs - a.jobs).slice(0, 12);
  const topAdjusters = Object.values(s._adjusters).filter((a) => a.jobs >= MIN_N)
    .map((a) => ({ name: a.name, jobs: a.jobs, approvalRate: pct(a.approved, a.jobs - a.dead), carriers: [...a.carriers].slice(0, 3) }))
    .sort((a, b) => b.jobs - a.jobs).slice(0, 15);
  return {
    state: s.state,
    insJobs: ins.length, insApproved, insDead,
    insApprovalRate: pct(insApproved, ins.length - insDead),
    insTotal,
    medianDeductible: median(deductibles),
    retailJobs: s._retail.length,
    topCarriers, topAdjusters,
    lawSummary: STATE_LAW[s.state] || 'Law summary not in research-encoded set.',
  };
}).sort((a, b) => b.insJobs - a.insJobs);

console.log(`Built ${stateOut.length} state cheat sheets`);

// ===== ZIPS =====
const zips = {};
for (const j of projects) {
  if (!j.zip || !isSigned(j)) continue;
  const z = j.zip.slice(0, 5);
  if (!zips[z]) zips[z] = { zip: z, city: j.city || '', _jobs: [], _carriers: {}, _reps: {}, _adjusters: {} };
  const e = zips[z];
  e._jobs.push(j);
  if (isRealCarrier(j.insurance) && INS_TYPES.has(j.jobType)) {
    if (!e._carriers[j.insurance]) e._carriers[j.insurance] = { name: j.insurance, jobs: 0, approved: 0, dead: 0 };
    const c = e._carriers[j.insurance];
    c.jobs++;
    if (isCompleted(j)) c.approved++;
    if (isDead(j)) c.dead++;
  }
  if (j.salesRep) {
    if (!e._reps[j.salesRep]) e._reps[j.salesRep] = { name: j.salesRep, jobs: 0, approved: 0 };
    e._reps[j.salesRep].jobs++;
    if (isCompleted(j)) e._reps[j.salesRep].approved++;
  }
  if (j.adjusterName && INS_TYPES.has(j.jobType)) {
    if (!e._adjusters[j.adjusterName]) e._adjusters[j.adjusterName] = { name: j.adjusterName, jobs: 0, approved: 0 };
    e._adjusters[j.adjusterName].jobs++;
    if (isCompleted(j)) e._adjusters[j.adjusterName].approved++;
  }
}
const zipOut = Object.values(zips).filter((z) => z._jobs.length >= MIN_N).map((z) => {
  const ins = z._jobs.filter((j) => INS_TYPES.has(j.jobType));
  const approved = ins.filter(isCompleted).length;
  const dead = ins.filter(isDead).length;
  const deductibles = ins.map((j) => j.deductible).filter((v) => v && v <= 50000);
  const topCarriers = Object.values(z._carriers)
    .map((c) => ({ ...c, approvalRate: pct(c.approved, c.jobs - c.dead) }))
    .sort((a, b) => b.jobs - a.jobs).slice(0, 8);
  const topReps = Object.values(z._reps).sort((a, b) => b.jobs - a.jobs).slice(0, 5);
  const topAdjusters = Object.values(z._adjusters).filter((a) => a.jobs >= 2)
    .map((a) => ({ ...a, approvalRate: a.jobs > 0 ? a.approved / a.jobs : 0 }))
    .sort((a, b) => b.jobs - a.jobs).slice(0, 8);
  return {
    zip: z.zip, city: z.city,
    insJobs: ins.length, insApproved: approved, insDead: dead,
    insApprovalRate: pct(approved, ins.length - dead),
    dominantCarrier: topCarriers[0]?.name || null,
    medianDeductible: median(deductibles),
    topCarriers, topReps, topAdjusters,
  };
}).sort((a, b) => b.insJobs - a.insJobs);

console.log(`Built ${zipOut.length} zip cheat sheets`);

// ===== OUTPUT =====
const out = {
  generated: new Date().toISOString(),
  team: {
    insSigned: insSignedTeam.length,
    insApprovalRate: teamBaselineApproval,
    medianDaysLossToSign: teamMedianDaysLossToSign,
    medianDaysSignToComplete: teamMedianDaysSignToComplete,
    minN: MIN_N,
  },
  reps: repCheats,
  carriers: carrierCheats,
  adjusters: adjusterCheats,
  states: stateOut,
  zips: zipOut,
};

fs.writeFileSync(OUT, JSON.stringify(out));
const mb = (fs.statSync(OUT).size / 1024 / 1024).toFixed(2);
console.log(`\nWrote ${OUT} — ${mb} MB`);
console.log(`  ${repCheats.length} reps, ${carrierCheats.length} carriers, ${adjusterCheats.length} adjusters, ${stateOut.length} states, ${zipOut.length} zips`);
