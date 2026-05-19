#!/usr/bin/env node
// Phase 8b: KPI drift auditor.
//
// Computes RIQ 21's version of each portal-reported KPI from intel_projects
// and diffs against the portal's authoritative numbers.
//
// Portal numbers come from data/roofdocs-reference/portal-kpi-{summary,profit}.json
// (refreshed via refresh-all.sh — pulls /v1/admin/reporting/kpis and /profit).
//
// Exit codes:
//   0 — all comparable metrics within 5% of portal
//   1 — at least one comparable metric > 5% drift (warn)
//   2 — at least one comparable metric > 15% drift (fail)
//
// Rows marked `baseline:true` are volume counts where portal and RIQ define
// the population differently (RIQ projects table is broader than the portal
// admin/reporting endpoint scope). They're reported informationally but do
// not influence the exit code.
//
//   DATABASE_URL=$RIQ_DB_PUBLIC_URL node scripts/roofdocs/audit-kpi-drift.mjs

import postgres from 'postgres';
import fs from 'node:fs';

const RIQ_BASE = process.env.RIQ_BASE || '/Users/a21/storm-maps';
const PORTAL_KPI_FILE = `${RIQ_BASE}/data/portal-kpi-summary.json`;
const PORTAL_PROFIT_FILE = `${RIQ_BASE}/data/portal-kpi-profit.json`;

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL is required (use DATABASE_PUBLIC_URL from Railway)');
  process.exit(3);
}

if (!fs.existsSync(PORTAL_KPI_FILE)) {
  console.error(`Missing ${PORTAL_KPI_FILE} — run refresh-all.sh first`);
  process.exit(3);
}

const portalKpis = JSON.parse(fs.readFileSync(PORTAL_KPI_FILE, 'utf8')).data;
const portalProfit = fs.existsSync(PORTAL_PROFIT_FILE)
  ? JSON.parse(fs.readFileSync(PORTAL_PROFIT_FILE, 'utf8')).data
  : null;

const sql = postgres(DATABASE_URL, { ssl: 'require', max: 4 });

/* ──────────────────────────── Compute RIQ-side metrics ──────────────────────────── */

async function computeRiq() {
  // Job type counts
  const [{ insurance_count }] = await sql`
    SELECT COUNT(*)::int AS insurance_count
      FROM intel_projects
     WHERE job_type ILIKE 'insurance'
  `;
  const [{ retail_count }] = await sql`
    SELECT COUNT(*)::int AS retail_count
      FROM intel_projects
     WHERE job_type ILIKE 'retail'
  `;
  const [{ repair_count }] = await sql`
    SELECT COUNT(*)::int AS repair_count
      FROM intel_projects
     WHERE job_type ILIKE 'repair'
  `;
  const [{ conversion_count }] = await sql`
    SELECT COUNT(*)::int AS conversion_count
      FROM intel_projects
     WHERE job_type ILIKE '%conversion%'
  `;
  const [{ pa_count }] = await sql`
    SELECT COUNT(*)::int AS pa_count
      FROM intel_projects
     WHERE job_type ILIKE '%adjuster%'
  `;
  const [{ addon_count }] = await sql`
    SELECT COUNT(*)::int AS addon_count
      FROM intel_projects
     WHERE job_type ILIKE '%add%on%' OR job_type ILIKE '%addon%'
  `;

  // Approval rate — completed/(completed + dead/cancelled)
  // This formula is canonical in RIQ 21 (Phase 4 audit, 2026-05-18 evening)
  const [{ approval_rate }] = await sql`
    SELECT
      (COUNT(*) FILTER (WHERE stage ~* 'completed|finalized'))::numeric
        / NULLIF(COUNT(*) FILTER (WHERE stage ~* 'completed|finalized|dead|cancel'), 0)
        * 100 AS approval_rate
      FROM intel_projects
     WHERE job_type ILIKE 'insurance'
  `;

  // Total counts for context
  const [{ total_rows }] = await sql`SELECT COUNT(*)::int AS total_rows FROM intel_projects`;

  // Profit totals — pull from intel_projects job_total / ACV breakdowns if available
  // intel_projects may not store ACV/upgrades line-by-line. Best-effort sum from projects.json blob via SUM(job_total).
  const [{ revenue_total }] = await sql`
    SELECT COALESCE(SUM(job_total), 0)::numeric AS revenue_total
      FROM intel_projects
     WHERE job_type ILIKE 'insurance'
  `;

  // projectLifecycle: signed_date → finalized_date avg, insurance only.
  // Calibrated 2026-05-19 — best match to portal's 191.15 (2.4% drift).
  // Excludes negative durations (data quality: 28 jobs platform-wide have
  // finalized_date before signed_date due to portal data quirks).
  const [{ lifecycle_avg, lifecycle_n }] = await sql`
    SELECT
      AVG(finalized_date::date - signed_date::date)::numeric AS lifecycle_avg,
      COUNT(*)::int AS lifecycle_n
      FROM intel_projects
     WHERE job_type ILIKE 'insurance'
       AND signed_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
       AND finalized_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
       AND finalized_date::date >= signed_date::date
  `;

  return {
    insurance_count: Number(insurance_count),
    retail_count: Number(retail_count),
    repair_count: Number(repair_count),
    conversion_count: Number(conversion_count),
    pa_count: Number(pa_count),
    addon_count: Number(addon_count),
    approval_rate: approval_rate != null ? Number(approval_rate) : null,
    revenue_total: Number(revenue_total),
    lifecycle_avg: lifecycle_avg != null ? Number(lifecycle_avg) : null,
    lifecycle_n: Number(lifecycle_n),
    total_rows: Number(total_rows),
  };
}

