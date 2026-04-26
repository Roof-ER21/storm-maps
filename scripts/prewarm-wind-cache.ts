/**
 * Pre-warm the wind swath cache for VA / MD / PA over the last N days.
 *
 * Run via:
 *   tsx scripts/prewarm-wind-cache.ts [days]
 *
 * Uses the same buildWindSwathCollection() pipeline that serves live
 * requests, so each warmed entry is ready to serve from `swath_cache` on
 * first lookup. Default = 30 days (covers the bulk of "recent" canvasses).
 *
 * Idempotent: re-running just refreshes the entries that have expired.
 */

import { buildWindSwathCollection } from '../server/storm/windSwathService.js';
import { sql } from '../server/db.js';

const STATES = ['VA', 'MD', 'PA', 'WV', 'DC', 'DE'];

// Three regional bboxes covering VA / MD+DC / PA — same shapes as the
// frontend `FOCUS_TERRITORIES` definition. Kept in this script intentionally
// (rather than imported from src/) so the script doesn't pull React.
const REGIONS = [
  { name: 'VA', north: 39.5, south: 36.4, east: -75.1, west: -83.7 },
  { name: 'MD+DC', north: 39.8, south: 37.8, east: -75.0, west: -79.5 },
  { name: 'PA', north: 42.4, south: 39.6, east: -74.6, west: -80.6 },
];

function easternDateKey(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

async function run(): Promise<void> {
  const daysArg = parseInt(process.argv[2] ?? '30', 10);
  const days = Number.isFinite(daysArg) && daysArg > 0 ? daysArg : 30;

  console.log(`[prewarm] warming ${days} days × ${REGIONS.length} regions`);
  let warmed = 0;
  let skipped = 0;

  for (let dayOffset = 0; dayOffset < days; dayOffset += 1) {
    const target = new Date(Date.now() - dayOffset * 24 * 60 * 60 * 1000);
    const date = easternDateKey(target);

    for (const region of REGIONS) {
      try {
        const collection = await buildWindSwathCollection({
          date,
          bounds: {
            north: region.north,
            south: region.south,
            east: region.east,
            west: region.west,
          },
          states: STATES,
          includeLive: false,
        });
        if (collection.metadata.reportCount > 0) {
          warmed += 1;
          console.log(
            `  ${date}  ${region.name.padEnd(5)}  ` +
              `reports=${collection.metadata.reportCount}  ` +
              `peak=${Math.round(collection.metadata.maxGustMph)} mph`,
          );
        } else {
          skipped += 1;
        }
      } catch (err) {
        console.warn(`  ${date}  ${region.name}  FAILED:`, err);
      }
    }
  }

  console.log(
    `[prewarm] done — warmed ${warmed} non-empty entries, ` +
      `skipped ${skipped} quiet days`,
  );
  await sql.end();
}

run().catch((err) => {
  console.error('[prewarm] fatal', err);
  process.exit(1);
});
