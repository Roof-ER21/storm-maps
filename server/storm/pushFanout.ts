/**
 * Push fan-out worker.
 *
 * Polls active NWS Severe Thunderstorm Warning + Tornado Warning polygons
 * every 90 seconds. For each warning, looks up subscriptions whose
 * `territory_states` intersect any state mentioned in the warning's areaDesc
 * (or whose centroid falls inside the warning polygon's state) and pushes a
 * concise payload with hail/wind details and a deep link back to the map.
 *
 * Dedup: each subscription's `last_alert_id` blocks a re-push of the same
 * NWS alert ID. NWS regenerates the ID for each new warning, so updates to
 * an existing warning area still trigger a fresh push.
 *
 * Idempotent — opt-in via HAIL_YES_PUSH=1 or NODE_ENV=production. Disabled
 * when no VAPID keys are configured.
 */

import { isPushConfigured, listSubscriptionsForStates, sendPushPayload } from './pushService.js';

const NWS_BASE = 'https://api.weather.gov';
const NWS_HEADERS = {
  'User-Agent': '(HailYes, contact@roofer21.com)',
  Accept: 'application/geo+json',
};
const NWS_FETCH_TIMEOUT_MS = Math.max(
  1_000,
  Number.parseInt(process.env.NWS_ACTIVE_FETCH_TIMEOUT_MS ?? '8000', 10) || 8_000,
);
const NWS_FAILURE_THRESHOLD = 3;
const NWS_COOLDOWN_MS = 5 * 60_000;

interface NwsAlertProps {
  '@id'?: string;
  id?: string;
  event?: string;
  headline?: string | null;
  description?: string | null;
  areaDesc?: string | null;
  onset?: string | null;
  expires?: string | null;
  parameters?: { maxHailSize?: string[]; maxWindGust?: string[] } | null;
}

interface NwsAlertFeature {
  id?: string;
  properties?: NwsAlertProps;
}

interface NwsAlertResponse {
  features?: NwsAlertFeature[];
}

const STATE_REGEX = /\b(VA|MD|PA|WV|DC|DE|NJ)\b/g;

function parseStatesFromAreaDesc(areaDesc?: string | null): string[] {
  if (!areaDesc) return [];
  const matches = areaDesc.match(STATE_REGEX) ?? [];
  return [...new Set(matches.map((m) => m.toUpperCase()))];
}

function parseHail(arr?: string[] | null): number | null {
  if (!arr || arr.length === 0) return null;
  const m = arr[0].match(/(\d+(?:\.\d+)?)/);
  return m ? parseFloat(m[1]) : null;
}

function parseWind(arr?: string[] | null): number | null {
  if (!arr || arr.length === 0) return null;
  const m = arr[0].match(/(\d+(?:\.\d+)?)/);
  return m ? parseFloat(m[1]) : null;
}

function shortAlertId(raw: string): string {
  return raw.includes('/') ? raw.slice(raw.lastIndexOf('/') + 1) : raw;
}

let pushFanoutNwsWarned = false;
let pushFanoutCooldownWarned = false;
let nwsConsecutiveFailures = 0;
let nwsCooldownUntil = 0;
let cycleInFlight = false;

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isAbortLike(err: unknown): boolean {
  const maybe = err as { name?: unknown; message?: unknown };
  const name = typeof maybe.name === 'string' ? maybe.name : '';
  const message =
    typeof maybe.message === 'string' ? maybe.message.toLowerCase() : String(err).toLowerCase();
  return (
    name === 'AbortError' ||
    name === 'TimeoutError' ||
    message.includes('aborted') ||
    message.includes('timed out')
  );
}

function nwsActiveDown(now = Date.now()): boolean {
  return now < nwsCooldownUntil;
}

function recordNwsActiveSuccess(): void {
  nwsConsecutiveFailures = 0;
  nwsCooldownUntil = 0;
  pushFanoutCooldownWarned = false;
}

function recordNwsActiveFailure(reason: string, now = Date.now()): void {
  if (nwsActiveDown(now)) return;
  nwsConsecutiveFailures += 1;
  if (nwsConsecutiveFailures < NWS_FAILURE_THRESHOLD) return;
  nwsCooldownUntil = now + NWS_COOLDOWN_MS;
  if (shouldLogOptionalUpstreams() && !pushFanoutCooldownWarned) {
    pushFanoutCooldownWarned = true;
    console.info(
      `[push-fanout] optional NWS polling paused for ${Math.round(
        NWS_COOLDOWN_MS / 60_000,
      )} min after repeated failures; latest=${reason}`,
    );
  }
}

interface ActiveWarningFetchResult {
  features: NwsAlertFeature[];
  ok: boolean;
  reason?: string;
}

