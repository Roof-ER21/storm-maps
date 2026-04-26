/**
 * NCEI Storm Events Database backfill — bulk-loads the official NOAA archive
 * (the same DB insurance adjusters cite) into verified_hail_events.
 *
 * Source:
 *   https://www.ncei.noaa.gov/pub/data/swdi/stormevents/csvfiles/
 *     StormEvents_details-ftp_v1.0_d{YYYY}_c{YYYYMMDD}.csv.gz
 *
 * No API key. Yearly CSVs, gzipped (~20–80 MB). Filtered to:
 *   STATE in {VIRGINIA, MARYLAND, PENNSYLVANIA, DELAWARE, NEW JERSEY,
 *             DISTRICT OF COLUMBIA, WEST VIRGINIA}
 *   EVENT_TYPE in {Hail, Thunderstorm Wind, Tornado, Strong Wind, Marine Hail,
 *                  Funnel Cloud, High Wind}
 *   BEGIN_LAT / BEGIN_LON present (skip county-only events)
 *   MAGNITUDE >= 0.5" hail OR >= 50 mph wind (otherwise we'd ingest
 *   noise that the radar pipeline already covers)
 *
 * Usage (DO run, but with awareness — multi-MB downloads + thousands of
 * upserts per year):
 *   set -a && source .env.local && set +a
 *   npm run backfill:ncei -- --year 2025
 *   npm run backfill:ncei -- --years 2022-2025
 *   npm run backfill:ncei -- --year 2025 --dry-run   # parse but no writes
 *   npm run backfill:ncei -- --year 2025 --limit 100 # smoke-test slice
 *
 * Idempotent: ON CONFLICT (event_date, lat_bucket, lng_bucket) merges the
 * source flags + keeps the larger magnitude. Re-runs converge.
 */

import { createGunzip } from 'node:zlib';
import { Readable } from 'node:stream';
import { sql } from '../server/db.js';
import { parseCsvStream } from '../server/storm/csvStream.js';

const NCEI_BASE = 'https://www.ncei.noaa.gov/pub/data/swdi/stormevents/csvfiles/';
const FETCH_TIMEOUT_MS = 60_000;

const FOCUS_STATES = new Set([
  'VIRGINIA',
  'MARYLAND',
  'PENNSYLVANIA',
  'DELAWARE',
  'NEW JERSEY',
  'DISTRICT OF COLUMBIA',
  'WEST VIRGINIA',
]);

const STATE_TO_CODE: Record<string, string> = {
  VIRGINIA: 'VA',
  MARYLAND: 'MD',
  PENNSYLVANIA: 'PA',
  DELAWARE: 'DE',
  'NEW JERSEY': 'NJ',
  'DISTRICT OF COLUMBIA': 'DC',
  'WEST VIRGINIA': 'WV',
};

const RELEVANT_EVENT_TYPES = new Set([
  'Hail',
  'Thunderstorm Wind',
  'Tornado',
  'Strong Wind',
  'High Wind',
  'Marine Hail',
  'Funnel Cloud',
]);

interface Args {
  years: number[];
  dryRun: boolean;
  limit: number;
}

function parseArgs(argv: string[]): Args {
  const out: Args = { years: [], dryRun: false, limit: Number.POSITIVE_INFINITY };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    if (a === '--year' && next) {
      out.years.push(parseInt(next, 10));
      i++;
    } else if (a === '--years' && next) {
      const m = next.match(/^(\d{4})-(\d{4})$/);
      if (m) {
        const start = parseInt(m[1], 10);
        const end = parseInt(m[2], 10);
        for (let y = start; y <= end; y++) out.years.push(y);
      }
      i++;
    } else if (a === '--dry-run') {
      out.dryRun = true;
    } else if (a === '--limit' && next) {
      out.limit = parseInt(next, 10);
      i++;
    }
  }
  return out;
}

interface NceiRow {
  ncei_event_id: number;
  episode_id: number | null;
  event_type: string;
  state: string;
  state_code: string;
  county: string | null;
  wfo: string | null;
  begin_iso: string;
  end_iso: string;
  event_date_et: string;
  lat: number;
  lng: number;
  magnitude: number;
  magnitude_type: string | null;
  narrative: string | null;
}

/**
 * Discover the latest details file for a given year by parsing the NCEI
 * directory index HTML. Filenames look like:
 *   StormEvents_details-ftp_v1.0_d2025_c20250930.csv.gz
 * The c-suffix is the publish date — newest wins.
 */
