/**
 * AR rollup — surfaces aging + carrier friction from data/receivables.json
 * (loaded via intel_blobs.receivables). Computed at request time so days
 * outstanding stay accurate without daily re-import.
 *
 * GET /api/intel/receivables/rollup
 *   ?carrier=Allstate   (optional canonical filter; uses carrier-normalize)
 *   ?asOf=2026-05-19     (optional override; defaults to today)
 */
import type { Request, Response } from 'express';
import { sql as pgSql } from '../db.js';
import { normalizeCarrier } from './carrier-normalize.mjs';

interface ARAccount {
  status?: string | null;
  sentOn?: string | null;
  completionPayment?: number | null;
  finalPayment?: number | null;
  insurance?: { company?: string | null } | null;
  job?: { jobTotal?: number | null; state?: string | null } | null;
  proj?: { jobTotal?: number | null; salesRep?: string | null } | null;
}

interface DownpaymentRow {
  status?: string | null;
  dateAdded?: string | null;
  insurance?: { company?: string | null } | null;
  job?: { jobTotal?: number | null } | null;
}

interface ReceivablesBlob {
  accounts?: ARAccount[];
  downpayments?: DownpaymentRow[];
}

const BUCKET_ORDER = ['0-30', '31-60', '61-90', '91-180', '180+'] as const;
type AgingBucket = typeof BUCKET_ORDER[number];

function bucketize(days: number): AgingBucket {
  if (days <= 30) return '0-30';
  if (days <= 60) return '31-60';
  if (days <= 90) return '61-90';
  if (days <= 180) return '91-180';
  return '180+';
}

function emptyAging(): Record<AgingBucket, { count: number; outstanding: number }> {
  return {
    '0-30':   { count: 0, outstanding: 0 },
    '31-60':  { count: 0, outstanding: 0 },
    '61-90':  { count: 0, outstanding: 0 },
    '91-180': { count: 0, outstanding: 0 },
    '180+':   { count: 0, outstanding: 0 },
  };
}

function outstandingOf(a: ARAccount): number {
  const total = a.proj?.jobTotal ?? a.job?.jobTotal ?? 0;
  const paid = (a.completionPayment ?? 0) + (a.finalPayment ?? 0);
  return Math.max(0, total - paid);
}

function daysBetween(asOf: Date, sent?: string | null): number | null {
  if (!sent) return null;
  const d = new Date(sent);
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor((asOf.getTime() - d.getTime()) / 86400000);
}

export async function arRollup(req: Request, res: Response): Promise<void> {
  try {
    const q = req.query as Record<string, string | undefined>;
    const asOf = q.asOf ? new Date(q.asOf) : new Date();
    if (Number.isNaN(asOf.getTime())) {
      res.status(400).json({ error: 'invalid_asOf', detail: 'use YYYY-MM-DD' });
      return;
    }
    const carrierFilter = q.carrier ? (normalizeCarrier(q.carrier) || q.carrier) : null;

    const rows = await pgSql<Array<{ data: ReceivablesBlob }>>`
      SELECT data FROM intel_blobs WHERE key = 'receivables' LIMIT 1
    `;
    const blob = rows[0]?.data;
    if (!blob) {
      res.json({
        asOf: asOf.toISOString().slice(0, 10),
        carrierFilter,
        totals: { count: 0, outstanding: 0, depositsAwaiting: 0 },
        aging: emptyAging(),
        statusBreakdown: [],
        downpaymentStatus: [],
        byCarrier: [],
        noData: true,
      });
      return;
    }

    const accountsAll = blob.accounts ?? [];
    const downpayments = blob.downpayments ?? [];

    const accounts = carrierFilter
      ? accountsAll.filter((a) => {
          const raw = a.insurance?.company ?? '';
          return (normalizeCarrier(raw) || raw) === carrierFilter;
        })
      : accountsAll;

    const aging = emptyAging();
    const statusMap = new Map<string, { count: number; outstanding: number }>();
    type CarrierBucket = {
      count: number;
      outstanding: number;
      daysSum: number;
      daysN: number;
      oldestDays: number;
      aging: Record<AgingBucket, number>;
    };
    const carrierMap = new Map<string, CarrierBucket>();

    let totalOutstanding = 0;
    let withSentOn = 0;
    for (const a of accounts) {
      const out = outstandingOf(a);
      totalOutstanding += out;
      const status = a.status ?? '(unknown)';
      const sbucket = statusMap.get(status) ?? { count: 0, outstanding: 0 };
      sbucket.count += 1;
      sbucket.outstanding += out;
      statusMap.set(status, sbucket);

      const days = daysBetween(asOf, a.sentOn);
      const carrierRaw = a.insurance?.company ?? '(unknown)';
      const carrier = normalizeCarrier(carrierRaw) || carrierRaw || '(unknown)';
      const cb = carrierMap.get(carrier) ?? {
        count: 0,
        outstanding: 0,
        daysSum: 0,
        daysN: 0,
        oldestDays: 0,
        aging: { '0-30': 0, '31-60': 0, '61-90': 0, '91-180': 0, '180+': 0 },
      };
      cb.count += 1;
      cb.outstanding += out;
      if (days != null) {
        cb.daysSum += days;
        cb.daysN += 1;
        if (days > cb.oldestDays) cb.oldestDays = days;
        const b = bucketize(days);
        aging[b].count += 1;
        aging[b].outstanding += out;
        cb.aging[b] += 1;
        withSentOn += 1;
      }
      carrierMap.set(carrier, cb);
    }

    const downpaymentStatusMap = new Map<string, number>();
    for (const d of downpayments) {
      const s = d.status ?? '(unknown)';
      downpaymentStatusMap.set(s, (downpaymentStatusMap.get(s) ?? 0) + 1);
    }
    const depositsAwaiting = downpayments.filter((d) => d.status !== 'Collected').length;

    const statusBreakdown = [...statusMap.entries()]
      .map(([status, v]) => ({ status, count: v.count, outstanding: Math.round(v.outstanding) }))
      .sort((a, b) => b.outstanding - a.outstanding);

    const downpaymentStatus = [...downpaymentStatusMap.entries()]
      .map(([status, count]) => ({ status, count }))
      .sort((a, b) => b.count - a.count);

    const byCarrier = [...carrierMap.entries()]
      .map(([carrier, b]) => ({
        carrier,
        count: b.count,
        outstanding: Math.round(b.outstanding),
        avgDays: b.daysN > 0 ? Math.round(b.daysSum / b.daysN) : null,
        oldestDays: b.oldestDays || null,
        aging: b.aging,
      }))
      .sort((a, b) => b.outstanding - a.outstanding);

    res.json({
      asOf: asOf.toISOString().slice(0, 10),
      carrierFilter,
      totals: {
        count: accounts.length,
        countWithSentOn: withSentOn,
        outstanding: Math.round(totalOutstanding),
        depositsAwaiting,
        downpaymentsTotal: downpayments.length,
      },
      aging: Object.fromEntries(
        BUCKET_ORDER.map((k) => [k, { count: aging[k].count, outstanding: Math.round(aging[k].outstanding) }])
      ),
      statusBreakdown,
      downpaymentStatus,
      byCarrier,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'unknown';
    res.status(500).json({ error: 'ar_rollup_failed', detail: msg });
  }
}
