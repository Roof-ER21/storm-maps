/**
 * In-process daily refresh scheduler. Replaces the Mac launchd cron so the
 * stealth refresh runs even when Ahmed's Mac is offline.
 *
 * Approach:
 *   - Single tick every 60s.
 *   - Fire when local clock matches CRON_HOUR_UTC:CRON_MINUTE_UTC AND we
 *     haven't fired in the last 18 hours.
 *   - The 18h dedup window survives container restarts: it's measured against
 *     `refreshState.startedAt`, which gets set every time the refresh
 *     actually runs.
 *
 * Env knobs:
 *   RIQ_CRON_DISABLED=1      — skip the whole scheduler (default off)
 *   RIQ_CRON_HOUR_UTC=9      — fire hour (UTC); 9 UTC = 5am ET (default)
 *   RIQ_CRON_MIN_UTC=33      — fire minute (UTC; default 33)
 *
 * The scheduler reuses the existing refreshState single-flight: if a manual
 * refresh is already running, the cron tick is a no-op.
 */
import { refreshState, runRefresh, type RefreshStatus } from './routes.js';

const TICK_INTERVAL_MS = 60_000;
const MIN_RERUN_INTERVAL_MS = 18 * 60 * 60 * 1000;  // 18h

function shouldFireNow(now: Date, hour: number, minute: number): boolean {
  return now.getUTCHours() === hour && now.getUTCMinutes() === minute;
}

function tooRecent(state: RefreshStatus): boolean {
  if (!state.startedAt) return false;
  const last = new Date(state.startedAt).getTime();
  if (!Number.isFinite(last)) return false;
  return Date.now() - last < MIN_RERUN_INTERVAL_MS;
}

export function startRefreshScheduler(): void {
  if (process.env.RIQ_CRON_DISABLED === '1' || process.env.RIQ_CRON_DISABLED === 'true') {
    console.log('[scheduler] RIQ_CRON_DISABLED set — skipping daily refresh scheduler');
    return;
  }
  const hour = Math.max(0, Math.min(23, Number(process.env.RIQ_CRON_HOUR_UTC) || 9));
  const minute = Math.max(0, Math.min(59, Number(process.env.RIQ_CRON_MIN_UTC) || 33));
  console.log(`[scheduler] Daily refresh scheduled for ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')} UTC`);

  // Tick every minute.
  setInterval(() => {
    const now = new Date();
    if (!shouldFireNow(now, hour, minute)) return;
    if (refreshState.state === 'running') {
      console.log('[scheduler] Skipping fire — refresh already running');
      return;
    }
    if (tooRecent(refreshState)) {
      console.log(`[scheduler] Skipping fire — last refresh started ${refreshState.startedAt} (within 18h)`);
      return;
    }
    console.log(`[scheduler] Firing scheduled refresh at ${now.toISOString()}`);
    void runRefresh('cron').catch((err) => {
      console.error('[scheduler] runRefresh threw:', err instanceof Error ? err.message : err);
    });
  }, TICK_INTERVAL_MS);
}
