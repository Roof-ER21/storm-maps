/**
 * Background scheduler for cache pre-warming.
 *
 * On app boot we kick off a delayed initial warm (so the server can finish
 * accepting traffic first), then refresh every PREWARM_INTERVAL_MS. Disabled
 * by default in dev — set HAIL_YES_PREWARM=1 (or production NODE_ENV) to
 * enable.
 *
 * What gets warmed:
 *   - Wind swath collections for the last 30 days × 3 regions (VA / MD+DC / PA)
 *   - Storm-event aggregator for the same regions at 12-month range
 *
 * Why both:
 *   The wind cache is only useful if the rep has the wind layer on — but the
 *   event cache is hit by every property search. Pre-warming both means the
 *   first rep of the morning never waits for SPC/IEM round-trips.
 *
 * Cost: ~30 wind dates × 3 regions = 90 fetches every refresh, sub-1MB total
 * payload. We throttle to 1 fetch in flight at a time so we don't hammer
 * SPC/IEM during the warm cycle.
 */

import { buildWindSwathCollection } from './windSwathService.js';
import { buildMrmsVectorPolygons } from './mrmsService.js';
import { fetchStormEventsCached } from './eventService.js';
import { fetchSpcHailReportsForDate } from './spcHailReports.js';
import { buildConsilience } from './consilienceService.js';
import { sql as pgSql } from '../db.js';
import type { BoundingBox } from './types.js';

const FOCUS_STATES = ['VA', 'MD', 'PA', 'WV', 'DC', 'DE', 'NJ'];

interface WarmRegion {
  name: string;
  bounds: BoundingBox;
  // Center used for the event-cache prewarm (the property-search shape needs
  // a single lat/lng + radius).
  center: { lat: number; lng: number };
  radiusMiles: number;
}

const REGIONS: WarmRegion[] = [
  {
    name: 'VA',
    bounds: { north: 39.5, south: 36.4, east: -75.1, west: -83.7 },
    center: { lat: 38.0, lng: -78.5 },
    radiusMiles: 200,
  },
  {
    name: 'MD+DC',
    bounds: { north: 39.8, south: 37.8, east: -75.0, west: -79.5 },
    center: { lat: 39.0, lng: -76.7 },
    radiusMiles: 120,
  },
  {
    name: 'PA',
    bounds: { north: 42.4, south: 39.6, east: -74.6, west: -80.6 },
    center: { lat: 40.9, lng: -77.5 },
    radiusMiles: 200,
  },
  {
    name: 'DE',
    bounds: { north: 39.95, south: 38.4, east: -74.95, west: -75.85 },
    center: { lat: 39.05, lng: -75.45 },
    radiusMiles: 60,
  },
  {
    name: 'NJ',
    bounds: { north: 41.4, south: 38.85, east: -73.85, west: -75.6 },
    center: { lat: 40.1, lng: -74.65 },
    radiusMiles: 110,
  },
];

const PREWARM_DAYS = 30;
const PREWARM_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
const PREWARM_INITIAL_DELAY_MS = 60 * 1000; // 60s after boot
const PREWARM_PAUSE_BETWEEN_FETCH_MS = 250; // throttle upstream load

