/**
 * Phase 8d — Calendar / Scheduling endpoints over intel_events (the portal's real
 * event feed: events/sales/all + events/production/all). The events/customers and
 * events/employees endpoints are entity DIRECTORIES, not appointments, so they are
 * NOT ingested here — RIQ21 already has customers (intel_customer_exposure) and
 * employees (reps).
 *
 *   GET /api/intel/schedule-today                          — today's events (ET)
 *   GET /api/intel/schedule-week?days=N                    — next N days (default 7), grouped by ET day
 *   GET /api/intel/schedule-upcoming?type=&customer=&limit= — filtered upcoming list
 *
 * start_time/end_time are TIMESTAMPTZ; ET-day filtering uses AT TIME ZONE
 * 'America/New_York' (DST-safe, index-friendly) — no text-date cast. Empty table
 * returns clean zeros, so these are safe to ship before the data pull is wired.
 *
 * All handlers register before the /:key catch-all (see routes.ts).
 */
import { type Request, type Response } from 'express';
import { sql as pgSql } from '../db.js';

const ET = 'America/New_York';

interface EventRow {
  id: string;
  event_type: string | null;
  audience: string | null;
  start_time: string | null;
  end_time: string | null;
  customer_id: string | null;
  lead_id: string | null;
  supplier_id: string | null;
  notes: string | null;
  source: string | null;
}

/** Render a timestamp as its ET calendar day (YYYY-MM-DD). */
export function etDay(ts: string | null): string {
  if (!ts) return 'unknown';
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? 'unknown' : d.toLocaleDateString('en-CA', { timeZone: ET });
}

/* ── /api/intel/schedule-today ────────────────────────────────────────────── */
export async function scheduleToday(_req: Request, res: Response) {
  const t0 = Date.now();
  try {
    const rows = await pgSql<EventRow[]>`
      SELECT id, event_type, audience, start_time, end_time, customer_id, lead_id, supplier_id, notes, source
        FROM intel_events
       WHERE start_time IS NOT NULL
         AND (start_time AT TIME ZONE ${ET})::date = (NOW() AT TIME ZONE ${ET})::date
       ORDER BY start_time ASC
    `;
    const byType = new Map<string, number>();
    for (const r of rows) {
      const k = r.event_type || '(none)';
      byType.set(k, (byType.get(k) ?? 0) + 1);
    }
    res.json({
      date_et: new Date().toLocaleDateString('en-CA', { timeZone: ET }),
      total: rows.length,
      by_type: [...byType].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count),
      events: rows,
      took_ms: Date.now() - t0,
    });
  } catch (err) {
    res.status(500).json({ error: 'schedule_today_failed', message: err instanceof Error ? err.message : String(err) });
  }
}

/* ── /api/intel/schedule-week?days=N ──────────────────────────────────────── */
export async function scheduleWeek(req: Request, res: Response) {
  const t0 = Date.now();
  const days = Math.min(31, Math.max(1, Number((req.query.days as string) || 7)));
  try {
    const rows = await pgSql<EventRow[]>`
      SELECT id, event_type, audience, start_time, end_time, customer_id, lead_id, supplier_id, notes, source
        FROM intel_events
       WHERE start_time >= NOW()
         AND start_time < NOW() + (${days} * INTERVAL '1 day')
       ORDER BY start_time ASC
    `;
    const byDay = new Map<string, EventRow[]>();
    for (const r of rows) {
      const day = etDay(r.start_time);
      let bucket = byDay.get(day);
      if (!bucket) { bucket = []; byDay.set(day, bucket); }
      bucket.push(r);
    }
    res.json({
      days,
      total: rows.length,
      by_day: [...byDay].map(([day, events]) => ({ day, count: events.length, events })),
      took_ms: Date.now() - t0,
    });
  } catch (err) {
    res.status(500).json({ error: 'schedule_week_failed', message: err instanceof Error ? err.message : String(err) });
  }
}

/* ── /api/intel/schedule-upcoming?type=&customer=&limit= ──────────────────── */
export async function scheduleUpcoming(req: Request, res: Response) {
  const t0 = Date.now();
  const q = req.query as Record<string, string | undefined>;
  const type = q.type?.trim() || null;
  const customer = q.customer?.trim() || null;
  const limit = Math.min(500, Math.max(1, Number(q.limit) || 100));
  try {
    const rows = await pgSql<EventRow[]>`
      SELECT id, event_type, audience, start_time, end_time, customer_id, lead_id, supplier_id, notes, source
        FROM intel_events
       WHERE start_time >= NOW()
         ${type ? pgSql`AND event_type = ${type}` : pgSql``}
         ${customer ? pgSql`AND customer_id = ${customer}` : pgSql``}
       ORDER BY start_time ASC
       LIMIT ${limit}
    `;
    res.json({ total: rows.length, events: rows, type, customer, limit, took_ms: Date.now() - t0 });
  } catch (err) {
    res.status(500).json({ error: 'schedule_upcoming_failed', message: err instanceof Error ? err.message : String(err) });
  }
}
