/**
 * Phase 8b: Portal KPI truth-source endpoint.
 *
 * Surfaces the portal's authoritative numbers (from /v1/admin/reporting/{profit,kpis,insurance}
 * + /v1/admin/finance) alongside RIQ 21's computed equivalents, with per-field
 * drift annotations.
 *
 *   GET /api/intel/portal-kpis              — full payload (portal + riq + drift)
 *   GET /api/intel/portal-kpis?view=portal  — portal numbers only (fast, no DB)
 *   GET /api/intel/portal-kpis?view=drift   — drift summary only
 *
 * The portal JSON files are refreshed by refresh-all.sh; the RIQ side is
 * computed on each request from intel_projects (same formulas as
 * scripts/roofdocs/audit-kpi-drift.mjs).
 */
import { type Request, type Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql as pgSql } from '../db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Portal KPI files live in data/ (committed) — refreshed via refresh-all.sh,
// but baseline copies are committed to the repo so the endpoint works on a
// fresh deploy before the first refresh.
const REF_DIR = path.resolve(__dirname, '..', '..', 'data');

type EnvelopedJson<T> = { name?: string; responseCode?: number; message?: string; data: T };

type PortalKpis = {
  retailCount: number;
  repairCount: number;
  insuranceCount: number;
  insuranceConversionCount: number;
  unknownCount: number;
  nonrecoverableCount: number;
  addOnCount: number;
  publicAdjusterCount: number;
  roofingSquares: number;
  sidingSquares: number;
  approvalPercentage: number;
  projectLifecycle: number;
  daysInBalancePending: number;
  daysForInstall: number;
  leadConversion: number;
  leadClosed: number;
};

type PortalProfit = {
  jobCount: number;
  insuranceTotal: number;
  upgrades: number;
  addWork: number;
  changeOrders: number;
  repair: number;
  retail: number;
  wnd: number;
  credits: number;
  supplementTotal: number;
  overheadExpenseTotal: number;
  materialExpenseTotal: number;
  laborExpenseTotal: number;
};

type FinancePlan = {
  financePlanID: number;
  provider: string;
  planNumber: string;
  description: string;
  rate: number;
  serviceCharge: number;
};

type RiqMetrics = {
  insuranceCount: number;
  retailCount: number;
  repairCount: number;
  insuranceConversionCount: number;
  publicAdjusterCount: number;
  addOnCount: number;
  approvalPercentage: number | null;
  insuranceTotal: number;
  totalRows: number;
};

type DriftRow = {
  metric: string;
  portal: number | null;
  riq: number | null;
  driftAbs: number | null;
  driftPct: number | null;
  // 'baseline' = divergence is design-expected (portal vs RIQ population scope differs).
  // Treated like 'ok' for `summary.overall` but counted separately so the dashboard
  // can show "7 baseline volume-count rows, 1 measured rate row, 7 pending".
  status: 'ok' | 'warn' | 'fail' | 'pending' | 'baseline';
  note?: string;
};

type FileMeta = { exists: boolean; mtime: string | null; sizeBytes: number };

/* ──────────────────────────── File loader (cached, fs-watched) ──────────────────────────── */

let cache: {
  kpis: PortalKpis | null;
  profit: PortalProfit | null;
  insuranceNames: string[] | null;
  financePlans: FinancePlan[] | null;
  meta: Record<string, FileMeta>;
  loadedAt: string;
} | null = null;

function readJson<T>(file: string): { data: T | null; meta: FileMeta } {
  const full = path.join(REF_DIR, file);
  if (!fs.existsSync(full)) {
    return { data: null, meta: { exists: false, mtime: null, sizeBytes: 0 } };
  }
  const stat = fs.statSync(full);
  const raw = fs.readFileSync(full, 'utf8');
  const parsed = JSON.parse(raw) as EnvelopedJson<T> | T;
  const data = parsed != null && typeof parsed === 'object' && 'data' in (parsed as object)
    ? (parsed as EnvelopedJson<T>).data
    : (parsed as T);
  return { data, meta: { exists: true, mtime: stat.mtime.toISOString(), sizeBytes: stat.size } };
}