/* ──────────────────────────── Diff + emit ──────────────────────────── */

function diff(portal, riq) {
  if (portal == null || riq == null) return { abs: null, pct: null };
  const abs = riq - portal;
  const pct = portal === 0 ? null : (abs / portal) * 100;
  return { abs, pct };
}

function fmtPct(p) {
  if (p == null) return '   --';
  const s = p >= 0 ? '+' : '';
  return `${s}${p.toFixed(2)}%`;
}

function fmtNum(n) {
  if (n == null) return '--';
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
  return typeof n === 'number' ? n.toFixed(2) : String(n);
}

(async () => {
  const riq = await computeRiq();

  // Per 2026-05-19 audit:
  //   - portal insuranceCount = signed-date ≥ 2023 cut (within 0.14%)
  //   - portal projectLifecycle = signed_date → finalized_date for insurance (within 2.4%)
  //   - retail/conversion/addOn: no single rule matches portal (composite filter)
  //   - repair/PA: portal counts MORE than RIQ — categorization difference
  // RIQ stays all-time by design.
  const SCOPE_UNKNOWN = 'RIQ = all-time; portal applies internal stage/status filter that no single tested rule matches';
  const SCOPE_PORTAL_MORE = 'RIQ = all-time; portal counts MORE than any RIQ subset — portal categorizes jobs RIQ tags as other job_type';
  const SCOPE_INSURANCE = 'RIQ = all-time; portal ≈ signed-date ≥ 2023 (RIQ since-2023 subset matches within 0.14%)';
  const rows = [
    {
      metric: 'insuranceCount',
      portal: portalKpis.insuranceCount,
      riq: riq.insurance_count,
      note: SCOPE_INSURANCE,
      baseline: true,
    },
    {
      metric: 'retailCount',
      portal: portalKpis.retailCount,
      riq: riq.retail_count,
      note: SCOPE_UNKNOWN,
      baseline: true,
    },
    {
      metric: 'repairCount',
      portal: portalKpis.repairCount,
      riq: riq.repair_count,
      note: SCOPE_PORTAL_MORE,
      baseline: true,
    },
    {
      metric: 'insuranceConversionCount',
      portal: portalKpis.insuranceConversionCount,
      riq: riq.conversion_count,
      note: SCOPE_UNKNOWN,
      baseline: true,
    },
    {
      metric: 'publicAdjusterCount',
      portal: portalKpis.publicAdjusterCount,
      riq: riq.pa_count,
      note: SCOPE_PORTAL_MORE,
      baseline: true,
    },
    {
      metric: 'addOnCount',
      portal: portalKpis.addOnCount,
      riq: riq.addon_count,
      note: SCOPE_UNKNOWN,
      baseline: true,
    },
    {
      metric: 'approvalPercentage',
      portal: portalKpis.approvalPercentage,
      riq: riq.approval_rate,
      note: 'KEY METRIC — Phase 4 audit gate (rate, like-for-like)',
    },
    {
      metric: 'roofingSquares (avg)',
      portal: portalKpis.roofingSquares,
      riq: null,
      note: 'data not in intel_projects (job_type categories only; trades array is names, not measurements)',
    },
    {
      metric: 'projectLifecycle (days)',
      portal: portalKpis.projectLifecycle,
      riq: riq.lifecycle_avg,
      note: `signed_date → finalized_date avg, insurance jobs only (n=${riq.lifecycle_n.toLocaleString()})`,
    },
    {
      metric: 'daysForInstall',
      portal: portalKpis.daysForInstall,
      riq: null,
      note: 'requires stage-transition history (Schedule Pending → install date pair, not stored)',
    },
    {
      metric: 'leadConversion',
      portal: portalKpis.leadConversion,
      riq: null,
      note: 'requires intel_leads (Phase 8a)',
    },
    {
      metric: 'leadClosed',
      portal: portalKpis.leadClosed,
      riq: null,
      note: 'requires intel_leads (Phase 8a)',
    },
  ];

  if (portalProfit) {
    rows.push({
      metric: 'insuranceTotal ($)',
      portal: portalProfit.insuranceTotal,
      riq: riq.revenue_total,
      note: SCOPE_INSURANCE + ' (SUM job_total)',
      baseline: true,
    });
  }

  /* ──────────────────────────── Output ──────────────────────────── */

  // Exit code reflects only comparable rows (baseline-tagged rows excluded).
  let maxComparableDrift = 0;
  let baselineCount = 0;
  console.log('\n' + '═'.repeat(82));
  console.log('  RIQ 21 vs Portal KPI Drift Audit');
  console.log('  RIQ rows in intel_projects: ' + riq.total_rows.toLocaleString());
  console.log('═'.repeat(82));
  console.log('  ' + 'metric'.padEnd(30) + 'portal'.padStart(14) + 'riq 21'.padStart(14) + 'drift'.padStart(11));
  console.log('  ' + '-'.repeat(78));
  for (const r of rows) {
    const d = diff(r.portal, r.riq);
    const driftPct = d.pct != null ? Math.abs(d.pct) : 0;
    let tag;
    if (r.riq == null) {
      tag = '  pending';
    } else if (r.baseline) {
      tag = '  baseline';
      baselineCount++;
    } else {
      if (driftPct > maxComparableDrift) maxComparableDrift = driftPct;
      tag = driftPct > 15 ? '  FAIL' : driftPct > 5 ? '  WARN' : '  OK';
    }
    console.log(
      '  ' + r.metric.padEnd(30) +
      fmtNum(r.portal).padStart(14) +
      fmtNum(r.riq).padStart(14) +
      fmtPct(d.pct).padStart(11) +
      tag
    );
    if (r.note) console.log('  ' + ' '.repeat(28) + '↳ ' + r.note);
  }
  console.log('═'.repeat(82));

  let exitCode = 0;
  if (maxComparableDrift > 15) {
    console.log(`  RESULT: FAIL (max comparable drift ${maxComparableDrift.toFixed(1)}%, ${baselineCount} baseline rows skipped)`);
    exitCode = 2;
  } else if (maxComparableDrift > 5) {
    console.log(`  RESULT: WARN (max comparable drift ${maxComparableDrift.toFixed(1)}%, ${baselineCount} baseline rows skipped)`);
    exitCode = 1;
  } else {
    console.log(`  RESULT: OK (max comparable drift ${maxComparableDrift.toFixed(1)}%, ${baselineCount} baseline rows skipped)`);
  }
  console.log('═'.repeat(82) + '\n');

  await sql.end();
  process.exit(exitCode);
})().catch((e) => {
  console.error(e);
  process.exit(3);
});
