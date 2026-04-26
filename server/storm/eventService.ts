/**
 * Server-side storm event aggregator with Postgres-backed caching.
 *
 * Mirrors the multi-source fetch the frontend does today, but runs server-side
 * so the result can be cached in `event_cache` and shared across reps.
 *
 * Sources:
 *   - SPC same-day / yesterday / archive hail + wind CSVs
 *   - IEM Local Storm Reports (hail + wind)
 *
 * Output is a deduped `StormEvent`-shaped list, matching what the frontend
 * already feeds into `useStormData` — no client-side type changes required.
 */

import crypto from 'crypto';
import { sql as pgSql } from '../db.js';
import { fetchSpcWindReports } from './spcReports.js';
import { fetchIemWindReports } from './iemLsr.js';
import { fetchSpcHailReportsForDate, type HailPointReport } from './spcHailReports.js';
import { fetchIemHailReports } from './iemHailReports.js';
import type { WindReport } from './types.js';

// ---------------------------------------------------------------------------
// StormEvent shape — kept structurally compatible with src/types/storm.ts
// ---------------------------------------------------------------------------

export interface StormEventDto {
  id: string;
  eventType: 'Hail' | 'Thunderstorm Wind' | 'Tornado' | 'Flash Flood';
  state: string;
  county: string;
  beginDate: string;
  endDate: string;
  beginLat: number;
  beginLon: number;
  endLat: number;
  endLon: number;
  magnitude: number;
  magnitudeType: string;
  damageProperty: number;
  source: string;
  narrative: string;
}

export interface StormEventResponse {
  events: StormEventDto[];
  sources: string[];
  metadata: {
    lat: number;
    lng: number;
    radiusMiles: number;
    months: number;
    sinceDate: string | null;
    eventCount: number;
    generatedAt: string;
    cached: boolean;
    cacheAgeSeconds?: number;
  };
}


// ---------------------------------------------------------------------------
// Aggregation + dedupe + cache
// ---------------------------------------------------------------------------

