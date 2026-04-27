/**
 * IEM Local Storm Reports backfill.
 *
 * Fills the recency gap before NCEI Storm Events publishes finalized rows.
 * Upserts IEM hail and thunderstorm-wind reports into verified_hail_events
 * with source_iem_lsr=TRUE. Hail rows also populate hail_size_inches; wind
 * rows set source_wind_context=TRUE and magnitude_type='mph'.
 *
 * Usage:
 *   npm run backfill:iem-lsr -- --days 45
 *   npm run backfill:iem-lsr -- --since 2026-04-01 --until 2026-04-27
 *   npm run backfill:iem-lsr -- --states VA,MD,PA,DE,NJ,DC,WV --days 14
 *   npm run backfill:iem-lsr -- --days 7 --dry-run
 *   npm run backfill:iem-lsr -- --days 45 --plan
 */

import { sql } from '../server/db.js';
import { fetchIemHailReports } from '../server/storm/iemHailReports.js';
import { fetchIemWindReports } from '../server/storm/iemLsr.js';
import type { WindReport } from '../server/storm/types.js';
import type { HailPointReport } from '../server/storm/spcHailReports.js';

const DEFAULT_STATES = ['VA', 'MD', 'PA', 'DE', 'NJ', 'DC', 'WV'];
const LAT_LNG_BUCKET_DECIMALS = 2;

interface Args {
  since: string;
  until: string;
  states: string[];
  dryRun: boolean;
  planOnly: boolean;
  limit: number;
  pauseMs: number;
  includeWind: boolean;
  includeHail: boolean;
}

interface LsrBackfillRow {
  eventDate: string;
  lat: number;
  lng: number;
  hailSizeInches: number;
  eventType: 'Hail' | 'Thunderstorm Wind';
  magnitude: number;
  magnitudeType: 'inches' | 'mph';
  stateCode: string | null;
  county: string | null;
  narrative: string | null;
  beginTimeUtc: string;
}

interface BackfillStats {
  datesScanned: number;
  hailFetched: number;
  windFetched: number;
  rowsKept: number;
  rowsWritten: number;
  failedDates: number;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function daysAgoDate(days: number): string {
  return isoDate(new Date(Date.now() - days * 86_400_000));
}

function parseArgs(argv: string[]): Args {
  const out: Args = {
    since: daysAgoDate(44),
    until: isoDate(new Date()),
    states: DEFAULT_STATES,
    dryRun: false,
    planOnly: false,
    limit: Number.POSITIVE_INFINITY,
    pauseMs: 350,
    includeWind: true,
    includeHail: true,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--days' && next) {
      const days = parseInt(next, 10);
      if (Number.isFinite(days) && days > 0) out.since = daysAgoDate(days - 1);
      i += 1;
    } else if (arg === '--since' && next) {
      out.since = next;
      i += 1;
    } else if (arg === '--until' && next) {
      out.until = next;
      i += 1;
    } else if (arg === '--states' && next) {
      out.states = next
        .split(',')
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean);
      i += 1;
    } else if (arg === '--dry-run') {
      out.dryRun = true;
    } else if (arg === '--plan') {
      out.planOnly = true;
    } else if (arg === '--limit' && next) {
      out.limit = parseInt(next, 10);
      i += 1;
    } else if (arg === '--pause-ms' && next) {
      out.pauseMs = Math.max(0, parseInt(next, 10) || 0);
      i += 1;
    } else if (arg === '--hail-only') {
      out.includeWind = false;
      out.includeHail = true;
    } else if (arg === '--wind-only') {
      out.includeWind = true;
      out.includeHail = false;
    }
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(out.since)) {
    throw new Error(`Invalid --since date: ${out.since}`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(out.until)) {
    throw new Error(`Invalid --until date: ${out.until}`);
  }
  if (out.since > out.until) {
    throw new Error(`--since must be <= --until (${out.since} > ${out.until})`);
  }
  if (out.states.length === 0) {
    throw new Error('--states cannot be empty');
  }
  if (!out.includeHail && !out.includeWind) {
    throw new Error('At least one of hail or wind must be enabled');
  }

  return out;
}

