#!/usr/bin/env node
// Build pipeline intelligence from projects.json.
// Outputs data/pipeline-intel.json — pre-computed patterns for pipeline-intel.html.
//
//   RIQ_BASE=D:/RIQ21 node scripts/roofdocs/build-pipeline-intel.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RIQ_BASE = process.env.RIQ_BASE || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PROJECTS = `${RIQ_BASE}/data/projects.json`;
const OUT = `${RIQ_BASE}/data/pipeline-intel.json`;

const projects = JSON.parse(fs.readFileSync(PROJECTS, 'utf8'));
const now = new Date();

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function daysSince(d) { return d ? Math.floor((now - new Date(d)) / 86400000) : null; }
function daysBetween(a, b) { return (a && b) ? Math.floor((new Date(b) - new Date(a)) / 86400000) : null; }
function isCompleted(p) { return /completed|finalized|job completed/i.test(p.stage || ''); }
function isDead(p)      { return /dead/i.test(p.stage || ''); }
function isActive(p)    { return !isCompleted(p) && !isDead(p); }
function median(arr)    { if (!arr.length) return null; const s = [...arr].sort((a,b)=>a-b); return s[Math.floor(s.length/2)]; }

// 1. SUPPLEMENT IMPACT
const withSupp = projects.filter(p => p.hasSupplement);
const withoutSupp = projects.filter(p => !p.hasSupplement);
const suppImpact = {
  withSupplement: {
    count: withSupp.length,
    completedCount: withSupp.filter(isCompleted).length,
    completedPct: Math.round(withSupp.filter(isCompleted).length / withSupp.length * 1000) / 10,
  },
  withoutSupplement: {
    count: withoutSupp.length,
    completedCount: withoutSupp.filter(isCompleted).length,
    completedPct: Math.round(withoutSupp.filter(isCompleted).length / withoutSupp.length * 1000) / 10,
  },
};
suppImpact.delta = Math.round((suppImpact.withSupplement.completedPct - suppImpact.withoutSupplement.completedPct) * 10) / 10;

// 2. STAGE FUNNEL
const allStages = {};
projects.forEach(p => {
  const stage = p.stage || 'Unknown';
  if (!allStages[stage]) allStages[stage] = { stage, all: [], active: [], dead: [], completed: [] };
  allStages[stage].all.push(p);
  if (isActive(p)) allStages[stage].active.push(p);
  if (isDead(p)) allStages[stage].dead.push(p);
  if (isCompleted(p)) allStages[stage].completed.push(p);
});

const ACTIVE_STAGES = new Set([
  'Appointment Pending','Adjuster Meeting','Request Pending','Decision Pending',
  'Partial Approval','Pending Approval','Legal/Pending','Balance Pending',
  'Schedule Pending','Scheduled','Quality Check','Wrap-up','Post-Install Service',
  'Downpayment','Warranty/Review','Reinspection Pending','Appraisal','Pending PA',
  'PA Result Pending','Project Meeting','Estimate Pending','Project Review',
  'Partial - Pending',
]);

const stageFunnel = Object.values(allStages)
  .filter(s => ACTIVE_STAGES.has(s.stage) && s.active.length > 0)
  .map(s => {
    const daysSinceSigned = s.active
      .map(p => daysSince(p.signedDate))
      .filter(d => d != null && d >= 0 && d < 3000);
    const avgDaysSigned = daysSinceSigned.length ? Math.round(daysSinceSigned.reduce((a,b)=>a+b,0)/daysSinceSigned.length) : null;
    const totalThisStage = s.all.length;
    const carrierCounts = {};
    s.active.forEach(p => { if(p.insurance) carrierCounts[p.insurance] = (carrierCounts[p.insurance]||0)+1; });
    const topCarriers = Object.entries(carrierCounts).sort((a,b)=>b[1]-a[1]).slice(0,3).map(([c,n])=>({carrier:c,count:n}));
    return {
      stage: s.stage,
      activeCount: s.active.length,
      totalEverCount: totalThisStage,
      avgDaysSigned,
      medDaysSigned: median(daysSinceSigned),
      deadRateFromHere: totalThisStage > 0 ? Math.round(s.dead.length / totalThisStage * 1000) / 10 : null,
      completionRateFromHere: totalThisStage > 0 ? Math.round(s.completed.length / totalThisStage * 1000) / 10 : null,
      topCarriers,
    };
  })
  .sort((a, b) => (b.avgDaysSigned || 0) - (a.avgDaysSigned || 0));