function easternDateKey(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

let cyclesRun = 0;
let lastCycleStartedAt: string | null = null;
let lastCycleFinishedAt: string | null = null;
let lastCycleStats = {
  warmedSwath: 0,
  warmedHail: 0,
  warmedEvents: 0,
  warmedHotProperties: 0,
  hailDatesScanned: 0,
  errors: 0,
};

export interface PrewarmStatus {
  enabled: boolean;
  cyclesRun: number;
  lastCycleStartedAt: string | null;
  lastCycleFinishedAt: string | null;
  lastCycleStats: typeof lastCycleStats;
  intervalMs: number;
}

export function getPrewarmStatus(enabled: boolean): PrewarmStatus {
  return {
    enabled,
    cyclesRun,
    lastCycleStartedAt,
    lastCycleFinishedAt,
    lastCycleStats: { ...lastCycleStats },
    intervalMs: PREWARM_INTERVAL_MS,
  };
}

interface HotProperty {
  lat: number;
  lng: number;
  radius_miles: number | null;
  history_preset: string | null;
}

/**
 * Hot-properties pre-warm: top 25 most-recently-used property searches in
 * VA/MD/PA. The list comes from the `properties` table (rep-pinned). Cached
 * entries here mean the second rep to look up the same address gets the
 * full storm history in <50 ms.
 */
async function readHotProperties(): Promise<HotProperty[]> {
  if (!pgSql) return [];
  try {
    const rows = await pgSql<HotProperty[]>`
      SELECT lat, lng, radius_miles, history_preset
        FROM properties
       WHERE lat BETWEEN 36 AND 43
         AND lng BETWEEN -84 AND -74
         AND updated_at > NOW() - INTERVAL '30 days'
       ORDER BY updated_at DESC
       LIMIT 25
    `;
    return rows;
  } catch (err) {
    console.warn('[prewarm] hot-properties read failed', err);
    return [];
  }
}

function monthsForPreset(preset: string | null): number {
  switch (preset) {
    case '10y':
      return 120;
    case '5y':
      return 60;
    case '2y':
      return 24;
    case '1y':
    default:
      return 12;
  }
}

function reportInBounds(
  r: { lat: number; lng: number },
  bounds: BoundingBox,
): boolean {
  return (
    r.lat <= bounds.north &&
    r.lat >= bounds.south &&
    r.lng <= bounds.east &&
    r.lng >= bounds.west
  );
}

async function runPrewarmCycle(): Promise<void> {
  lastCycleStartedAt = new Date().toISOString();
  const cycleStats = {
    warmedSwath: 0,
    warmedHail: 0,
    warmedEvents: 0,
    warmedHotProperties: 0,
    hailDatesScanned: 0,
    errors: 0,
  };

  // Wind swaths — 30 days × 3 regions.
  for (let dayOffset = 0; dayOffset < PREWARM_DAYS; dayOffset += 1) {
    const target = new Date(Date.now() - dayOffset * 86_400_000);
    const date = easternDateKey(target);
    for (const region of REGIONS) {
      try {
        const collection = await buildWindSwathCollection({
          date,
          bounds: region.bounds,
          states: FOCUS_STATES,
          includeLive: false,
        });
        if (collection.metadata.reportCount > 0) {
          cycleStats.warmedSwath += 1;
        }
      } catch (err) {
        cycleStats.errors += 1;
        console.warn(`[prewarm] wind ${date} ${region.name} failed`, err);
      }
      await sleep(PREWARM_PAUSE_BETWEEN_FETCH_MS);
    }
  }

  // Hail swaths — only days with reported hail get the GRIB pipeline run.
  // Walk back 30 days, query SPC for the date, and warm only the regions
  // that actually had reports inside the bbox. Saves ~80% of GRIB downloads
  // on quiet weeks while keeping the morning-standup experience instant.
  for (let dayOffset = 0; dayOffset < PREWARM_DAYS; dayOffset += 1) {
    const target = new Date(Date.now() - dayOffset * 86_400_000);
    const date = easternDateKey(target);
    cycleStats.hailDatesScanned += 1;
    const reports = await fetchSpcHailReportsForDate(date).catch(
      () => [] as Array<{ lat: number; lng: number }>,
    );
    if (reports.length === 0) continue;
    for (const region of REGIONS) {
      const inRegion = reports.some((r) => reportInBounds(r, region.bounds));
      if (!inRegion) continue;
      try {
        const collection = await buildMrmsVectorPolygons({
          date,
          bounds: region.bounds,
        });
        if (collection && collection.features.length > 0) {
          cycleStats.warmedHail += 1;
        }
      } catch (err) {
        cycleStats.errors += 1;
        console.warn(`[prewarm] hail ${date} ${region.name} failed`, err);
      }
      await sleep(PREWARM_PAUSE_BETWEEN_FETCH_MS);
    }
  }

  // Event cache — one entry per region at 12-month range. The cache key
  // quantizes lat/lng to 0.01° so reps near these centers all share the hit.
  for (const region of REGIONS) {
    try {
      const result = await fetchStormEventsCached({
        lat: region.center.lat,
        lng: region.center.lng,
        radiusMiles: region.radiusMiles,
        months: 12,
        sinceDate: null,
        states: FOCUS_STATES,
      });
      if (result.metadata.eventCount > 0) {
        cycleStats.warmedEvents += 1;
      }
    } catch (err) {
      cycleStats.errors += 1;
      console.warn(`[prewarm] events ${region.name} failed`, err);
    }
    await sleep(PREWARM_PAUSE_BETWEEN_FETCH_MS);
  }

  // Hot properties — the addresses reps actually canvass. Read from the
  // `properties` table (recent activity, focus territory bbox).
  const hotProperties = await readHotProperties();
  for (const p of hotProperties) {
    try {
      const result = await fetchStormEventsCached({
        lat: p.lat,
        lng: p.lng,
        radiusMiles: p.radius_miles ?? 35,
        months: monthsForPreset(p.history_preset),
        sinceDate: null,
        states: FOCUS_STATES,
      });
      if (result.metadata.eventCount > 0) {
        cycleStats.warmedHotProperties += 1;
      }
    } catch (err) {
      cycleStats.errors += 1;
      console.warn(`[prewarm] hot-property ${p.lat},${p.lng} failed`, err);
    }
    await sleep(PREWARM_PAUSE_BETWEEN_FETCH_MS);
  }

  // Consilience prewarm — for each hot property, pre-compute the 10-source
  // corroboration for the top storm dates that turned up in NCEI history.
  // Persisted to consilience_cache so dashboard reads are sub-50ms instead
  // of 3-8s of concurrent network fetches per render.
  //
  // Bias:
  //   1. VA/MD/PA properties first (Roof-ER's main territories — see memory
  //      `cc21-phase19-roolink-gap.md` for region scope)
  //   2. Per-property dates filtered to Hail / Thunderstorm Wind / Tornado
  //      (skip Funnel Cloud — not insurance-actionable on its own)
  //   3. Cap at 30 properties × 4 dates = 120 (date,property) pairs/cycle
  const consiliencePrewarmCap = 30;
  const datesPerProperty = 4;

  // Sort hot properties so VA/MD/PA come first. The properties table doesn't
  // have a state_code field, so use coarse lat/lng bbox tests against the
  // FOCUS_TERRITORIES centers.
  const isInPriorityState = (lat: number, lng: number): boolean => {
    // VA: 36.4-39.5, -83.7 to -75.1
    if (lat >= 36.4 && lat <= 39.5 && lng >= -83.7 && lng <= -75.1) return true;
    // MD+DC: 37.8-39.8, -79.5 to -75.0
    if (lat >= 37.8 && lat <= 39.8 && lng >= -79.5 && lng <= -75.0) return true;
    // PA: 39.6-42.4, -80.6 to -74.6
    if (lat >= 39.6 && lat <= 42.4 && lng >= -80.6 && lng <= -74.6) return true;
    return false;
  };
  const prioritizedProps = [...hotProperties].sort((a, b) => {
    const aP = isInPriorityState(a.lat, a.lng) ? 0 : 1;
    const bP = isInPriorityState(b.lat, b.lng) ? 0 : 1;
    return aP - bP;
  });

  let consilienceWarmed = 0;
  let consilienceCertified = 0;
  for (const p of prioritizedProps.slice(0, consiliencePrewarmCap)) {
    if (!pgSql) break;
    try {
      // Pull dates with Hail or insurance-actionable Wind events near this
      // property. Order by date DESC to surface "Latest Hits" the dashboard
      // shows; could change to magnitude DESC if the dashboard pivots to
      // "biggest storms" mode.
      const dateRows = await pgSql<Array<{ event_date: string | Date }>>`
        SELECT DISTINCT event_date
          FROM verified_hail_events
         WHERE source_ncei_storm_events = TRUE
           AND event_type IN ('Hail', 'Thunderstorm Wind', 'Tornado')
           AND lat BETWEEN ${p.lat - 0.5} AND ${p.lat + 0.5}
           AND lng BETWEEN ${p.lng - 0.5} AND ${p.lng + 0.5}
         ORDER BY event_date DESC
         LIMIT ${datesPerProperty}
      `;
      for (const row of dateRows) {
        const dateStr =
          row.event_date instanceof Date
            ? row.event_date.toISOString().slice(0, 10)
            : String(row.event_date).slice(0, 10);
        try {
          // skipCache=true so we always re-compute (refreshing the cache).
          // persist defaults to true so the result is written back.
          const r = await buildConsilience(
            { lat: p.lat, lng: p.lng, date: dateStr, radiusMiles: 5 },
            { skipCache: true },
          );
          consilienceWarmed += 1;
          if (r.confirmedCount >= 3) consilienceCertified += 1;
        } catch (err) {
          cycleStats.errors += 1;
          console.warn(`[prewarm] consilience ${p.lat},${p.lng} ${dateStr} failed`, err);
        }
        await sleep(PREWARM_PAUSE_BETWEEN_FETCH_MS);
      }
    } catch (err) {
      cycleStats.errors += 1;
      console.warn(`[prewarm] consilience hot-property ${p.lat},${p.lng} failed`, err);
    }
  }
  if (consilienceWarmed > 0) {
    console.log(
      `[prewarm] consilience warmed ${consilienceWarmed} pairs (${consilienceCertified} certified ≥3/10)`,
    );
  }

  lastCycleStats = cycleStats;
  lastCycleFinishedAt = new Date().toISOString();
  cyclesRun += 1;
  console.log(
    `[prewarm] cycle ${cyclesRun} done — ` +
      `wind=${cycleStats.warmedSwath} ` +
      `hail=${cycleStats.warmedHail}/${cycleStats.hailDatesScanned}d ` +
      `events=${cycleStats.warmedEvents} ` +
      `hot=${cycleStats.warmedHotProperties} ` +
      `errors=${cycleStats.errors}`,
  );
}

let timer: ReturnType<typeof setInterval> | null = null;

/**
 * Idempotent — calling start() twice is a no-op.
 *
 * The scheduler is opt-in via either:
 *   - HAIL_YES_PREWARM=1 (explicit)
 *   - NODE_ENV=production (implicit; production deploys want warm caches)
 *
 * Dev environments can opt out by leaving NODE_ENV unset.
 */
export function startPrewarmScheduler(): boolean {
  if (timer) return true;
  const enabled =
    process.env.HAIL_YES_PREWARM === '1' ||
    process.env.NODE_ENV === 'production';
  if (!enabled) {
    console.log('[prewarm] scheduler disabled (set HAIL_YES_PREWARM=1 to enable)');
    return false;
  }

  console.log(
    `[prewarm] scheduler starting — initial warm in ${
      PREWARM_INITIAL_DELAY_MS / 1000
    }s, refresh every ${PREWARM_INTERVAL_MS / 60_000} min`,
  );

  setTimeout(() => {
    void runPrewarmCycle();
  }, PREWARM_INITIAL_DELAY_MS).unref();

  timer = setInterval(() => {
    void runPrewarmCycle();
  }, PREWARM_INTERVAL_MS);
  timer.unref();
  return true;
}

export function stopPrewarmScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