const EARTH_R_MI = 3958.8;
function distanceMiles(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const sLat = Math.sin(dLat / 2);
  const sLng = Math.sin(dLng / 2);
  const h =
    sLat * sLat +
    Math.cos((a.lat * Math.PI) / 180) *
      Math.cos((b.lat * Math.PI) / 180) *
      sLng * sLng;
  return EARTH_R_MI * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function hailReportToEvent(r: HailPointReport): StormEventDto {
  return {
    id: r.id,
    eventType: 'Hail',
    state: r.state ?? '',
    county: r.county ?? '',
    beginDate: r.time,
    endDate: r.time,
    beginLat: r.lat,
    beginLon: r.lng,
    endLat: r.lat,
    endLon: r.lng,
    magnitude: r.sizeInches,
    magnitudeType: 'inches',
    damageProperty: 0,
    source: r.source,
    narrative: r.description ?? '',
  };
}

function windReportToEvent(r: WindReport): StormEventDto {
  return {
    id: r.id,
    eventType: 'Thunderstorm Wind',
    state: r.state ?? '',
    county: r.county ?? '',
    beginDate: r.time,
    endDate: r.time,
    beginLat: r.lat,
    beginLon: r.lng,
    endLat: r.lat,
    endLon: r.lng,
    magnitude: r.gustMph,
    magnitudeType: 'mph',
    damageProperty: 0,
    source: r.source === 'IEM-LSR' ? 'IEM LSR' : r.source === 'NWS-SVR' ? 'NWS SVR' : 'SPC',
    narrative: r.description ?? '',
  };
}

/**
 * Same dedupe rule as the frontend now uses: 0.7 mi + 90 minutes collapses
 * cross-source / cross-midnight reports of the same physical storm cell.
 */
function dedupeEvents(events: StormEventDto[]): StormEventDto[] {
  const sorted = [...events].sort(
    (a, b) => Date.parse(b.beginDate) - Date.parse(a.beginDate),
  );
  const kept: StormEventDto[] = [];
  for (const event of sorted) {
    const t = Date.parse(event.beginDate);
    if (Number.isNaN(t)) continue;
    const dupIdx = kept.findIndex((existing) => {
      if (existing.eventType !== event.eventType) return false;
      if (Math.abs(existing.beginLat - event.beginLat) > 0.01) return false;
      if (Math.abs(existing.beginLon - event.beginLon) > 0.01) return false;
      const dt = Math.abs(Date.parse(existing.beginDate) - t) / 60_000;
      return dt <= 90;
    });
    if (dupIdx === -1) {
      kept.push(event);
    } else {
      const existing = kept[dupIdx];
      kept[dupIdx] = {
        ...existing,
        magnitude: Math.max(existing.magnitude, event.magnitude),
        narrative:
          event.narrative.length > existing.narrative.length
            ? event.narrative
            : existing.narrative,
      };
    }
  }
  return kept;
}

interface FetchEventsParams {
  lat: number;
  lng: number;
  radiusMiles: number;
  months: number;
  sinceDate: string | null;
  states?: string[];
}

function buildCacheKey(p: FetchEventsParams): string {
  // Quantize lat/lng to 0.01° (~0.7 mi) so two reps querying nearly the same
  // point share an entry.
  const latQ = Math.round(p.lat * 100) / 100;
  const lngQ = Math.round(p.lng * 100) / 100;
  const radiusQ = Math.round(p.radiusMiles);
  const raw = [
    latQ.toFixed(2),
    lngQ.toFixed(2),
    radiusQ,
    p.months,
    p.sinceDate ?? '',
    (p.states ?? []).slice().sort().join(','),
  ].join('|');
  return crypto.createHash('sha1').update(raw).digest('hex').slice(0, 24);
}

function pickEventCacheTtlMs(p: FetchEventsParams): number {
  // The cache invalidates earlier when the rep is asking about the most-recent
  // window because SPC/LSR publish revisions for ~24h after a storm.
  if (p.months <= 1) return 30 * 60 * 1000; // 30 min
  if (p.months <= 6) return 6 * 60 * 60 * 1000; // 6 hr
  return 24 * 60 * 60 * 1000; // 1 day
}

interface EventCacheRow {
  payload: { events: StormEventDto[]; sources: string[] };
  generated_at: string | Date;
  expires_at: string | Date;
}

async function readEventCache(
  key: string,
): Promise<{ payload: { events: StormEventDto[]; sources: string[] }; ageSeconds: number } | null> {
  if (!pgSql) return null;
  try {
    const rows = await pgSql<EventCacheRow[]>`
      SELECT payload, generated_at, expires_at
        FROM event_cache
       WHERE cache_key = ${key}
         AND expires_at > NOW()
       LIMIT 1
    `;
    const row = rows[0];
    if (!row) return null;
    const ageSeconds = Math.floor(
      (Date.now() - new Date(row.generated_at).getTime()) / 1000,
    );
    return { payload: row.payload, ageSeconds };
  } catch (err) {
    console.warn('[event-cache] read failed', err);
    return null;
  }
}

async function writeEventCache(
  key: string,
  p: FetchEventsParams,
  payload: { events: StormEventDto[]; sources: string[] },
): Promise<void> {
  if (!pgSql) return;
  const ttl = pickEventCacheTtlMs(p);
  const expiresAt = new Date(Date.now() + ttl);
  try {
    // postgres.js v3 tagged-template parameter binding rejects pgSql.json()
    // wrappers ("argument must be string... got Object"). Pass JSON-stringified
    // text and explicitly cast to jsonb in SQL — Postgres parses it correctly.
    const payloadJson = JSON.stringify(payload);
    await pgSql`
      INSERT INTO event_cache (
        cache_key, lat_q, lng_q, radius_miles, months, since_date,
        payload, event_count, expires_at
      ) VALUES (
        ${key},
        ${Math.round(p.lat * 100) / 100},
        ${Math.round(p.lng * 100) / 100},
        ${p.radiusMiles},
        ${p.months},
        ${p.sinceDate},
        ${payloadJson}::jsonb,
        ${payload.events.length},
        ${expiresAt}
      )
      ON CONFLICT (cache_key)
      DO UPDATE SET
        payload = EXCLUDED.payload,
        event_count = EXCLUDED.event_count,
        generated_at = NOW(),
        expires_at = EXCLUDED.expires_at
    `;
  } catch (err) {
    console.warn('[event-cache] write failed', err);
  }
}

/**
 * Fetch storm events with cache. Returns within <50ms when the cache is warm,
 * otherwise ~3–8s while the upstream sources respond.
 */
export async function fetchStormEventsCached(
  params: FetchEventsParams,
): Promise<StormEventResponse> {
  const key = buildCacheKey(params);
  const hit = await readEventCache(key);
  if (hit) {
    return {
      events: hit.payload.events,
      sources: hit.payload.sources,
      metadata: {
        lat: params.lat,
        lng: params.lng,
        radiusMiles: params.radiusMiles,
        months: params.months,
        sinceDate: params.sinceDate,
        eventCount: hit.payload.events.length,
        generatedAt: new Date().toISOString(),
        cached: true,
        cacheAgeSeconds: hit.ageSeconds,
      },
    };
  }

  // Walk back day-by-day so we cover the requested window. SPC archives cover
  // ~7 days reliably; older days may return 0 reports — that's fine, we just
  // skip them.
  const sinceMs = params.sinceDate
    ? Date.parse(`${params.sinceDate}T00:00:00Z`)
    : Date.now() - params.months * 30 * 86_400_000;
  const days = Math.min(
    180, // safety cap so a "since 5y" query doesn't fetch 1800 SPC files
    Math.max(1, Math.ceil((Date.now() - sinceMs) / 86_400_000)),
  );

  const dateKeys: string[] = [];
  for (let i = 0; i < days; i += 1) {
    const d = new Date(Date.now() - i * 86_400_000);
    dateKeys.push(d.toISOString().slice(0, 10));
  }

  const sources = new Set<string>();
  const allEvents: StormEventDto[] = [];

  // SPC same-day/yesterday/archive — both hail and wind in parallel.
  const spcResults = await Promise.allSettled(
    dateKeys.flatMap((d) => [
      fetchSpcHailReportsForDate(d).then((r) => ({ kind: 'hail', reports: r })),
      fetchSpcWindReports(d).then((r) => ({ kind: 'wind', reports: r })),
    ]),
  );
  for (const result of spcResults) {
    if (result.status !== 'fulfilled') continue;
    const { kind, reports } = result.value;
    if (reports.length === 0) continue;
    sources.add('SPC');
    for (const r of reports) {
      allEvents.push(
        kind === 'hail'
          ? hailReportToEvent(r as HailPointReport)
          : windReportToEvent(r as WindReport),
      );
    }
  }

  // IEM LSR — span query of the whole window in one call.
  const startIso = new Date(sinceMs).toISOString();
  const endIso = new Date().toISOString();
  const [iemHail, iemWind] = await Promise.all([
    fetchIemHailReports({ startIso, endIso, states: params.states }).catch(() => []),
    fetchIemWindReports({
      date: endIso.slice(0, 10),
      bounds: null,
      states: params.states,
    }).catch(() => []),
  ]);
  if (iemHail.length > 0) sources.add('IEM-LSR');
  if (iemWind.length > 0) sources.add('IEM-LSR');
  for (const r of iemHail) allEvents.push(hailReportToEvent(r));
  for (const r of iemWind) allEvents.push(windReportToEvent(r));

  // Radius filter (sources don't accept lat/lng filtering directly).
  const center = { lat: params.lat, lng: params.lng };
  const inRadius = allEvents.filter(
    (e) =>
      distanceMiles(center, { lat: e.beginLat, lng: e.beginLon }) <=
      params.radiusMiles,
  );
  const deduped = dedupeEvents(inRadius);

  const payload = { events: deduped, sources: [...sources] };
  await writeEventCache(key, params, payload);

  return {
    events: deduped,
    sources: payload.sources,
    metadata: {
      lat: params.lat,
      lng: params.lng,
      radiusMiles: params.radiusMiles,
      months: params.months,
      sinceDate: params.sinceDate,
      eventCount: deduped.length,
      generatedAt: new Date().toISOString(),
      cached: false,
    },
  };
}