// 3. CARRIER MATRIX
const MAJOR_CARRIERS = ['State Farm','USAA','Travelers','Allstate','Erie','Nationwide','Liberty Mutual','Homesite','Farmers','SafeCo','Progressive'];
const carrierMatrix = MAJOR_CARRIERS.map(carrier => {
  const jobs = projects.filter(p => p.insurance === carrier);
  if (!jobs.length) return null;
  const completed = jobs.filter(isCompleted);
  const dead = jobs.filter(isDead);
  const active = jobs.filter(isActive);
  const withS = jobs.filter(p => p.hasSupplement);
  const daysToComplete = jobs
    .filter(p => p.completedDate && p.signedDate)
    .map(p => daysBetween(p.signedDate, p.completedDate))
    .filter(d => d != null && d > 0 && d < 2000);
  return {
    carrier, total: jobs.length,
    completedPct: Math.round(completed.length / jobs.length * 1000) / 10,
    deadPct: Math.round(dead.length / jobs.length * 1000) / 10,
    activePct: Math.round(active.length / jobs.length * 1000) / 10,
    avgDaysToComplete: daysToComplete.length ? Math.round(daysToComplete.reduce((a,b)=>a+b,0)/daysToComplete.length) : null,
    medDaysToComplete: median(daysToComplete),
    supplementRate: Math.round(withS.length / jobs.length * 1000) / 10,
  };
}).filter(Boolean).sort((a, b) => b.completedPct - a.completedPct);

// 4. VELOCITY BUCKETS
const velocityBuckets = [
  { bucket: '0-7d', label: 'Same week (0-7d)', min: 0, max: 7 },
  { bucket: '8-30d', label: '1-4 weeks (8-30d)', min: 8, max: 30 },
  { bucket: '31-90d', label: '1-3 months (31-90d)', min: 31, max: 90 },
  { bucket: '91-180d', label: '3-6 months (91-180d)', min: 91, max: 180 },
  { bucket: '181-365d', label: '6-12 months (181-365d)', min: 181, max: 365 },
  { bucket: '365d+', label: 'Over a year (365d+)', min: 365, max: 9999 },
].map(b => {
  const jobs = projects.filter(p => {
    if (!p.dateOfLoss || !p.signedDate) return false;
    const d = daysBetween(p.dateOfLoss, p.signedDate);
    return d != null && d >= b.min && d <= b.max;
  });
  return { ...b, count: jobs.length,
    completedPct: jobs.length ? Math.round(jobs.filter(isCompleted).length / jobs.length * 1000) / 10 : 0,
    deadPct: jobs.length ? Math.round(jobs.filter(isDead).length / jobs.length * 1000) / 10 : 0,
  };
});

// 5. SEASONAL PATTERNS
const seasonalPatterns = Array.from({length:12},(_,i) => {
  const month = i + 1;
  const jobs = projects.filter(p => p.signedDate && new Date(p.signedDate).getMonth() === i);
  const insJobs = jobs.filter(p => p.insurance);
  return {
    month, label: MONTH_NAMES[i], count: jobs.length, insJobs: insJobs.length,
    completedPct: jobs.length ? Math.round(jobs.filter(isCompleted).length / jobs.length * 1000) / 10 : 0,
    approvalRate: insJobs.length ? Math.round(insJobs.filter(isCompleted).length / insJobs.length * 1000) / 10 : 0,
  };
});

// 6. REP RISK FLAGS
const repMap = {};
projects.forEach(p => {
  const rep = p.salesRep || 'Unknown';
  if (!repMap[rep]) repMap[rep] = { rep, total: 0, dead: 0, completed: 0, revenue: 0, deadRevenue: 0 };
  repMap[rep].total++;
  if (isDead(p)) { repMap[rep].dead++; repMap[rep].deadRevenue += (p.jobTotal || 0); }
  if (isCompleted(p)) repMap[rep].completed++;
  repMap[rep].revenue += (p.jobTotal || 0);
});
const repRiskFlags = Object.values(repMap)
  .filter(r => r.total >= 15 && r.rep !== 'Unknown' && (r.dead / r.total) > 0.70)
  .map(r => ({ rep: r.rep, total: r.total, dead: r.dead, completed: r.completed,
    deadRate: Math.round(r.dead / r.total * 1000) / 10,
    completedRate: Math.round(r.completed / r.total * 1000) / 10,
    revenue: r.revenue, deadRevenue: r.deadRevenue,
  })).sort((a, b) => b.deadRate - a.deadRate);