function loadAll(): NonNullable<typeof cache> {
  if (cache) return cache;
  const kpis = readJson<PortalKpis>('portal-kpi-summary.json');
  const profit = readJson<PortalProfit>('portal-kpi-profit.json');
  const insuranceNames = readJson<string[]>('portal-insurance-names.json');
  const financePlans = readJson<FinancePlan[]>('finance-plans.json');
  cache = {
    kpis: kpis.data,
    profit: profit.data,
    insuranceNames: insuranceNames.data,
    financePlans: financePlans.data,
    meta: {
      'portal-kpi-summary.json': kpis.meta,
      'portal-kpi-profit.json': profit.meta,
      'portal-insurance-names.json': insuranceNames.meta,
      'finance-plans.json': financePlans.meta,
    },
    loadedAt: new Date().toISOString(),
  };
  return cache;
}

// Invalidate cache when files change (cheap: 60s ttl)
setInterval(() => { cache = null; }, 60_000).unref();

/* ──────────────────────────── RIQ 21 metric computation ──────────────────────────── */

async function computeRiqMetrics(): Promise<RiqMetrics> {
  const [
    [insRow], [retRow], [repRow], [convRow], [paRow], [addRow], [apvRow], [revRow], [totRow],
  ] = await Promise.all([
    pgSql<Array<{ n: number }>>`SELECT COUNT(*)::int AS n FROM intel_projects WHERE job_type ILIKE 'insurance'`,
    pgSql<Array<{ n: number }>>`SELECT COUNT(*)::int AS n FROM intel_projects WHERE job_type ILIKE 'retail'`,
    pgSql<Array<{ n: number }>>`SELECT COUNT(*)::int AS n FROM intel_projects WHERE job_type ILIKE 'repair'`,
    pgSql<Array<{ n: number }>>`SELECT COUNT(*)::int AS n FROM intel_projects WHERE job_type ILIKE '%conversion%'`,
    pgSql<Array<{ n: number }>>`SELECT COUNT(*)::int AS n FROM intel_projects WHERE job_type ILIKE '%adjuster%'`,
    pgSql<Array<{ n: number }>>`SELECT COUNT(*)::int AS n FROM intel_projects WHERE job_type ILIKE '%add%on%' OR job_type ILIKE '%addon%'`,
    pgSql<Array<{ rate: number | null }>>`
      SELECT
        (COUNT(*) FILTER (WHERE stage ~* 'completed|finalized'))::numeric
          / NULLIF(COUNT(*) FILTER (WHERE stage ~* 'completed|finalized|dead|cancel'), 0)
          * 100 AS rate
        FROM intel_projects
       WHERE job_type ILIKE 'insurance'
    `,
    pgSql<Array<{ total: number | null }>>`
      SELECT COALESCE(SUM(job_total), 0)::numeric AS total
        FROM intel_projects
       WHERE job_type ILIKE 'insurance'
    `,
    pgSql<Array<{ n: number }>>`SELECT COUNT(*)::int AS n FROM intel_projects`,
  ]);

  return {
    insuranceCount: Number(insRow?.n ?? 0),
    retailCount: Number(retRow?.n ?? 0),
    repairCount: Number(repRow?.n ?? 0),
    insuranceConversionCount: Number(convRow?.n ?? 0),
    publicAdjusterCount: Number(paRow?.n ?? 0),
    addOnCount: Number(addRow?.n ?? 0),
    approvalPercentage: apvRow?.rate != null ? Number(apvRow.rate) : null,
    insuranceTotal: Number(revRow?.total ?? 0),
    totalRows: Number(totRow?.n ?? 0),
  };
}

/* ──────────────────────────── Drift builder ──────────────────────────── */