async function findLatestDetailsUrl(year: number): Promise<string | null> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(NCEI_BASE, {
      signal: ac.signal,
      headers: { 'User-Agent': 'HailYes/1.0 (storm-intelligence-app)' },
    });
    if (!res.ok) {
      console.warn(`[ncei] index HTTP ${res.status}`);
      return null;
    }
    const html = await res.text();
    const re = new RegExp(
      `StormEvents_details-ftp_v1\\.0_d${year}_c(\\d{8})\\.csv\\.gz`,
      'g',
    );
    const matches: Array<{ filename: string; csuffix: string }> = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) {
      matches.push({ filename: m[0], csuffix: m[1] });
    }
    if (matches.length === 0) return null;
    matches.sort((a, b) => b.csuffix.localeCompare(a.csuffix));
    return `${NCEI_BASE}${matches[0].filename}`;
  } finally {
    clearTimeout(timer);
  }
}

function streamFromResponse(res: Response): AsyncIterable<Uint8Array> {
  if (!res.body) throw new Error('NCEI response has no body');
  return Readable.fromWeb(
    res.body as unknown as import('node:stream/web').ReadableStream<Uint8Array>,
  ).pipe(createGunzip()) as unknown as AsyncIterable<Uint8Array>;
}

function ymdToIso(yearmonth: string, day: string, time: string): string {
  // BEGIN_YEARMONTH = "202504", BEGIN_DAY = "1" or "01", BEGIN_TIME = "1430"
  const yyyy = yearmonth.slice(0, 4);
  const mm = yearmonth.slice(4, 6);
  const dd = String(day).padStart(2, '0');
  const hh = (time || '0000').padStart(4, '0').slice(0, 2);
  const min = (time || '0000').padStart(4, '0').slice(2, 4);
  // NCEI fields are reported in CST (UTC-6) per their docs since 2003.
  // Express as -06:00 and let JS compute the UTC equivalent.
  return `${yyyy}-${mm}-${dd}T${hh}:${min}:00-06:00`;
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

function indexer(header: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (let i = 0; i < header.length; i++) out[header[i]] = i;
  return out;
}

function rowToNcei(
  row: string[],
  idx: Record<string, number>,
): NceiRow | null {
  const state = (row[idx['STATE']] || '').toUpperCase();
  if (!FOCUS_STATES.has(state)) return null;

  const eventType = row[idx['EVENT_TYPE']] || '';
  if (!RELEVANT_EVENT_TYPES.has(eventType)) return null;

  const lat = parseFloat(row[idx['BEGIN_LAT']] || '');
  const lng = parseFloat(row[idx['BEGIN_LON']] || '');
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat === 0 && lng === 0) return null;

  const beginYearmonth = row[idx['BEGIN_YEARMONTH']] || '';
  const beginDay = row[idx['BEGIN_DAY']] || '';
  const beginTime = row[idx['BEGIN_TIME']] || '';
  const endYearmonth = row[idx['END_YEARMONTH']] || beginYearmonth;
  const endDay = row[idx['END_DAY']] || beginDay;
  const endTime = row[idx['END_TIME']] || beginTime;

  const beginIso = ymdToIso(beginYearmonth, beginDay, beginTime);
  const endIso = ymdToIso(endYearmonth, endDay, endTime);
  const eventDateEt = easternDateKey(beginIso);
  if (!eventDateEt) return null;

  const magRaw = row[idx['MAGNITUDE']] || '';
  const magnitude = parseFloat(magRaw);
  if (!Number.isFinite(magnitude)) return null;

  // Magnitude floors — radar already covers smaller events; we want NCEI as
  // the gold-standard insurance-relevant signal.
  if (eventType === 'Hail' && magnitude < 0.5) return null;
  if (
    (eventType === 'Thunderstorm Wind' ||
      eventType === 'High Wind' ||
      eventType === 'Strong Wind') &&
    magnitude < 50
  ) {
    return null;
  }
  // Tornado/Marine Hail/Funnel Cloud: keep regardless of magnitude.

  const ncei_event_id = parseInt(row[idx['EVENT_ID']] || '', 10);
  if (!Number.isFinite(ncei_event_id)) return null;

  const episode_id = parseInt(row[idx['EPISODE_ID']] || '', 10);

  return {
    ncei_event_id,
    episode_id: Number.isFinite(episode_id) ? episode_id : null,
    event_type: eventType,
    state,
    state_code: STATE_TO_CODE[state] ?? '',
    county: (row[idx['CZ_NAME']] || '').trim() || null,
    wfo: (row[idx['WFO']] || '').trim() || null,
    begin_iso: beginIso,
    end_iso: endIso,
    event_date_et: eventDateEt,
    lat,
    lng,
    magnitude:
      eventType === 'Hail'
        ? magnitude
        : eventType === 'Tornado'
          ? 0
          : magnitude,
    magnitude_type: row[idx['MAGNITUDE_TYPE']] || null,
    narrative: (row[idx['EVENT_NARRATIVE']] || '').trim() || null,
  };
}

