/**
 * Phase 8c — Operational Surveillance endpoints over intel_fixes / intel_tasks /
 * intel_punchlist (mirrored from the portal's open fixes / tasks / punch list).
 *
 *   GET /api/intel/fixes-summary       — open/closed counts, by trade, by rep, by age
 *   GET /api/intel/fixes-by-rep?rep=    — one rep's open fixes
 *   GET /api/intel/tasks-overdue        — past-due pending tasks, by rep
 *   GET /api/intel/tasks-by-rep?rep=     — one rep's pending tasks + overdue count
 *   GET /api/intel/punchlist-active     — active (incomplete) punch-list jobs
 *
 * Aggregation is done in JS after a lightweight row fetch — row counts here are in
 * the low hundreds, and computing ages/buckets in JS sidesteps the text-date
 * `::date` cast footgun that has bitten this repo before (portal dates arrive as
 * strings of unknown exact format). Empty tables return clean zeros, so these are
 * safe to ship before the data pull is wired.
 *
 * All handlers register before the /:key catch-all (see routes.ts).
 */
import { type Request, type Response } from 'express';
import { sql as pgSql } from '../db.js';

/** Portal date string (ISO or other) → whole days elapsed, or null if unparseable. */
function ageDays(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const t = Date.parse(dateStr);
  if (Number.isNaN(t)) return null;
  return Math.floor((Date.now() - t) / 86_400_000);
}

function ageBucket(days: number | null): string {
  if (days === null) return 'unknown';
  if (days <= 7) return '0-7d';
  if (days <= 30) return '8-30d';
  if (days <= 90) return '31-90d';
  return '90d+';
}

const AGE_ORDER = ['0-7d', '8-30d', '31-90d', '90d+', 'unknown'];
const byCountDesc = (a: { count: number }, b: { count: number }) => b.count - a.count;
const isPast = (dateStr: string | null): boolean => {
  if (!dateStr) return false;
  const t = Date.parse(dateStr);
  return !Number.isNaN(t) && t < Date.now();
};

/* ── /api/intel/fixes-summary ─────────────────────────────────────────────── */
interface FixRow {
  id: number;
  trade: string | null;
  completed: boolean;
  created_date: string | null;
  employee_id: number | null;
  rep: string | null;
}

export async function fixesSummary(_req: Request, res: Response) {
  const t0 = Date.now();
  try {
    const rows = await pgSql<FixRow[]>`
      SELECT id, trade, completed, created_date, employee_id,
             NULLIF(TRIM(COALESCE(data->'employee'->>'firstName', '') || ' ' ||
                         COALESCE(data->'employee'->>'lastName', '')), '') AS rep
        FROM intel_fixes
    `;
    let open = 0;
    let completed = 0;
    const byTrade = new Map<string, number>();
    const byRep = new Map<string, { rep: string; open: number; completed: number }>();
    const byAge = new Map<string, number>();
    for (const r of rows) {
      const isOpen = !r.completed;
      if (isOpen) open++;
      else completed++;
      const repKey = r.rep || (r.employee_id != null ? `emp ${r.employee_id}` : '(unassigned)');
      const rep = byRep.get(repKey) ?? { rep: repKey, open: 0, completed: 0 };
      if (isOpen) rep.open++;
      else rep.completed++;
      byRep.set(repKey, rep);
      if (isOpen) {
        const trade = r.trade || '(none)';
        byTrade.set(trade, (byTrade.get(trade) ?? 0) + 1);
        const bucket = ageBucket(ageDays(r.created_date));
        byAge.set(bucket, (byAge.get(bucket) ?? 0) + 1);
      }
    }
    res.json({
      total: rows.length,
      open,
      completed,
      by_trade: [...byTrade].map(([key, count]) => ({ key, count })).sort(byCountDesc),
      by_rep: [...byRep.values()].sort((a, b) => b.open - a.open),
      by_age: AGE_ORDER.filter((b) => byAge.has(b)).map((b) => ({ bucket: b, count: byAge.get(b)! })),
      took_ms: Date.now() - t0,
      computed_at: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: 'fixes_summary_failed', message: err instanceof Error ? err.message : String(err) });
  }
}