function eachDate(since: string, until: string): string[] {
  const dates: string[] = [];
  const cursor = new Date(`${since}T00:00:00Z`);
  const end = new Date(`${until}T00:00:00Z`);
  while (cursor <= end) {
    dates.push(isoDate(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

function easternDateKey(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

function bucketStr(n: number): string {
  return n.toFixed(LAT_LNG_BUCKET_DECIMALS);
}

function cleanState(state: string | undefined): string | null {
  const s = state?.trim().toUpperCase();
  return s && /^[A-Z]{2}$/.test(s) ? s : null;
}

function cleanText(value: string | undefined): string | null {
  const s = value?.trim();
  return s ? s : null;
}

function hailToBackfillRow(report: HailPointReport): LsrBackfillRow | null {
  const eventDate = easternDateKey(report.time);
  if (!eventDate) return null;
  if (!Number.isFinite(report.lat) || !Number.isFinite(report.lng)) return null;
  const size = Number.isFinite(report.sizeInches) && report.sizeInches > 0
    ? report.sizeInches
    : 0.5;
  return {
    eventDate,
    lat: report.lat,
    lng: report.lng,
    hailSizeInches: size,
    eventType: 'Hail',
    magnitude: size,
    magnitudeType: 'inches',
    stateCode: cleanState(report.state),
    county: cleanText(report.county),
    narrative: cleanText(report.description),
    beginTimeUtc: new Date(report.time).toISOString(),
  };
}

function windToBackfillRow(report: WindReport): LsrBackfillRow | null {
  const eventDate = easternDateKey(report.time);
  if (!eventDate) return null;
  if (!Number.isFinite(report.lat) || !Number.isFinite(report.lng)) return null;
  const gust = Number.isFinite(report.gustMph) && report.gustMph > 0
    ? report.gustMph
    : 60;
  return {
    eventDate,
    lat: report.lat,
    lng: report.lng,
    hailSizeInches: 0,
    eventType: 'Thunderstorm Wind',
    magnitude: gust,
    magnitudeType: 'mph',
    stateCode: cleanState(report.state),
    county: cleanText(report.county),
    narrative: cleanText(report.description),
    beginTimeUtc: new Date(report.time).toISOString(),
  };
}

async function upsertRows(rows: LsrBackfillRow[]): Promise<number> {
  let written = 0;
  for (const row of rows) {
    await sql`
      INSERT INTO verified_hail_events (
        event_date, lat, lng, lat_bucket, lng_bucket,
        hail_size_inches, source_iem_lsr, source_wind_context,
        event_type, magnitude, magnitude_type,
        state_code, county, narrative,
        begin_time_utc, end_time_utc
      ) VALUES (
        ${row.eventDate}::date, ${row.lat}, ${row.lng},
        ${bucketStr(row.lat)}, ${bucketStr(row.lng)},
        ${row.hailSizeInches},
        TRUE,
        ${row.eventType === 'Thunderstorm Wind'},
        ${row.eventType}, ${row.magnitude}, ${row.magnitudeType},
        ${row.stateCode}, ${row.county}, ${row.narrative},
        ${row.beginTimeUtc}::timestamptz,
        ${row.beginTimeUtc}::timestamptz
      )
      ON CONFLICT (event_date, lat_bucket, lng_bucket, event_type)
      DO UPDATE SET
        hail_size_inches = GREATEST(
          verified_hail_events.hail_size_inches,
          EXCLUDED.hail_size_inches
        ),
        source_iem_lsr = TRUE,
        source_wind_context = (
          verified_hail_events.source_wind_context
          OR EXCLUDED.source_wind_context
        ),
        magnitude = GREATEST(
          COALESCE(verified_hail_events.magnitude, 0),
          COALESCE(EXCLUDED.magnitude, 0)
        ),
        magnitude_type = COALESCE(verified_hail_events.magnitude_type, EXCLUDED.magnitude_type),
        state_code = COALESCE(verified_hail_events.state_code, EXCLUDED.state_code),
        county = COALESCE(verified_hail_events.county, EXCLUDED.county),
        narrative = COALESCE(verified_hail_events.narrative, EXCLUDED.narrative),
        begin_time_utc = COALESCE(verified_hail_events.begin_time_utc, EXCLUDED.begin_time_utc),
        end_time_utc = COALESCE(verified_hail_events.end_time_utc, EXCLUDED.end_time_utc),
        updated_at = NOW()
    `;
    written += 1;
  }
  return written;
}

function sleep(ms: number): Promise<void> {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

async function backfillDate(date: string, args: Args): Promise<{
  hailReports: HailPointReport[];
  windReports: WindReport[];
  rows: LsrBackfillRow[];
}> {
  const [hailReports, windReports] = await Promise.all([
    args.includeHail
      ? fetchIemHailReports({ date, states: args.states }).catch(() => [])
      : Promise.resolve([]),
    args.includeWind
      ? fetchIemWindReports({ date, states: args.states }).catch(() => [])
      : Promise.resolve([]),
  ]);

  const rows = [
    ...hailReports.map(hailToBackfillRow),
    ...windReports.map(windToBackfillRow),
  ].filter((row): row is LsrBackfillRow => row !== null);

  return { hailReports, windReports, rows };
}

async function run(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const dates = eachDate(args.since, args.until);
  console.log(
    `[iem-lsr] ${args.since}..${args.until} dates=${dates.length} states=${args.states.join(',')} ` +
      `mode=${args.includeHail ? 'hail' : ''}${args.includeWind ? '+wind' : ''} ` +
      `dryRun=${args.dryRun} plan=${args.planOnly}`,
  );

  if (args.planOnly) {
    for (const date of dates.slice(0, Number.isFinite(args.limit) ? args.limit : dates.length)) {
      console.log(`  ${date} planned`);
    }
    return;
  }

  if (!args.dryRun) {
    await sql`SELECT 1`;
  }

  const stats: BackfillStats = {
    datesScanned: 0,
    hailFetched: 0,
    windFetched: 0,
    rowsKept: 0,
    rowsWritten: 0,
    failedDates: 0,
  };

  for (const date of dates) {
    if (stats.rowsKept >= args.limit) break;
    stats.datesScanned += 1;
    try {
      const result = await backfillDate(date, args);
      stats.hailFetched += result.hailReports.length;
      stats.windFetched += result.windReports.length;

      const remaining = args.limit - stats.rowsKept;
      const rows = result.rows.slice(0, Number.isFinite(remaining) ? remaining : undefined);
      stats.rowsKept += rows.length;

      if (!args.dryRun && rows.length > 0) {
        stats.rowsWritten += await upsertRows(rows);
      }

      console.log(
        `  ${date} hail=${result.hailReports.length} wind=${result.windReports.length} ` +
          `kept=${rows.length}${args.dryRun ? ' DRY' : ''}`,
      );
    } catch (err) {
      stats.failedDates += 1;
      console.warn(`  ${date} FAILED:`, (err as Error).message);
    }
    await sleep(args.pauseMs);
  }

  console.log(
    `[iem-lsr] done dates=${stats.datesScanned} hail=${stats.hailFetched} wind=${stats.windFetched} ` +
      `kept=${stats.rowsKept} written=${stats.rowsWritten} failedDates=${stats.failedDates}`,
  );

  if (!args.dryRun) {
    const count = await sql<Array<{ n: string }>>`
      SELECT COUNT(*) AS n
        FROM verified_hail_events
       WHERE source_iem_lsr = TRUE
    `;
    console.log(`verified_hail_events rows with source_iem_lsr=TRUE: ${count[0]?.n ?? 0}`);
    await sql.end({ timeout: 5 });
  }
}

run().catch(async (err) => {
  console.error('[iem-lsr] fatal:', err);
  await sql.end({ timeout: 5 }).catch(() => undefined);
  process.exit(1);
});