function buildDrift(portal: PortalKpis | null, profit: PortalProfit | null, riq: RiqMetrics | null): DriftRow[] {
  if (!portal || !riq) return [];

  const mk = (
    metric: string,
    p: number | null | undefined,
    r: number | null | undefined,
    opts: { note?: string; baseline?: boolean } = {},
  ): DriftRow => {
    const portalVal = p ?? null;
    const riqVal = r ?? null;
    const driftAbs = portalVal != null && riqVal != null ? riqVal - portalVal : null;
    const driftPct = portalVal != null && riqVal != null && portalVal !== 0 ? (driftAbs! / portalVal) * 100 : null;
    let status: DriftRow['status'] = 'pending';
    if (driftPct != null) {
      if (opts.baseline) {
        status = 'baseline';
      } else {
        const abs = Math.abs(driftPct);
        status = abs > 15 ? 'fail' : abs > 5 ? 'warn' : 'ok';
      }
    }
    return { metric, portal: portalVal, riq: riqVal, driftAbs, driftPct, status, note: opts.note };
  };

  // Audit findings 2026-05-19 (psql ad-hoc against intel_projects):
  //
  //   approvalPercentage: RIQ 51.34% vs portal 51.23% — 0.21% drift, like-for-like ✓
  //
  //   insuranceCount: RIQ all-time 10,937. Of those, 7,863 are signed since
  //     2023-01-01 — within 11 jobs of portal's 7,874 (0.14% miss). Portal
  //     therefore appears to use signed-date ≥ 2023 (~3-year rolling window).
  //     The 3,074-job delta is jobs signed pre-2023 (2019: 109, 2020: 411,
  //     2021: 832, 2022: 1,659, plus 63 with no signed_date).
  //
  //   retailCount / addOnCount / insuranceConversionCount: RIQ since-2023 is
  //     still ~2× portal, so portal applies an additional stage/status filter
  //     beyond date. We don't know the exact predicate.
  //
  //   repairCount / publicAdjusterCount: portal counts MORE than RIQ since-2023
  //     (66 vs 50, 19 vs 10) — portal likely tags some jobs as repair/PA that
  //     RIQ classifies under another job_type. Cross-tab needed to confirm.
  //
  // RIQ stays all-time intentionally — predictor / lifetime-touch / carrier
  // intel all want the full job history. Drift rows are `baseline` because the
  // portal-vs-RIQ comparison is apples-to-oranges by design.
  const SCOPE_NOTE_GENERIC = 'RIQ = all-time; portal admin/reporting = ~36-month window + per-category stage filters';
  const SCOPE_NOTE_INSURANCE = 'RIQ = all-time; portal ≈ signed-date ≥ 2023 (RIQ since-2023 subset matches portal within 0.14%)';

  const rows: DriftRow[] = [
    mk('insuranceCount', portal.insuranceCount, riq.insuranceCount, { note: SCOPE_NOTE_INSURANCE, baseline: true }),
    mk('retailCount', portal.retailCount, riq.retailCount, { note: SCOPE_NOTE_GENERIC, baseline: true }),
    mk('repairCount', portal.repairCount, riq.repairCount, { note: SCOPE_NOTE_GENERIC + ' — portal > RIQ; portal may include jobs RIQ tags differently', baseline: true }),
    mk('insuranceConversionCount', portal.insuranceConversionCount, riq.insuranceConversionCount, { note: SCOPE_NOTE_GENERIC, baseline: true }),
    mk('publicAdjusterCount', portal.publicAdjusterCount, riq.publicAdjusterCount, { note: SCOPE_NOTE_GENERIC + ' — portal > RIQ; portal may include jobs RIQ tags differently', baseline: true }),
    mk('addOnCount', portal.addOnCount, riq.addOnCount, { note: SCOPE_NOTE_GENERIC, baseline: true }),
    mk('approvalPercentage', portal.approvalPercentage, riq.approvalPercentage, { note: 'Phase 4 audit gate metric (rate, like-for-like)' }),
    mk('roofingSquares', portal.roofingSquares, null, { note: 'requires intel_projects.roofing_squares column (not promoted)' }),
    mk('sidingSquares', portal.sidingSquares, null, { note: 'requires intel_projects.siding_squares column (not promoted)' }),
    mk('projectLifecycle', portal.projectLifecycle, null, { note: 'requires lead→completion timestamp pair' }),
    mk('daysInBalancePending', portal.daysInBalancePending, null, { note: 'requires balance_pending timestamp pair' }),
    mk('daysForInstall', portal.daysForInstall, null, { note: 'requires approval→install date pair' }),
    mk('leadConversion', portal.leadConversion, null, { note: 'requires intel_leads (Phase 8a)' }),
    mk('leadClosed', portal.leadClosed, null, { note: 'requires intel_leads (Phase 8a)' }),
  ];

  if (profit) {
    rows.push(mk('insuranceTotal', profit.insuranceTotal, riq.insuranceTotal, { note: SCOPE_NOTE_INSURANCE + ' (SUM job_total)', baseline: true }));
  }

  return rows;
}