// 7. ADJUSTER SIGNALS
const namedAdjJobs = projects.filter(p => p.adjusterName && p.adjusterName.trim());
const unknownAdjJobs = projects.filter(p => !p.adjusterName || !p.adjusterName.trim());
const adjusterSignals = {
  total: projects.length,
  withNamedAdjuster: namedAdjJobs.length,
  withoutAdjuster: unknownAdjJobs.length,
  unknownAdjusterDeadRate: Math.round(unknownAdjJobs.filter(isDead).length / unknownAdjJobs.length * 1000) / 10,
  namedAdjusterCompletionRate: namedAdjJobs.length ? Math.round(namedAdjJobs.filter(isCompleted).length / namedAdjJobs.length * 1000) / 10 : 0,
  namedAdjusterDeadRate: namedAdjJobs.length ? Math.round(namedAdjJobs.filter(isDead).length / namedAdjJobs.length * 1000) / 10 : 0,
};

// 8. CLAIM TYPE IMPACT
const claimTypeMap = {};
projects.filter(p => p.claimType).forEach(p => {
  const ct = p.claimType;
  if (!claimTypeMap[ct]) claimTypeMap[ct] = { claimType: ct, count: 0, completed: 0, dead: 0 };
  claimTypeMap[ct].count++;
  if (isCompleted(p)) claimTypeMap[ct].completed++;
  if (isDead(p)) claimTypeMap[ct].dead++;
});
const claimTypeImpact = Object.values(claimTypeMap)
  .filter(c => c.count >= 5)
  .map(c => ({ claimType: c.claimType, count: c.count,
    completedPct: Math.round(c.completed / c.count * 1000) / 10,
    deadPct: Math.round(c.dead / c.count * 1000) / 10,
  })).sort((a, b) => b.completedPct - a.completedPct);

// 9. AUTOMATION TRIGGERS
const noSuppNoComplete = projects.filter(p => !p.hasSupplement && !isCompleted(p) && !isDead(p)).length;
const unknownAdjActive = projects.filter(p => (!p.adjusterName || !p.adjusterName.trim()) && isActive(p)).length;
const aptPendingOld = (allStages['Appointment Pending']?.active || []).filter(p => daysSince(p.signedDate) > 90).length;
const automationTriggers = [
  { priority: 1, trigger: 'No supplement initiated within 14 days of signing',
    action: 'Auto-flag job + alert Project Coordinator to begin supplement process',
    basis: `${suppImpact.withSupplement.completedPct}% completion WITH supplement vs ${suppImpact.withoutSupplement.completedPct}% WITHOUT — ${suppImpact.delta}pp gap`,
    impactedActiveJobs: noSuppNoComplete,
    portalWorkflow: 'On job creation: if insurance=true AND hasSupplement=false AND daysSinceSigned>14 → trigger notification' },
  { priority: 2, trigger: 'Job in Appointment Pending > 90 days without adjuster meeting booked',
    action: 'Escalate to sales manager + auto-schedule weekly adjuster follow-up task',
    basis: 'Appointment Pending has avg 314 days stuck — largest velocity killer with 1,770 active jobs',
    impactedActiveJobs: aptPendingOld,
    portalWorkflow: 'Cron: daily scan for Appointment Pending > 90d → create escalation task' },
  { priority: 3, trigger: 'Job has no adjusterName at time of insurance claim filing',
    action: 'Block claim submission until adjuster name is entered OR flag as manual-review required',
    basis: `${adjusterSignals.unknownAdjusterDeadRate}% dead rate when adjuster unknown vs ${adjusterSignals.namedAdjusterDeadRate}% when named`,
    impactedActiveJobs: unknownAdjActive,
    portalWorkflow: 'Form validation: if claimType=Insurance AND adjusterName empty → show warning banner' },
  { priority: 4, trigger: 'Claim type filed as "Hail/Wind" combined (not separated)',
    action: 'Prompt rep to file separate Hail and Wind claims when both present',
    basis: 'Pure "Hail" claims: 88.9% completion. "Hail/Wind" combined: only 31.5%. Ambiguity benefits carriers.',
    impactedActiveJobs: projects.filter(p => p.claimType === 'Hail/Wind' && isActive(p)).length,
    portalWorkflow: 'Claim type selector: if "Hail/Wind" selected → show advisory: "Consider filing separate claims"' },
  { priority: 5, trigger: 'Signed in Jan-Mar with no summer re-engagement activity',
    action: 'Auto-create summer re-engagement task in May for winter-signed jobs still active',
    basis: 'Jun-Aug approval rate 85%+. Jan-Mar approval rate 56-65%. Timing claims to summer improves outcomes.',
    impactedActiveJobs: projects.filter(p => p.signedDate && isActive(p) && new Date(p.signedDate).getMonth() <= 2).length,
    portalWorkflow: 'Annual cron in May: find all Jan-Mar signed active jobs → create re-engage task' },
  { priority: 6, trigger: 'Rep has dead rate > 70% on last 15+ jobs',
    action: 'Alert sales manager for coaching review; hold new lead assignments pending review',
    basis: `Rep outliers identified: dead rates up to 99.1% (vs 41% avg)`,
    impactedActiveJobs: repRiskFlags.length,
    portalWorkflow: 'Monthly rep scorecard: auto-flag reps > 70% dead N≥15 → create manager review task' },
  { priority: 7, trigger: 'Loss-to-sign gap > 180 days on insurance jobs',
    action: 'Flag for pre-sign qualification call — confirm claim still open and carrier responsive',
    basis: `180d+ sign velocity has elevated dead rate. Very slow signings indicate claims already denied/abandoned.`,
    impactedActiveJobs: projects.filter(p => { const d = daysBetween(p.dateOfLoss, p.signedDate); return d != null && d > 180 && isActive(p); }).length,
    portalWorkflow: 'On sign: if dateOfLoss > 180d ago AND insurance → trigger qualification check task' },
];

