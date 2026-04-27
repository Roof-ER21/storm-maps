/**
 * Pre-warm MRMS hail swath cache for focus territories.
 *
 * Unlike the live scheduler, this is an operator command for filling gaps
 * before demos, launches, or heavy canvassing pushes. It warms only dates with
 * existing official hail evidence in verified_hail_events unless --all-days is
 * passed.
 *
 * Usage:
 *   npm run prewarm:hail -- --days 90
 *   npm run prewarm:hail -- --since 2025-01-01 --until 2025-12-31
 *   npm run prewarm:hail -- --regions VA,MD,PA --days 180
 *   npm run prewarm:hail -- --days 30 --dry-run
 */

import { sql } from '../server/db.js';
import { buildMrmsVectorPolygons } from '../server/storm/mrmsService.js';
import type { BoundingBox } from '../server/storm/types.js';

interface Region {
  code: string;
  name: string;
  stateCodes: string[];
  bounds: BoundingBox;
}

const REGIONS: Region[] = [
  {
    code: 'VA',
    name: 'Virginia',
    stateCodes: ['VA'],
    bounds: { north: 39.5, south: 36.4, east: -75.1, west: -83.7 },
  },
  {
    code: 'MD',
    name: 'Maryland + DC',
    stateCodes: ['MD', 'DC'],
    bounds: { north: 39.8, south: 37.8, east: -75.0, west: -79.5 },
  },
  {
    code: 'PA',
    name: 'Pennsylvania',
    stateCodes: ['PA'],
    bounds: { north: 42.4, south: 39.6, east: -74.6, west: -80.6 },
  },
  {
    code: 'DE',
    name: 'Delaware',
    stateCodes: ['DE'],
    bounds: { north: 39.95, south: 38.4, east: -74.95, west: -75.85 },
  },
  {
    code: 'NJ',
    name: 'New Jersey',
    stateCodes: ['NJ'],
    bounds: { north: 41.4, south: 38.85, east: -73.85, west: -75.6 },
  },
  {
    code: 'WV',
    name: 'West Virginia',
    stateCodes: ['WV'],
    bounds: { north: 40.7, south: 37.0, east: -77.6, west: -82.8 },
  },
];

interface Args {
  since: string;
  until: string;
  regions: string[];
  allDays: boolean;
  dryRun: boolean;
  limit: number;
  pauseMs: number;
}

