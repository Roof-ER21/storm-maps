/**
 * Live MRMS push-alert worker.
 *
 * Mirrors `pushFanout.ts` but for hail crossings (radar-detected) instead of
 * NWS warnings. Cadence: every 5 minutes. Fetches the live MRMS 60-min
 * product for each focus territory bbox and fans out a push notification
 * when a new hail-band threshold is crossed since the last poll.
 *
 * Per-state state machine to avoid spamming:
 *   For each state, remember the highest band index alerted so far this
 *   "storm cycle" (resets after MAX_QUIET_MINUTES of no signal). New alerts
 *   only fire when a strictly higher band is observed.
 *
 * Boots in production OR with HAIL_YES_LIVE_MRMS_ALERT=1. No-op without
 * VAPID keys (push fan-out can't deliver anyway).
 */

import { buildMrmsNowVectorPolygons } from './mrmsService.js';
import { listSubscriptionsForStates, sendPushPayload } from './pushService.js';
import type { BoundingBox } from './types.js';

interface FocusTerritory {
  code: string;
  name: string;
  stateCodes: string[];
  bounds: BoundingBox;
}

// Mirror of src/data/territories.ts — duplicated server-side to avoid
// importing client TS into the server module graph.
const FOCUS_TERRITORIES: FocusTerritory[] = [
  { code: 'VA', name: 'Virginia', stateCodes: ['VA'], bounds: { north: 39.5, south: 36.4, east: -75.1, west: -83.7 } },
  { code: 'MD', name: 'Maryland + DC', stateCodes: ['MD', 'DC'], bounds: { north: 39.8, south: 37.8, east: -75.0, west: -79.5 } },
  { code: 'PA', name: 'Pennsylvania', stateCodes: ['PA'], bounds: { north: 42.4, south: 39.6, east: -74.6, west: -80.6 } },
  { code: 'DE', name: 'Delaware', stateCodes: ['DE'], bounds: { north: 39.95, south: 38.4, east: -74.95, west: -75.85 } },
  { code: 'NJ', name: 'New Jersey', stateCodes: ['NJ'], bounds: { north: 41.4, south: 38.85, east: -73.85, west: -75.6 } },
];

const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 min
const INITIAL_DELAY_MS = 90 * 1000; // 90s after boot
const MAX_QUIET_MINUTES = 90; // reset state after this much quiet time
const HAIL_BAND_THRESHOLDS_INCHES = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0, 2.5, 3.0];

interface StateMemory {
  lastAlertedBand: number;
  lastSignalAt: number;
}

const memory = new Map<string, StateMemory>();
let active = false;
let runs = 0;
let firedTotal = 0;
let lastError: string | null = null;
let lastRunAt: string | null = null;

export function isLiveMrmsAlertEnabled(): boolean {
  if (process.env.HAIL_YES_LIVE_MRMS_ALERT === '1') return true;
  return process.env.NODE_ENV === 'production';
}

export function getLiveMrmsAlertStatus(): {
  active: boolean;
  runs: number;
  firedTotal: number;
  lastError: string | null;
  lastRunAt: string | null;
  states: Array<{ state: string; lastAlertedBand: number; lastSignalAt: string | null }>;
} {
  return {
    active,
    runs,
    firedTotal,
    lastError,
    lastRunAt,
    states: [...memory.entries()].map(([state, m]) => ({
      state,
      lastAlertedBand: m.lastAlertedBand,
      lastSignalAt: m.lastSignalAt > 0 ? new Date(m.lastSignalAt).toISOString() : null,
    })),
  };
}

export function startLiveMrmsAlertWorker(): void {
  if (active) return;
  if (!isLiveMrmsAlertEnabled()) {
    console.log('[live-mrms-alert] disabled (set HAIL_YES_LIVE_MRMS_ALERT=1 to enable)');
    return;
  }
  active = true;
  setTimeout(() => {
    void runLoop();
  }, INITIAL_DELAY_MS);
  console.log('[live-mrms-alert] worker scheduled');
}

async function runLoop(): Promise<void> {
  if (!active) return;
  try {
    await pollAndFan();
  } catch (err) {
    lastError = (err as Error).message;
    console.error('[live-mrms-alert] poll failed:', err);
  }
  setTimeout(() => {
    void runLoop();
  }, POLL_INTERVAL_MS);
}

async function pollAndFan(): Promise<void> {
  runs += 1;
  lastRunAt = new Date().toISOString();
  const now = Date.now();

  for (const territory of FOCUS_TERRITORIES) {
    const bbox: BoundingBox = territory.bounds;
    const collection = await buildMrmsNowVectorPolygons(bbox);
    if (!collection || collection.features.length === 0) continue;

    const maxInches = collection.metadata.maxHailInches;
    if (maxInches < HAIL_BAND_THRESHOLDS_INCHES[0]) continue;

    // Find the highest band index crossed.
    let bandIndex = -1;
    for (let i = 0; i < HAIL_BAND_THRESHOLDS_INCHES.length; i += 1) {
      if (maxInches >= HAIL_BAND_THRESHOLDS_INCHES[i]) bandIndex = i;
    }
    if (bandIndex < 0) continue;

    for (const stateCode of territory.stateCodes) {
      const mem = memory.get(stateCode) ?? {
        lastAlertedBand: -1,
        lastSignalAt: 0,
      };

      // Reset if quiet for too long.
      if (mem.lastSignalAt > 0 && now - mem.lastSignalAt > MAX_QUIET_MINUTES * 60 * 1000) {
        mem.lastAlertedBand = -1;
      }
      mem.lastSignalAt = now;

      if (bandIndex > mem.lastAlertedBand) {
        const alertId = `mrms-${stateCode}-${HAIL_BAND_THRESHOLDS_INCHES[bandIndex]}-${new Date().toISOString().slice(0, 10)}`;
        const subs = await listSubscriptionsForStates({
          states: [stateCode],
          alertId,
        }).catch(() => []);
        const fired = await fanOut({
          subs,
          stateCode,
          bandLabel: `${HAIL_BAND_THRESHOLDS_INCHES[bandIndex].toFixed(2)}"`,
          maxInches,
          territoryName: territory.name,
          alertId,
        });
        firedTotal += fired;
        mem.lastAlertedBand = bandIndex;
      }
      memory.set(stateCode, mem);
    }
  }
}

async function fanOut(args: {
  subs: Awaited<ReturnType<typeof listSubscriptionsForStates>>;
  stateCode: string;
  bandLabel: string;
  maxInches: number;
  territoryName: string;
  alertId: string;
}): Promise<number> {
  if (args.subs.length === 0) return 0;
  const payload = {
    title: `🌩 Hail in ${args.territoryName}`,
    body: `Live MRMS shows ${args.maxInches.toFixed(2)}" hail in ${args.stateCode}. Open Hail Yes to see the live swath.`,
    tag: `live-mrms-${args.stateCode}-${args.bandLabel}`,
    url: `/?live=mrms&state=${args.stateCode}`,
  };
  let fired = 0;
  for (const sub of args.subs) {
    const r = await sendPushPayload(sub, payload, { alertId: args.alertId });
    if (r.ok) fired += 1;
  }
  return fired;
}