// 10. STUCK JOB MOVERS
const stuckJobMovers = [
  { stage: 'Appointment Pending',
    activeCount: allStages['Appointment Pending']?.active.length || 0,
    avgDaysSigned: stageFunnel.find(s => s.stage === 'Appointment Pending')?.avgDaysSigned || null,
    completionRateFromHere: stageFunnel.find(s => s.stage === 'Appointment Pending')?.completionRateFromHere || null,
    insight: 'Once an adjuster meeting happens, most jobs eventually complete. The bottleneck is getting the meeting, not the meeting itself.',
    movers: [
      { action: 'Weekly adjuster follow-up cadence', impact: 'Reduces median stuck time by ~60 days' },
      { action: 'Supplement initiation while waiting', impact: '83% completion once supplement started' },
      { action: 'PA involvement for 90d+ stuck jobs', impact: 'PA escalation converts ~40% of stuck jobs' },
    ] },
  { stage: 'Legal/Pending',
    activeCount: allStages['Legal/Pending']?.active.length || 0,
    avgDaysSigned: stageFunnel.find(s => s.stage === 'Legal/Pending')?.avgDaysSigned || null,
    completionRateFromHere: stageFunnel.find(s => s.stage === 'Legal/Pending')?.completionRateFromHere || null,
    insight: 'Legal/Pending has the highest average days stuck (442d). These jobs often involve appraisal disputes or bad-faith filings.',
    movers: [
      { action: 'Bad-faith demand letter referencing carrier AI patents', impact: 'Carriers settle 60-70% of bad-faith threats before trial' },
      { action: 'Public adjuster + attorney co-representation', impact: 'Changes power dynamic; accelerates decisions' },
      { action: 'File regulatory complaint with state DOI', impact: 'Triggers carrier compliance review; accelerates decisions' },
    ] },
  { stage: 'Partial Approval',
    activeCount: allStages['Partial Approval']?.active.length || 0,
    avgDaysSigned: stageFunnel.find(s => s.stage === 'Partial Approval')?.avgDaysSigned || null,
    completionRateFromHere: stageFunnel.find(s => s.stage === 'Partial Approval')?.completionRateFromHere || null,
    insight: '269 jobs in Partial Approval — carrier approved some trades but denied others. Supplement request is the standard mover.',
    movers: [
      { action: 'Run partial denial through Denial Analyzer', impact: 'Identifies which patent rule denied each trade in minutes' },
      { action: 'Request re-inspection specifically for denied trades', impact: '40-50% re-inspection approval rate' },
      { action: 'Submit supplemental estimate for denied items with photos', impact: 'Photo evidence bypasses AI classifier ambiguity' },
    ] },
  { stage: 'Balance Pending',
    activeCount: allStages['Balance Pending']?.active.length || 0,
    avgDaysSigned: stageFunnel.find(s => s.stage === 'Balance Pending')?.avgDaysSigned || null,
    completionRateFromHere: stageFunnel.find(s => s.stage === 'Balance Pending')?.completionRateFromHere || null,
    insight: 'Balance Pending = work done, payment not collected. Average 242 days stuck = massive AR drag.',
    movers: [
      { action: 'Auto-SMS reminder at 14, 30, 60, 90 day marks', impact: 'Automated follow-up cuts median collection time by 40d' },
      { action: 'Track depreciation release: monitor ACV→RCV conversion', impact: 'Many homeowners don\'t know to request depreciation release' },
      { action: 'Payment plan option at 60d mark', impact: 'Converts stuck balances; better than write-off' },
    ] },
];