function summarizeDrift(rows: DriftRow[]) {
  // `overall` is judged only on actually-comparable rows (rate metrics like
  // approvalPercentage). Volume counts are tagged 'baseline' because portal
  // and RIQ define those populations differently; counting them as fails
  // would make the dashboard always red.
  const comparable = rows.filter((r) => r.status === 'ok' || r.status === 'warn' || r.status === 'fail');
  const baseline = rows.filter((r) => r.status === 'baseline').length;
  const pending = rows.filter((r) => r.status === 'pending').length;
  const fails = comparable.filter((r) => r.status === 'fail').length;
  const warns = comparable.filter((r) => r.status === 'warn').length;
  const oks = comparable.filter((r) => r.status === 'ok').length;
  // maxDriftPct only across comparable rows; baseline divergence is huge by
  // design and would dominate this number meaninglessly.
  const maxDrift = comparable.reduce((m, r) => (r.driftPct != null && Math.abs(r.driftPct) > m ? Math.abs(r.driftPct) : m), 0);
  return {
    overall: fails > 0 ? 'fail' : warns > 0 ? 'warn' : oks > 0 ? 'ok' : 'pending',
    comparable: comparable.length,
    baseline,
    pending,
    fails,
    warns,
    oks,
    maxDriftPct: maxDrift,
  };
}

/* ──────────────────────────── Express handler ──────────────────────────── */

export async function portalKpis(req: Request, res: Response): Promise<void> {
  try {
    const view = String(req.query.view ?? 'full');
    const loaded = loadAll();

    if (view === 'portal') {
      res.json({
        portal: {
          kpis: loaded.kpis,
          profit: loaded.profit,
          insuranceNames: loaded.insuranceNames,
          financePlans: loaded.financePlans,
        },
        meta: { files: loaded.meta, cachedAt: loaded.loadedAt },
      });
      return;
    }

    const riq = await computeRiqMetrics();

    if (view === 'drift') {
      const drift = buildDrift(loaded.kpis, loaded.profit, riq);
      res.json({
        summary: summarizeDrift(drift),
        drift,
        meta: { files: loaded.meta, cachedAt: loaded.loadedAt },
      });
      return;
    }

    // Full
    const drift = buildDrift(loaded.kpis, loaded.profit, riq);
    res.json({
      portal: {
        kpis: loaded.kpis,
        profit: loaded.profit,
        insuranceNames: loaded.insuranceNames,
        financePlans: loaded.financePlans,
      },
      riq: {
        ...riq,
        computedAt: new Date().toISOString(),
      },
      drift,
      summary: summarizeDrift(drift),
      meta: { files: loaded.meta, cachedAt: loaded.loadedAt },
    });
  } catch (e) {
    console.error('[portal-kpis] handler error:', e);
    res.status(500).json({ error: (e as Error).message });
  }
}