async function fetchActiveWarningsForEvent(
  event: string,
): Promise<ActiveWarningFetchResult> {
  const params = new URLSearchParams({
    event,
    status: 'actual',
    message_type: 'alert',
  });
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), NWS_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${NWS_BASE}/alerts/active?${params.toString()}`, {
      headers: NWS_HEADERS,
      signal: ac.signal,
    });
    if (!res.ok) {
      return { features: [], ok: false, reason: `HTTP ${res.status}` };
    }
    const data = (await res.json()) as NwsAlertResponse;
    return { features: data.features ?? [], ok: true };
  } catch (err) {
    if (shouldLogOptionalUpstreams() && !isAbortLike(err) && !pushFanoutNwsWarned) {
      pushFanoutNwsWarned = true;
      console.info(
        '[push-fanout] optional NWS fetch unavailable (suppressing further):',
        errorMessage(err),
      );
    }
    return { features: [], ok: false, reason: errorMessage(err) };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchActiveSevereWarnings(): Promise<NwsAlertFeature[]> {
  if (nwsActiveDown()) return [];

  // Pull SVR + Tornado in parallel — both are roof-claim-relevant.
  const results = await Promise.all([
    fetchActiveWarningsForEvent('Severe Thunderstorm Warning'),
    fetchActiveWarningsForEvent('Tornado Warning'),
  ]);

  if (results.some((r) => r.ok)) {
    recordNwsActiveSuccess();
  } else {
    recordNwsActiveFailure(results.map((r) => r.reason).filter(Boolean).join(', ') || 'fetch failed');
  }

  return results.flatMap((r) => r.features);
}

let cyclesRun = 0;
let lastCycleStartedAt: string | null = null;
let lastCycleFinishedAt: string | null = null;
let lastCycleStats = { warnings: 0, pushed: 0, gone: 0, failed: 0 };

function shouldLogOptionalUpstreams(): boolean {
  return process.env.STORM_OPTIONAL_UPSTREAM_LOGS === '1';
}

export interface PushFanoutStatus {
  enabled: boolean;
  cyclesRun: number;
  lastCycleStartedAt: string | null;
  lastCycleFinishedAt: string | null;
  lastCycleStats: typeof lastCycleStats;
  intervalMs: number;
}

async function runFanoutCycle(): Promise<void> {
  if (cycleInFlight) return;
  cycleInFlight = true;
  lastCycleStartedAt = new Date().toISOString();
  const stats = { warnings: 0, pushed: 0, gone: 0, failed: 0 };

  try {
    const warnings = await fetchActiveSevereWarnings();
    stats.warnings = warnings.length;

    for (const w of warnings) {
      const props = w.properties;
      if (!props) continue;
      const states = parseStatesFromAreaDesc(props.areaDesc);
      if (states.length === 0) continue;
      const rawId = props['@id'] ?? props.id ?? w.id ?? '';
      if (!rawId) continue;
      const alertId = shortAlertId(rawId);

      const hail = parseHail(props.parameters?.maxHailSize);
      const wind = parseWind(props.parameters?.maxWindGust);

      const lines: string[] = [];
      if (hail !== null) lines.push(`Hail ${hail}″`);
      if (wind !== null) lines.push(`${wind} mph wind`);
      const areaShort = (props.areaDesc ?? '').split(';').slice(0, 2).join(',');

      const subs = await listSubscriptionsForStates({ states, alertId });
      for (const sub of subs) {
        const result = await sendPushPayload(
          sub,
          {
            title: props.event ?? 'Severe Storm Warning',
            body: [lines.join(' · '), areaShort].filter(Boolean).join(' — '),
            url: '/',
            tag: `nws-${alertId}`,
            requireInteraction: hail !== null && hail >= 1.0,
            data: { alertId, states, hail, wind },
          },
          { alertId },
        );
        if (result.ok) stats.pushed += 1;
        else if (result.reason === 'gone') stats.gone += 1;
        else stats.failed += 1;
      }
    }
  } catch (err) {
    stats.failed += 1;
    if (shouldLogOptionalUpstreams()) {
      console.info('[push-fanout] cycle failed:', errorMessage(err));
    }
  } finally {
    lastCycleStats = stats;
    lastCycleFinishedAt = new Date().toISOString();
    cyclesRun += 1;
    cycleInFlight = false;
    if (stats.pushed > 0 || stats.gone > 0 || stats.failed > 0) {
      console.log(
        `[push-fanout] cycle ${cyclesRun} — warnings=${stats.warnings} ` +
          `pushed=${stats.pushed} gone=${stats.gone} failed=${stats.failed}`,
      );
    }
  }
}

const FANOUT_INTERVAL_MS = 90 * 1000;
let timer: ReturnType<typeof setInterval> | null = null;

export function startPushFanout(): boolean {
  if (timer) return true;
  const enabled =
    (process.env.HAIL_YES_PUSH === '1' || process.env.NODE_ENV === 'production') &&
    isPushConfigured();
  if (!enabled) {
    console.log(
      '[push-fanout] disabled (set HAIL_YES_PUSH=1 + VAPID keys to enable)',
    );
    return false;
  }
  console.log(
    `[push-fanout] starting — polling every ${FANOUT_INTERVAL_MS / 1000}s`,
  );
  timer = setInterval(() => {
    void runFanoutCycle();
  }, FANOUT_INTERVAL_MS);
  timer.unref();
  // First cycle 30s after boot so we don't compete with the swath prewarm.
  setTimeout(() => {
    void runFanoutCycle();
  }, 30 * 1000).unref();
  return true;
}

export function getPushFanoutStatus(): PushFanoutStatus {
  return {
    enabled:
      (process.env.HAIL_YES_PUSH === '1' || process.env.NODE_ENV === 'production') &&
      isPushConfigured(),
    cyclesRun,
    lastCycleStartedAt,
    lastCycleFinishedAt,
    lastCycleStats: { ...lastCycleStats },
    intervalMs: FANOUT_INTERVAL_MS,
  };
}