const LAT_LNG_BUCKET_DECIMALS = 2; // ~0.7 mi at mid-latitudes

function bucketStr(n: number): string {
  return n.toFixed(LAT_LNG_BUCKET_DECIMALS);
}

async function upsertBatch(rows: NceiRow[]): Promise<void> {
  if (rows.length === 0) return;
  if (!sql) throw new Error('DATABASE_URL not configured');

  // Build a multi-row INSERT to keep per-row roundtrips down. postgres-js
  // supports `${sql.array(...)}` and helpers, but the cleanest way for our
  // shape is to issue one INSERT per row with the same prepared template —
  // postgres-js then prepares it once and reuses. The N round-trips run in
  // a single connection so latency stays bounded; for 5000 rows it's a few
  // seconds.
  for (const r of rows) {
    try {
      await sql`
        INSERT INTO verified_hail_events (
          event_date, lat, lng, lat_bucket, lng_bucket,
          hail_size_inches, source_ncei_storm_events,
          event_type, magnitude, magnitude_type,
          state_code, county, wfo,
          episode_id, ncei_event_id, narrative,
          begin_time_utc, end_time_utc
        ) VALUES (
          ${r.event_date_et}::date, ${r.lat}, ${r.lng},
          ${bucketStr(r.lat)}, ${bucketStr(r.lng)},
          ${r.event_type === 'Hail' ? r.magnitude : 0},
          TRUE,
          ${r.event_type}, ${r.magnitude}, ${r.magnitude_type},
          ${r.state_code}, ${r.county}, ${r.wfo},
          ${r.episode_id}, ${r.ncei_event_id}, ${r.narrative},
          ${new Date(r.begin_iso).toISOString()}::timestamptz,
          ${new Date(r.end_iso).toISOString()}::timestamptz
        )
        ON CONFLICT (event_date, lat_bucket, lng_bucket)
        DO UPDATE SET
          hail_size_inches = GREATEST(
            verified_hail_events.hail_size_inches,
            EXCLUDED.hail_size_inches
          ),
          source_ncei_storm_events = TRUE,
          event_type = COALESCE(EXCLUDED.event_type, verified_hail_events.event_type),
          magnitude = GREATEST(
            COALESCE(verified_hail_events.magnitude, 0),
            COALESCE(EXCLUDED.magnitude, 0)
          ),
          magnitude_type = COALESCE(verified_hail_events.magnitude_type, EXCLUDED.magnitude_type),
          state_code = COALESCE(verified_hail_events.state_code, EXCLUDED.state_code),
          county = COALESCE(verified_hail_events.county, EXCLUDED.county),
          wfo = COALESCE(verified_hail_events.wfo, EXCLUDED.wfo),
          episode_id = COALESCE(verified_hail_events.episode_id, EXCLUDED.episode_id),
          ncei_event_id = COALESCE(verified_hail_events.ncei_event_id, EXCLUDED.ncei_event_id),
          narrative = COALESCE(verified_hail_events.narrative, EXCLUDED.narrative),
          begin_time_utc = COALESCE(verified_hail_events.begin_time_utc, EXCLUDED.begin_time_utc),
          end_time_utc = COALESCE(verified_hail_events.end_time_utc, EXCLUDED.end_time_utc),
          updated_at = NOW()
      `;
    } catch (err) {
      console.warn(
        `[ncei] upsert failed event_id=${r.ncei_event_id}:`,
        (err as Error).message,
      );
    }
  }
}

interface YearStats {
  year: number;
  rowsScanned: number;
  rowsKept: number;
  rowsByEventType: Record<string, number>;
  rowsByState: Record<string, number>;
}

