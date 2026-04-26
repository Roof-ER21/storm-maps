/**
 * Admin dashboard — internal view that summarizes the in-repo storm
 * pipeline at a glance:
 *   • swath_cache + event_cache contents (counts by source, freshness)
 *   • prewarm scheduler last-cycle stats
 *   • push fan-out worker status + last cycle stats
 *
 * Auth: when ADMIN_TOKEN is set on the server, every /api/admin/* request
 * needs `Authorization: Bearer <token>`. The page lets the operator paste
 * the token once; we keep it in sessionStorage so a refresh doesn't lose
 * it. JWT-admin path (logged-in company-plan user) works without a paste.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  enableStormAlerts,
  disableStormAlerts,
  getNotificationPermission,
  isNotificationSupported,
} from '../services/notificationService';

interface CacheSourceEntry {
  source: string;
  total: number;
  live: number;
  expired: number;
  oldestEntry: string | null;
  newestEntry: string | null;
}

interface CacheStatus {
  ok: boolean;
  totals: { total: number; live: number; expired: number };
  bySource: CacheSourceEntry[];
  generatedAt: string;
}

interface PrewarmStatus {
  enabled: boolean;
  cyclesRun: number;
  lastCycleStartedAt: string | null;
  lastCycleFinishedAt: string | null;
  lastCycleStats: {
    warmedSwath: number;
    warmedHail: number;
    warmedEvents: number;
    warmedHotProperties: number;
    hailDatesScanned: number;
    errors: number;
  };
  intervalMs: number;
}

interface PushStatus {
  enabled: boolean;
  cyclesRun: number;
  lastCycleStartedAt: string | null;
  lastCycleFinishedAt: string | null;
  lastCycleStats: {
    warnings: number;
    pushed: number;
    gone: number;
    failed: number;
  };
  intervalMs: number;
}

interface LiveMrmsStatus {
  active: boolean;
  runs: number;
  firedTotal: number;
  lastError: string | null;
  lastRunAt: string | null;
  states: Array<{ state: string; lastAlertedBand: number; lastSignalAt: string | null }>;
}

const ADMIN_TOKEN_KEY = 'hail-yes:admin-token';

function getStoredToken(): string {
  try {
    return window.sessionStorage.getItem(ADMIN_TOKEN_KEY) ?? '';
  } catch {
    return '';
  }
}

function storeToken(value: string): void {
  try {
    if (value) window.sessionStorage.setItem(ADMIN_TOKEN_KEY, value);
    else window.sessionStorage.removeItem(ADMIN_TOKEN_KEY);
  } catch {
    // Ignore — incognito + storage off.
  }
}

async function fetchAdminJson<T>(
  path: string,
  token: string,
  init?: RequestInit,
): Promise<{ ok: true; data: T } | { ok: false; status: number; error: string }> {
  try {
    const res = await fetch(path, {
      ...init,
      headers: {
        ...(init?.headers ?? {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return {
        ok: false,
        status: res.status,
        error: text || `HTTP ${res.status}`,
      };
    }
    return { ok: true, data: (await res.json()) as T };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      error: err instanceof Error ? err.message : 'network error',
    };
  }
}

function formatRelative(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const ms = Date.now() - d.getTime();
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.round(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.round(sec / 3600)}h ago`;
  return `${Math.round(sec / 86400)}d ago`;
}

export default function AdminPage() {
  const [token, setToken] = useState<string>(() => getStoredToken());
  const [tokenInput, setTokenInput] = useState('');
  const [cache, setCache] = useState<CacheStatus | null>(null);
  const [prewarm, setPrewarm] = useState<PrewarmStatus | null>(null);
  const [push, setPush] = useState<PushStatus | null>(null);
  const [liveMrms, setLiveMrms] = useState<LiveMrmsStatus | null>(null);
  const [pushPermState, setPushPermState] = useState<NotificationPermission>(
    isNotificationSupported() ? getNotificationPermission() : 'denied',
  );
  const [pushBusy, setPushBusy] = useState(false);
  const [pushMessage, setPushMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [purging, setPurging] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [c, p, pu, lm] = await Promise.all([
      fetchAdminJson<CacheStatus>('/api/admin/cache-status', token),
      fetchAdminJson<PrewarmStatus>('/api/admin/prewarm-status', token),
      fetchAdminJson<PushStatus>('/api/admin/push-status', token),
      fetchAdminJson<LiveMrmsStatus>('/api/admin/live-mrms-status', token),
    ]);
    if (!c.ok) {
      setError(`cache-status: ${c.error}`);
      setCache(null);
    } else {
      setCache(c.data);
    }
    if (p.ok) setPrewarm(p.data);
    if (pu.ok) setPush(pu.data);
    if (lm.ok) setLiveMrms(lm.data);
    setLoading(false);
  }, [token]);

  const handleEnableAlerts = async () => {
    setPushBusy(true);
    setPushMessage(null);
    try {
      const result = await enableStormAlerts({
        territoryStates: ['VA', 'MD', 'PA', 'DE', 'NJ', 'DC'],
        label: 'admin-onboarded',
      });
      if (result.ok) {
        setPushMessage('Storm alerts enabled on this device.');
        setPushPermState(getNotificationPermission());
      } else {
        setPushMessage(`Could not enable: ${result.reason}`);
      }
    } finally {
      setPushBusy(false);
    }
  };

  const handleDisableAlerts = async () => {
    setPushBusy(true);
    setPushMessage(null);
    try {
      const ok = await disableStormAlerts();
      setPushMessage(ok ? 'Storm alerts disabled on this device.' : 'No active subscription found.');
      setPushPermState(getNotificationPermission());
    } finally {
      setPushBusy(false);
    }
  };

  useEffect(() => {
    // Defer the setState path one tick so refresh() doesn't synchronously
    // flip loading/error during the effect — keeps react-hooks/set-state-in-effect
    // happy without changing observable behavior.
    queueMicrotask(() => {
      void refresh();
    });
  }, [refresh]);

  const handlePurge = async () => {
    if (!window.confirm('Purge all expired swath_cache rows?')) return;
    setPurging(true);
    const result = await fetchAdminJson<{ ok: boolean; purged: number }>(
      '/api/admin/cache-purge',
      token,
      { method: 'POST' },
    );
    setPurging(false);
    if (!result.ok) {
      setError(`cache-purge: ${result.error}`);
      return;
    }
    void refresh();
  };

  const needsAuth = error?.includes('401') || error?.includes('admin auth');

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-stone-900">Admin Dashboard</h1>
          <p className="text-xs text-stone-500">
            Storm pipeline status — cache, prewarm, push fan-out.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={loading}
            className="rounded-md border border-stone-200 bg-white px-3 py-1.5 text-xs font-semibold text-stone-700 hover:bg-stone-100 disabled:opacity-50"
          >
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
          <button
            type="button"
            onClick={handlePurge}
            disabled={purging || !cache}
            className="rounded-md border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800 hover:bg-amber-100 disabled:opacity-50"
          >
            {purging ? 'Purging…' : 'Purge Expired'}
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-800">
          {error}
        </div>
      )}

      {needsAuth && (
        <div className="mb-6 rounded-lg border border-stone-200 bg-stone-50 p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-stone-500">
            Admin Token
          </p>
          <p className="mt-1 text-xs text-stone-500">
            Paste the value of <code>ADMIN_TOKEN</code> from your Railway env.
            Saved in sessionStorage for this tab only.
          </p>
          <div className="mt-3 flex gap-2">
            <input
              type="password"
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              placeholder="ADMIN_TOKEN"
              className="flex-1 rounded-md border border-stone-300 px-3 py-1.5 text-sm font-mono"
            />
            <button
              type="button"
              onClick={() => {
                storeToken(tokenInput);
                setToken(tokenInput);
                setTokenInput('');
              }}
              className="rounded-md bg-orange-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-orange-600"
            >
              Save & Retry
            </button>
            {token && (
              <button
                type="button"
                onClick={() => {
                  storeToken('');
                  setToken('');
                }}
                className="rounded-md border border-stone-300 bg-white px-3 py-1.5 text-xs font-semibold text-stone-600 hover:bg-stone-100"
              >
                Clear
              </button>
            )}
          </div>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-4">
        <SummaryCard
          label="Cache entries (live)"
          value={cache ? cache.totals.live.toLocaleString() : '—'}
          sub={
            cache
              ? `${cache.totals.expired.toLocaleString()} expired · ${cache.totals.total.toLocaleString()} total`
              : undefined
          }
        />
        <SummaryCard
          label="Prewarm cycles"
          value={prewarm ? String(prewarm.cyclesRun) : '—'}
          sub={
            prewarm
              ? `Last ${formatRelative(prewarm.lastCycleFinishedAt)} · ${prewarm.enabled ? 'enabled' : 'disabled'}`
              : undefined
          }
        />
        <SummaryCard
          label="NWS push fan-out"
          value={push ? String(push.cyclesRun) : '—'}
          sub={
            push
              ? `Last ${formatRelative(push.lastCycleFinishedAt)} · ${push.enabled ? 'enabled' : 'disabled'}`
              : undefined
          }
        />
        <SummaryCard
          label="Live MRMS alerts"
          value={liveMrms ? String(liveMrms.firedTotal) : '—'}
          sub={
            liveMrms
              ? `${liveMrms.runs} runs · ${liveMrms.active ? 'active' : 'disabled'} · last ${formatRelative(liveMrms.lastRunAt)}`
              : undefined
          }
        />
      </div>

      {/* Push subscription onboarding (this device) */}
      <div className="mt-6 rounded-xl border border-stone-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-stone-900">Storm alerts on this device</h2>
        <p className="mt-1 text-xs text-stone-500">
          Subscribes the browser/phone to push notifications for live MRMS hail bands and NWS severe-thunderstorm/tornado warnings across VA / MD / PA / DE / NJ / DC.
        </p>
        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            onClick={() => void handleEnableAlerts()}
            disabled={pushBusy || !isNotificationSupported()}
            className="rounded-md bg-orange-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-orange-600 disabled:opacity-50"
          >
            {pushBusy ? 'Working…' : 'Enable Storm Alerts'}
          </button>
          <button
            type="button"
            onClick={() => void handleDisableAlerts()}
            disabled={pushBusy || pushPermState !== 'granted'}
            className="rounded-md border border-stone-200 bg-white px-3 py-1.5 text-xs font-semibold text-stone-700 hover:bg-stone-100 disabled:opacity-50"
          >
            Disable
          </button>
          <span className="text-[11px] text-stone-500">
            Permission: <code>{pushPermState}</code>
            {!isNotificationSupported() && ' · this browser does not support push'}
          </span>
        </div>
        {pushMessage && (
          <p className="mt-2 text-[11px] text-stone-600">{pushMessage}</p>
        )}
      </div>

      {/* swath_cache breakdown */}
      <div className="mt-6 rounded-xl border border-stone-200 bg-white">
        <div className="border-b border-stone-200 px-4 py-3">
          <h2 className="text-sm font-semibold text-stone-900">
            swath_cache by source
          </h2>
        </div>
        <table className="w-full text-xs">
          <thead className="bg-stone-50 text-left text-stone-500">
            <tr>
              <th className="px-4 py-2 font-semibold">Source</th>
              <th className="px-4 py-2 font-semibold">Live</th>
              <th className="px-4 py-2 font-semibold">Expired</th>
              <th className="px-4 py-2 font-semibold">Total</th>
              <th className="px-4 py-2 font-semibold">Oldest</th>
              <th className="px-4 py-2 font-semibold">Newest</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {cache?.bySource.length ? (
              cache.bySource.map((row) => (
                <tr key={row.source} className="text-stone-700">
                  <td className="px-4 py-2 font-mono">{row.source}</td>
                  <td className="px-4 py-2 font-mono tabular-nums">{row.live}</td>
                  <td className="px-4 py-2 font-mono tabular-nums">{row.expired}</td>
                  <td className="px-4 py-2 font-mono tabular-nums">{row.total}</td>
                  <td className="px-4 py-2 text-stone-500">{formatRelative(row.oldestEntry)}</td>
                  <td className="px-4 py-2 text-stone-500">{formatRelative(row.newestEntry)}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-stone-500">
                  {loading ? 'Loading…' : 'No cache entries.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* live MRMS alert worker */}
      <div className="mt-6 rounded-xl border border-stone-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-stone-900">Live MRMS alert worker</h2>
        {liveMrms ? (
          <div className="mt-3 grid gap-x-6 gap-y-2 md:grid-cols-2 text-xs">
            <DetailItem label="Status" value={liveMrms.active ? 'active' : 'disabled (set HAIL_YES_LIVE_MRMS_ALERT=1)'} />
            <DetailItem label="Runs" value={String(liveMrms.runs)} />
            <DetailItem label="Pushes fired" value={String(liveMrms.firedTotal)} />
            <DetailItem label="Last run" value={formatRelative(liveMrms.lastRunAt)} />
            <DetailItem label="Last error" value={liveMrms.lastError ?? '—'} />
            <DetailItem
              label="Bands by state"
              value={
                liveMrms.states.length === 0
                  ? '—'
                  : liveMrms.states.map((s) => `${s.state}=${s.lastAlertedBand}`).join(' · ')
              }
            />
          </div>
        ) : (
          <p className="mt-3 text-xs text-stone-500">No data.</p>
        )}
      </div>

      {/* prewarm details */}
      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-stone-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-stone-900">Prewarm scheduler</h2>
          {prewarm ? (
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
              <DetailItem label="Status" value={prewarm.enabled ? 'enabled' : 'disabled'} />
              <DetailItem label="Cycles" value={String(prewarm.cyclesRun)} />
              <DetailItem label="Last started" value={formatRelative(prewarm.lastCycleStartedAt)} />
              <DetailItem label="Last finished" value={formatRelative(prewarm.lastCycleFinishedAt)} />
              <DetailItem label="Wind warmed" value={String(prewarm.lastCycleStats.warmedSwath)} />
              <DetailItem label="Hail warmed" value={`${prewarm.lastCycleStats.warmedHail} / ${prewarm.lastCycleStats.hailDatesScanned}d`} />
              <DetailItem label="Events warmed" value={String(prewarm.lastCycleStats.warmedEvents)} />
              <DetailItem label="Hot props warmed" value={String(prewarm.lastCycleStats.warmedHotProperties)} />
              <DetailItem label="Errors" value={String(prewarm.lastCycleStats.errors)} />
              <DetailItem label="Interval" value={`${Math.round(prewarm.intervalMs / 60_000)} min`} />
            </dl>
          ) : (
            <p className="mt-3 text-xs text-stone-500">No data.</p>
          )}
        </div>

        <div className="rounded-xl border border-stone-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-stone-900">NWS push fan-out</h2>
          {push ? (
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
              <DetailItem label="Status" value={push.enabled ? 'enabled' : 'disabled'} />
              <DetailItem label="Cycles" value={String(push.cyclesRun)} />
              <DetailItem label="Last started" value={formatRelative(push.lastCycleStartedAt)} />
              <DetailItem label="Last finished" value={formatRelative(push.lastCycleFinishedAt)} />
              <DetailItem label="Warnings seen" value={String(push.lastCycleStats.warnings)} />
              <DetailItem label="Pushed" value={String(push.lastCycleStats.pushed)} />
              <DetailItem label="Gone (410)" value={String(push.lastCycleStats.gone)} />
              <DetailItem label="Failed" value={String(push.lastCycleStats.failed)} />
              <DetailItem label="Interval" value={`${Math.round(push.intervalMs / 1000)} s`} />
            </dl>
          ) : (
            <p className="mt-3 text-xs text-stone-500">No data.</p>
          )}
        </div>
      </div>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-xl border border-stone-200 bg-white p-4">
      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-500">
        {label}
      </p>
      <p className="mt-1 text-2xl font-bold text-stone-900 tabular-nums">{value}</p>
      {sub && <p className="mt-1 text-[11px] text-stone-500">{sub}</p>}
    </div>
  );
}

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-stone-500">{label}</dt>
      <dd className="font-mono text-stone-900 tabular-nums">{value}</dd>
    </>
  );
}