interface CandidateDate {
  date: string;
  evidenceCount: number;
  maxHailInches: number;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function daysAgoDate(days: number): string {
  return isoDate(new Date(Date.now() - days * 86_400_000));
}

function parseArgs(argv: string[]): Args {
  const out: Args = {
    since: daysAgoDate(90),
    until: isoDate(new Date()),
    regions: REGIONS.map((r) => r.code),
    allDays: false,
    dryRun: false,
    limit: Number.POSITIVE_INFINITY,
    pauseMs: 500,
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
    } else if (arg === '--regions' && next) {
      out.regions = next
        .split(',')
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean);
      i += 1;
    } else if (arg === '--all-days') {
      out.allDays = true;
    } else if (arg === '--dry-run') {
      out.dryRun = true;
    } else if (arg === '--limit' && next) {
      out.limit = parseInt(next, 10);
      i += 1;
    } else if (arg === '--pause-ms' && next) {
      out.pauseMs = Math.max(0, parseInt(next, 10) || 0);
      i += 1;
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

async function readCandidateDates(
  region: Region,
  args: Args,
): Promise<CandidateDate[]> {
  if (args.allDays) {
    return eachDate(args.since, args.until).map((date) => ({
      date,
      evidenceCount: 0,
      maxHailInches: 0,
    }));
  }

  const rows = await sql<
    Array<{
      event_date: string | Date;
      evidence_count: string;
      max_hail_inches: number | null;
    }>
  >`
    SELECT
      event_date,
      COUNT(*) AS evidence_count,
      MAX(COALESCE(hail_size_inches, magnitude, 0)) AS max_hail_inches
      FROM verified_hail_events
     WHERE event_date >= ${args.since}::date
       AND event_date <= ${args.until}::date
       AND lat BETWEEN ${region.bounds.south} AND ${region.bounds.north}
       AND lng BETWEEN ${region.bounds.west} AND ${region.bounds.east}
       AND (
         event_type ILIKE '%hail%'
         OR COALESCE(hail_size_inches, 0) > 0
       )
       AND (
         source_mrms = TRUE
         OR source_spc_hail = TRUE
         OR source_iem_lsr = TRUE
         OR source_ncei_storm_events = TRUE
         OR source_ncei_swdi = TRUE
         OR source_mping = TRUE
       )
     GROUP BY event_date
     ORDER BY event_date DESC
     LIMIT ${args.limit}
  `;

  return rows.map((row) => ({
    date:
      row.event_date instanceof Date
        ? row.event_date.toISOString().slice(0, 10)
        : String(row.event_date).slice(0, 10),
    evidenceCount: Number(row.evidence_count),
    maxHailInches: Number(row.max_hail_inches ?? 0),
  }));
}

async function existingCacheFreshness(
  region: Region,
  date: string,
): Promise<{ live: number; expired: number }> {
  const rows = await sql<Array<{ live: string; expired: string }>>`
    SELECT
      COUNT(*) FILTER (WHERE expires_at > NOW()) AS live,
      COUNT(*) FILTER (WHERE expires_at <= NOW()) AS expired
      FROM swath_cache
     WHERE source = 'mrms-hail'
       AND date = ${date}
       AND bbox_north = ${region.bounds.north}
       AND bbox_south = ${region.bounds.south}
       AND bbox_east = ${region.bounds.east}
       AND bbox_west = ${region.bounds.west}
  `;
  return {
    live: Number(rows[0]?.live ?? 0),
    expired: Number(rows[0]?.expired ?? 0),
  };
}

function sleep(ms: number): Promise<void> {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

async function run(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const regions = REGIONS.filter((r) => args.regions.includes(r.code));
  if (regions.length === 0) {
    throw new Error(`No matching regions for --regions ${args.regions.join(',')}`);
  }

  const needsDb = !args.dryRun || !args.allDays;
  if (needsDb) {
    await sql`SELECT 1`;
  }
  console.log(
    `[prewarm:hail] ${args.since}..${args.until} regions=${regions
      .map((r) => r.code)
      .join(',')} mode=${args.allDays ? 'all-days' : 'evidence-seeded'} dryRun=${args.dryRun}`,
  );

  let candidates = 0;
  let warmed = 0;
  let empty = 0;
  let cached = 0;
  let failed = 0;

  for (const region of regions) {
    const dates = await readCandidateDates(region, args);
    console.log(
      `[prewarm:hail] ${region.code.padEnd(2)} candidate dates=${dates.length}`,
    );

    for (const candidate of dates) {
      candidates += 1;
      const label =
        `${candidate.date} ${region.code}` +
        ` evidence=${candidate.evidenceCount}` +
        (candidate.maxHailInches > 0 ? ` max=${candidate.maxHailInches.toFixed(2)}"` : '');

      if (args.dryRun) {
        console.log(`  ${label} DRY`);
        continue;
      }

      const freshness = await existingCacheFreshness(region, candidate.date);
      if (freshness.live > 0) {
        cached += 1;
        console.log(
          `  ${candidate.date} ${region.code} cached live=${freshness.live} evidence=${candidate.evidenceCount}`,
        );
        continue;
      }

      try {
        const collection = await buildMrmsVectorPolygons({
          date: candidate.date,
          bounds: region.bounds,
          awaitCacheWrite: true,
        });
        if (collection && collection.features.length > 0) {
          warmed += 1;
          console.log(
            `  ${label} warmed features=${collection.features.length} peak=${collection.metadata.maxHailInches.toFixed(2)}"`,
          );
        } else {
          empty += 1;
          console.log(`  ${label} empty`);
        }
      } catch (err) {
        failed += 1;
        console.warn(`  ${label} FAILED:`, (err as Error).message);
      }

      await sleep(args.pauseMs);
    }
  }

  console.log(
    `[prewarm:hail] done candidates=${candidates} warmed=${warmed} cached=${cached} empty=${empty} failed=${failed}`,
  );
  await sql.end({ timeout: 5 });
}

run().catch(async (err) => {
  console.error('[prewarm:hail] fatal:', err);
  await sql.end({ timeout: 5 }).catch(() => undefined);
  process.exit(1);
});