async function backfillYear(
  year: number,
  args: Args,
): Promise<YearStats> {
  const stats: YearStats = {
    year,
    rowsScanned: 0,
    rowsKept: 0,
    rowsByEventType: {},
    rowsByState: {},
  };

  console.log(`[ncei] year=${year} discovering latest details file…`);
  const url = await findLatestDetailsUrl(year);
  if (!url) {
    console.warn(`[ncei] no details file found for year ${year}`);
    return stats;
  }
  console.log(`[ncei] year=${year} url=${url.split('/').pop()}`);

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS * 5);
  let res: Response;
  try {
    res = await fetch(url, {
      signal: ac.signal,
      headers: { 'User-Agent': 'HailYes/1.0 (storm-intelligence-app)' },
    });
    if (!res.ok) {
      clearTimeout(timer);
      console.warn(`[ncei] HTTP ${res.status} fetching ${url}`);
      return stats;
    }
  } catch (err) {
    clearTimeout(timer);
    console.warn(`[ncei] fetch failed:`, (err as Error).message);
    return stats;
  }

  const stream = streamFromResponse(res);
  let header: string[] | null = null;
  let idx: Record<string, number> | null = null;
  const batch: NceiRow[] = [];
  const BATCH_SIZE = 200;

  try {
    for await (const row of parseCsvStream(stream)) {
      if (!header) {
        header = row;
        idx = indexer(header);
        // Sanity: required columns present
        const required = ['STATE', 'EVENT_TYPE', 'BEGIN_LAT', 'BEGIN_LON', 'EVENT_ID'];
        for (const k of required) {
          if (!(k in idx)) {
            throw new Error(`NCEI CSV missing column: ${k}`);
          }
        }
        continue;
      }
      stats.rowsScanned += 1;
      const parsed = rowToNcei(row, idx!);
      if (!parsed) continue;
      stats.rowsKept += 1;
      stats.rowsByEventType[parsed.event_type] =
        (stats.rowsByEventType[parsed.event_type] ?? 0) + 1;
      stats.rowsByState[parsed.state_code] =
        (stats.rowsByState[parsed.state_code] ?? 0) + 1;
      batch.push(parsed);

      if (stats.rowsKept >= args.limit) {
        break;
      }

      if (batch.length >= BATCH_SIZE && !args.dryRun) {
        await upsertBatch(batch.splice(0, batch.length));
      }
    }
    if (batch.length > 0 && !args.dryRun) {
      await upsertBatch(batch);
    }
  } finally {
    clearTimeout(timer);
  }

  return stats;
}

/**
 * Programmatic entry: callable from migrate.ts when BACKFILL_NCEI_ON_BOOT
 * is set, OR from the CLI. `closeSql` controls whether to close the
 * connection at the end (CLI=true, embedded=false so the server can reuse).
 */
export async function runNceiBackfill(
  inputArgs: { years: number[]; dryRun?: boolean; limit?: number },
  opts?: { closeSql?: boolean },
): Promise<{ totalKept: number; perYear: YearStats[] }> {
  const args: Args = {
    years: inputArgs.years,
    dryRun: inputArgs.dryRun ?? false,
    limit: inputArgs.limit ?? Number.POSITIVE_INFINITY,
  };
  if (!sql) throw new Error('DATABASE_URL not configured');
  await sql`SELECT 1`;

  const all: YearStats[] = [];
  for (const year of args.years) {
    const stats = await backfillYear(year, args);
    all.push(stats);
    console.log(
      `[ncei] year=${year} scanned=${stats.rowsScanned} kept=${stats.rowsKept} ` +
        `byType=${JSON.stringify(stats.rowsByEventType)} byState=${JSON.stringify(stats.rowsByState)}`,
    );
  }

  const totalKept = all.reduce((m, y) => m + y.rowsKept, 0);
  console.log('\n=== summary ===');
  console.log(`total rows kept across all years: ${totalKept}`);
  console.log(`focus states: ${[...FOCUS_STATES].join(',')}`);

  if (!args.dryRun) {
    const cnt = await sql`
      SELECT COUNT(*) AS n
        FROM verified_hail_events
       WHERE source_ncei_storm_events = TRUE
    `;
    console.log(`verified_hail_events rows with source_ncei_storm_events=TRUE: ${cnt[0]?.n ?? 0}`);
  }

  if (opts?.closeSql !== false) {
    await sql.end({ timeout: 5 });
  }

  return { totalKept, perYear: all };
}

async function cliMain(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.years.length === 0) {
    console.error(
      'Usage:\n' +
        '  npm run backfill:ncei -- --year 2025\n' +
        '  npm run backfill:ncei -- --years 2022-2025\n' +
        '  npm run backfill:ncei -- --year 2025 --dry-run\n' +
        '  npm run backfill:ncei -- --year 2025 --limit 100',
    );
    process.exit(1);
  }
  await runNceiBackfill(args, { closeSql: true });
}

// Only run the CLI entry when this module is invoked directly (not when
// migrate.ts imports it for the boot-flag path).
const invokedDirectly =
  process.argv[1] && /ncei-backfill/.test(process.argv[1]);
if (invokedDirectly) {
  cliMain().catch((err) => {
    console.error('[ncei-backfill] failed:', err);
    process.exit(1);
  });
}