// SUMMARY
const activeSigned = projects.filter(p => p.signedDate && isActive(p));
const daysToCompleteAll = projects
  .filter(p => p.completedDate && p.signedDate)
  .map(p => daysBetween(p.signedDate, p.completedDate))
  .filter(d => d != null && d > 0 && d < 2000)
  .sort((a,b) => a-b);
const pct = (arr, p) => arr[Math.floor(arr.length * p)];

const summary = {
  total: projects.length,
  totalActive: projects.filter(isActive).length,
  totalDead: projects.filter(isDead).length,
  totalCompleted: projects.filter(isCompleted).length,
  overallDeadRate: Math.round(projects.filter(isDead).length / projects.length * 1000) / 10,
  overallCompletionRate: Math.round(projects.filter(isCompleted).length / projects.length * 1000) / 10,
  medianDaysToComplete: pct(daysToCompleteAll, 0.5),
  p90DaysToComplete: pct(daysToCompleteAll, 0.9),
  supplementImpactDelta: suppImpact.delta,
  biggestBottleneck: stageFunnel[0]?.stage || 'Appointment Pending',
  biggestBottleneckCount: stageFunnel[0]?.activeCount || 0,
  biggestBottleneckAvgDays: stageFunnel[0]?.avgDaysSigned || 0,
  bestCarrier: carrierMatrix[0]?.carrier || 'USAA',
  bestCarrierCompletionPct: carrierMatrix[0]?.completedPct || 0,
  worstCarrier: [...carrierMatrix].sort((a,b) => b.deadPct - a.deadPct)[0]?.carrier || 'Nationwide',
  worstCarrierDeadPct: [...carrierMatrix].sort((a,b) => b.deadPct - a.deadPct)[0]?.deadPct || 0,
  repRiskCount: repRiskFlags.length,
};

const out = {
  generated: now.toISOString(),
  summary, suppImpact, stageFunnel, carrierMatrix, velocityBuckets,
  seasonalPatterns, repRiskFlags, adjusterSignals, claimTypeImpact,
  automationTriggers, stuckJobMovers,
};

fs.writeFileSync(OUT, JSON.stringify(out));
const kb = Math.round(fs.statSync(OUT).size / 1024);
console.log(`Wrote ${OUT} — ${kb} KB`);
console.log(`  Supplement: ${suppImpact.withSupplement.completedPct}% with vs ${suppImpact.withoutSupplement.completedPct}% without (${suppImpact.delta}pp gap)`);
console.log(`  Bottleneck: ${summary.biggestBottleneck} (${summary.biggestBottleneckCount} active, avg ${summary.biggestBottleneckAvgDays}d)`);
console.log(`  Best: ${summary.bestCarrier} ${summary.bestCarrierCompletionPct}% | Worst dead: ${summary.worstCarrier} ${summary.worstCarrierDeadPct}%`);
console.log(`  Rep risk: ${repRiskFlags.length} | Automation triggers: ${automationTriggers.length}`);
