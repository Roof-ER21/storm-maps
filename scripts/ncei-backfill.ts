/**
 * NCEI Storm Events Database backfill — bulk-loads the official NOAA
 * archive (the same DB insurance adjusters cite) into verified_hail_events.
 *
 * Source:
 *   https://www.ncei.noaa.gov/pub/data/swdi/stormevents/csvfiles/
 *     StormEvents_details-ftp_v1.0_dYYYY_cYYYYMMDD.csv.gz
 *   StormEvents_locations-ftp_v1.0_dYYYY_cYYYYMMDD.csv.gz
 *
 * No API key needed. Yearly CSVs, gzipped, ~30 MB each. Filter by:
 *   - EVENT_TYPE = 'Hail' OR 'Thunderstorm Wind' OR 'Tornado'
 *   - STATE in our focus territory (VA / MARYLAND / PENNSYLVANIA / DELAWARE
 *     / NEW JERSEY / DISTRICT OF COLUMBIA / WEST VIRGINIA)
 *   - MAGNITUDE >= 0.25" hail or >= 50 mph wind
 *
 * USAGE (DO NOT run automatically — heavy I/O and DB writes):
 *   set -a && source .env.local && set +a
 *   npm run backfill:ncei -- --year 2025
 *   npm run backfill:ncei -- --years 2020-2025
 *   npm run backfill:ncei -- --year 2025 --dry-run
 *
 * The script is idempotent — re-runs upsert on (event_date, lat_bucket,
 * lng_bucket) so multiple runs converge.
 *
 * STATUS: scaffolded, not yet wired to actually parse + write. Spec the
 * shape so a follow-on session can land it in 1-2 hours of focused work.
 * The path-of-least-resistance steps are inline in TODO comments.
 */

import { sql } from '../server/db.js';

interface Args {
  year?: number;
  startYear?: number;
  endYear?: number;
  dryRun?: boolean;
}

function parseArgs(argv: string[]): Args {
  const out: Args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    if (a === '--year' && next) {
      out.year = parseInt(next, 10);
      i++;
    } else if (a === '--years' && next) {
      const m = next.match(/^(\d{4})-(\d{4})$/);
      if (m) {
        out.startYear = parseInt(m[1], 10);
        out.endYear = parseInt(m[2], 10);
      }
      i++;
    } else if (a === '--dry-run') {
      out.dryRun = true;
    }
  }
  return out;
}

const FOCUS_STATES = new Set([
  'VIRGINIA',
  'MARYLAND',
  'PENNSYLVANIA',
  'DELAWARE',
  'NEW JERSEY',
  'DISTRICT OF COLUMBIA',
  'WEST VIRGINIA',
]);

async function backfillYear(year: number, dryRun: boolean): Promise<void> {
  console.log(`[ncei-backfill] starting year=${year}${dryRun ? ' (dry-run)' : ''}`);

  // TODO 1: Fetch the index page at
  //   https://www.ncei.noaa.gov/pub/data/swdi/stormevents/csvfiles/
  // and find the latest StormEvents_details-ftp_v1.0_d{year}_c*.csv.gz
  // (the c-suffix is the publish date; just take the most recent for that year).
  //
  // TODO 2: Stream-fetch the gzipped CSV (use `pako.inflate` per chunk OR write
  // to a temp file and decompress on disk). The details file has columns:
  //   BEGIN_DAY, BEGIN_TIME, END_DAY, END_TIME, EPISODE_ID, EVENT_ID,
  //   STATE, STATE_FIPS, YEAR, MONTH_NAME, EVENT_TYPE, CZ_TYPE, CZ_FIPS,
  //   CZ_NAME, WFO, BEGIN_DATE_TIME, END_DATE_TIME, INJURIES_DIRECT, ...,
  //   MAGNITUDE, MAGNITUDE_TYPE, ..., BEGIN_LAT, BEGIN_LON, END_LAT, END_LON, ...
  //
  // TODO 3: For each row matching FOCUS_STATES + (Hail/Wind/Tornado):
  //   - eventDate = BEGIN_DATE_TIME's Eastern calendar day
  //   - lat = BEGIN_LAT, lng = BEGIN_LON (skip if missing/zero)
  //   - lat_bucket = lat.toFixed(2), lng_bucket = lng.toFixed(2)
  //   - hail_size_inches = parseFloat(MAGNITUDE) when EVENT_TYPE='Hail'
  //   - source_ncei_storm_events = true (add this flag to schema below)
  //
  // TODO 4: Upsert into verified_hail_events with ON CONFLICT (event_date,
  // lat_bucket, lng_bucket) DO UPDATE SET hail_size_inches = GREATEST(...)
  // and OR-merge the source flags.

  if (dryRun) {
    console.log('[ncei-backfill] dry-run — no writes');
    return;
  }

  // Smoke check the DB connection so a misconfigured env fails loudly.
  if (!sql) throw new Error('DATABASE_URL not configured');
  await sql`SELECT 1`;

  console.log(
    '[ncei-backfill] STUB: parser not yet implemented. See TODO blocks above.',
  );
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const dryRun = args.dryRun ?? false;
  const years: number[] = [];
  if (args.year) years.push(args.year);
  if (args.startYear && args.endYear) {
    for (let y = args.startYear; y <= args.endYear; y += 1) years.push(y);
  }
  if (years.length === 0) {
    console.error('Usage: ncei-backfill --year 2025  OR  --years 2020-2025');
    process.exit(1);
  }
  for (const year of years) {
    await backfillYear(year, dryRun);
  }
  console.log(`[ncei-backfill] done. focus-states=${[...FOCUS_STATES].join(',')}`);
}

main().catch((err) => {
  console.error('[ncei-backfill] failed:', err);
  process.exit(1);
});