/* ── /api/intel/fixes-by-rep?rep= ─────────────────────────────────────────── */
export async function fixesByRep(req: Request, res: Response) {
  const t0 = Date.now();
  const rep = (req.query.rep as string | undefined)?.trim();
  if (!rep) {
    res.status(400).json({ error: 'missing_rep', message: 'rep query param required' });
    return;
  }
  try {
    const repId = /^\d+$/.test(rep) ? Number(rep) : null;
    const rows = await pgSql<Array<{ id: number; job_id: number | null; trade: string | null; description: string | null; created_date: string | null; photo_count: number | null }>>`
      SELECT id, job_id, trade, description, created_date, photo_count
        FROM intel_fixes
       WHERE completed = FALSE
         AND ${repId !== null
            ? pgSql`employee_id = ${repId}`
            : pgSql`(COALESCE(data->'employee'->>'firstName', '') || ' ' || COALESCE(data->'employee'->>'lastName', '')) ILIKE ${'%' + rep + '%'}`}
       ORDER BY created_date ASC NULLS LAST
    `;
    res.json({ rep, open: rows, count: rows.length, took_ms: Date.now() - t0 });
  } catch (err) {
    res.status(500).json({ error: 'fixes_by_rep_failed', message: err instanceof Error ? err.message : String(err) });
  }
}

/* ── /api/intel/tasks-overdue ─────────────────────────────────────────────── */
interface TaskRow {
  id: number;
  description: string | null;
  priority: string | null;
  due_date: string | null;
  employee_id: number | null;
  customer_id: string | null;
  rep: string | null;
}

export async function tasksOverdue(_req: Request, res: Response) {
  const t0 = Date.now();
  try {
    const rows = await pgSql<TaskRow[]>`
      SELECT id, description, priority, due_date, employee_id, customer_id,
             NULLIF(TRIM(COALESCE(data->'user'->>'firstName', '') || ' ' ||
                         COALESCE(data->'user'->>'lastName', '')), '') AS rep
        FROM intel_tasks
       WHERE pending = TRUE AND archived = FALSE AND due_date IS NOT NULL
    `;
    const overdue = rows.filter((r) => isPast(r.due_date));
    overdue.sort((a, b) => (Date.parse(a.due_date!) || 0) - (Date.parse(b.due_date!) || 0));
    const byRep = new Map<string, number>();
    for (const r of overdue) {
      const k = r.rep || (r.employee_id != null ? `emp ${r.employee_id}` : '(unassigned)');
      byRep.set(k, (byRep.get(k) ?? 0) + 1);
    }
    res.json({
      total_overdue: overdue.length,
      by_rep: [...byRep].map(([rep, count]) => ({ rep, count })).sort(byCountDesc),
      items: overdue,
      took_ms: Date.now() - t0,
      computed_at: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: 'tasks_overdue_failed', message: err instanceof Error ? err.message : String(err) });
  }
}

/* ── /api/intel/tasks-by-rep?rep= ─────────────────────────────────────────── */
export async function tasksByRep(req: Request, res: Response) {
  const t0 = Date.now();
  const rep = (req.query.rep as string | undefined)?.trim();
  if (!rep) {
    res.status(400).json({ error: 'missing_rep', message: 'rep query param required' });
    return;
  }
  try {
    const repId = /^\d+$/.test(rep) ? Number(rep) : null;
    const rows = await pgSql<Array<{ id: number; description: string | null; priority: string | null; due_date: string | null; customer_id: string | null }>>`
      SELECT id, description, priority, due_date, customer_id
        FROM intel_tasks
       WHERE pending = TRUE AND archived = FALSE
         AND ${repId !== null
            ? pgSql`employee_id = ${repId}`
            : pgSql`(COALESCE(data->'user'->>'firstName', '') || ' ' || COALESCE(data->'user'->>'lastName', '')) ILIKE ${'%' + rep + '%'}`}
       ORDER BY due_date ASC NULLS LAST
    `;
    res.json({
      rep,
      pending: rows,
      overdue_count: rows.filter((r) => isPast(r.due_date)).length,
      count: rows.length,
      took_ms: Date.now() - t0,
    });
  } catch (err) {
    res.status(500).json({ error: 'tasks_by_rep_failed', message: err instanceof Error ? err.message : String(err) });
  }
}

/* ── /api/intel/punchlist-active ──────────────────────────────────────────── */
export async function punchlistActive(_req: Request, res: Response) {
  const t0 = Date.now();
  try {
    const rows = await pgSql<Array<{ id: number; name: string | null; city: string | null; state: string | null; status_id: number | null; substatus_id: number | null; work_completed: boolean }>>`
      SELECT id, name, city, state, status_id, substatus_id, work_completed
        FROM intel_punchlist
       WHERE work_completed = FALSE
       ORDER BY id DESC
    `;
    res.json({ total: rows.length, items: rows, took_ms: Date.now() - t0, computed_at: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ error: 'punchlist_active_failed', message: err instanceof Error ? err.message : String(err) });
  }
}
