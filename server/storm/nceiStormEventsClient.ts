/**
 * NCEI Storm Events Database — DB-backed read for consilience.
 *
 * Reads from verified_hail_events where source_ncei_storm_events=TRUE.
 * The data lands in this table via scripts/ncei-backfill.ts (run separately,
 * not at request time). This client just queries the warm table — sub-50ms
 * vs the live CSV download path.
 *
 * Why this matters for consilience: NCEI is the OFFICIAL NOAA archive that
 * insurance adjusters cite. When it confirms an event, that's the strongest
 * possible signal short of an in-person inspection.
 */

import { sql as pgSql } from '../db.js';

export interface NceiEvent {
  id: number;
  ncei_event_id: number | null;
  episode_id: number | null;
  event_type: string;
  event_date: string;
  state_code: string | null;
  county: string | null;
  wfo: string | null;
  lat: number;
  lng: number;
  magnitude: number | null;
  magnitude_type: string | null;
  narrative: string | null;
  begin_time_utc: string | null;
  end_time_utc: string | null;
}

interface NceiRow {
  id: number;
  ncei_event_id: string | null; // BIGINT comes back as string
  episode_id: string | null;
  event_type: string | null;
  event_date: string | Date;
  state_code: string | null;
  county: string | null;
  wfo: string | null;
  lat: number;
  lng: number;
  magnitude: number | null;
  magnitude_type: string | null;
  narrative: string | null;
  begin_time_utc: string | Date | null;
  end_time_utc: string | Date | null;
}

function rowToEvent(r: NceiRow): NceiEvent {
  const dateStr =
    r.event_date instanceof Date
      ? r.event_date.toISOString().slice(0, 10)
      : String(r.event_date).slice(0, 10);
  return {
    id: r.id,
    ncei_event_id: r.ncei_event_id ? Number(r.ncei_event_id) : null,
    episode_id: r.episode_id ? Number(r.episode_id) : null,
    event_type: r.event_type ?? '',
    event_date: dateStr,
    state_code: r.state_code,
    county: r.county,
    wfo: r.wfo,
    lat: r.lat,
    lng: r.lng,
    magnitude: r.magnitude,
    magnitude_type: r.magnitude_type,
    narrative: r.narrative,
    begin_time_utc:
      r.begin_time_utc instanceof Date
        ? r.begin_time_utc.toISOString()
        : (r.begin_time_utc ?? null),
    end_time_utc:
      r.end_time_utc instanceof Date
        ? r.end_time_utc.toISOString()
        : (r.end_time_utc ?? null),
  };
}

/**
 * Pull NCEI events near a property on a specific Eastern date. Lat/lng box
 * is computed as (radiusMiles + 5mi pad) and a tighter haversine filter is
 * applied in JS afterward.
 */
export async function fetchNceiEventsForDateAndPoint(opts: {
  date: string;
  lat: number;
  lng: number;
  radiusMiles?: number;
}): Promise<NceiEvent[]> {
  if (!pgSql) return [];
  const radius = opts.radiusMiles ?? 5;
  const latPad = (radius + 5) / 69;
  const lngPad = (radius + 5) / (69 * Math.cos((opts.lat * Math.PI) / 180));
  const north = opts.lat + latPad;
  const south = opts.lat - latPad;
  const east = opts.lng + lngPad;
  const west = opts.lng - lngPad;

  try {
    const rows = await pgSql<NceiRow[]>`
      SELECT
        id, ncei_event_id, episode_id, event_type, event_date,
        state_code, county, wfo, lat, lng,
        magnitude, magnitude_type, narrative,
        begin_time_utc, end_time_utc
        FROM verified_hail_events
       WHERE source_ncei_storm_events = TRUE
         AND event_date = ${opts.date}::date
         AND lat BETWEEN ${south} AND ${north}
         AND lng BETWEEN ${west} AND ${east}
       LIMIT 100
    `;
    const events = rows.map(rowToEvent);
    // Tighten to true radius (haversine) — bbox can include ~1.4× area.
    return events.filter(
      (e) => haversineMiles(e.lat, e.lng, opts.lat, opts.lng) <= radius,
    );
  } catch (err) {
    console.warn(
      '[ncei-storm-events] fetch failed (table not yet migrated?):',
      (err as Error).message,
    );
    return [];
  }
}

function haversineMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3958.8;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
