/**
 * CLI debug: feed a known storm + property → eyeball the consilience output.
 *
 * Usage:
 *   npm run consilience -- --lat 38.7509 --lng -77.4753 --date 2026-04-01
 *   npm run consilience -- --lat 38.85 --lng -77.30 --date 2026-04-19 --radius 10
 *
 * Output: per-source breakdown table + curated adjuster narrative.
 *
 * Note: needs SYNOPTIC_TOKEN sourced for the surface-obs source. If absent,
 * Synoptic returns empty and is reported as not-confirmed (silent fallback).
 *   set -a && source ~/.synoptic-token && set +a
 */

import { writeFile } from 'node:fs/promises';
import { buildConsilience, type ConsilienceResult } from '../server/storm/consilienceService.js';

interface Args {
  lat: number;
  lng: number;
  date: string;
  radius?: number;
  out?: string;
  json?: boolean;
}

function parseArgs(argv: string[]): Args {
  const out: Partial<Args> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a) continue;
    const next = argv[i + 1];
    switch (a) {
      case '--lat':
        if (next) out.lat = parseFloat(next);
        i++;
        break;
      case '--lng':
        if (next) out.lng = parseFloat(next);
        i++;
        break;
      case '--date':
        if (next) out.date = next;
        i++;
        break;
      case '--radius':
        if (next) out.radius = parseFloat(next);
        i++;
        break;
      case '--out':
        if (next) out.out = next;
        i++;
        break;
      case '--json':
        out.json = true;
        break;
      case '-h':
      case '--help':
        printHelp();
        process.exit(0);
    }
  }
  if (
    typeof out.lat !== 'number' ||
    typeof out.lng !== 'number' ||
    !out.date
  ) {
    printHelp();
    throw new Error('--lat, --lng, --date are required');
  }
  return out as Args;
}

function printHelp(): void {
  console.log(`
Hail Yes — consilience debug

Usage:
  npm run consilience -- --lat <deg> --lng <deg> --date <YYYY-MM-DD> [--radius <mi>]

Examples:
  # April 1, 2026 Manassas (POC found NO storm here — control test)
  npm run consilience -- --lat 38.7509 --lng -77.4753 --date 2026-04-01

  # April 19, 2026 NoVA (POC found 4 severe-wind stations)
  npm run consilience -- --lat 38.85 --lng -77.30 --date 2026-04-19 --radius 10

Options:
  --lat <deg>      Property latitude (decimal)
  --lng <deg>      Property longitude (decimal)
  --date <date>    Storm date YYYY-MM-DD (Eastern)
  --radius <mi>    Search radius for ground reports + Synoptic. Default 5
  --out <file>     Write full JSON result to file
  --json           Print full JSON to stdout instead of table
  -h, --help       Show this help
`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const result = await buildConsilience({
    lat: args.lat,
    lng: args.lng,
    date: args.date,
    radiusMiles: args.radius,
  });

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    printSummary(result);
  }

  if (args.out) {
    await writeFile(args.out, JSON.stringify(result, null, 2));
    console.log(`\n[saved] ${args.out}`);
  }
}

function printSummary(r: ConsilienceResult): void {
  const q = r.query;
  console.log('');
  console.log(`Property:      ${q.lat.toFixed(4)}, ${q.lng.toFixed(4)}  (radius ${q.radiusMiles}mi)`);
  console.log(`Date:          ${q.date}`);
  console.log(`Window:        ${q.startUtc} → ${q.endUtc}`);
  console.log('');
  console.log(`Confirmed:     ${r.confirmedCount} / 9 sources  (${r.confidenceTier})`);
  console.log('');

  const rows: { name: string; status: string; detail: string }[] = [];

  rows.push({
    name: 'MRMS radar',
    status: r.sources.mrms.confirmed ? 'YES' : 'no',
    detail: r.sources.mrms.directHit
      ? `directHit=${r.sources.mrms.bandLabel ?? '?'} (${(r.sources.mrms.hailSizeInches ?? 0).toFixed(2)}")`
      : 'no swath at point',
  });

  rows.push({
    name: 'SPC hail rpts',
    status: r.sources.spcHail.confirmed ? 'YES' : 'no',
    detail: r.sources.spcHail.reportCount > 0
      ? `${r.sources.spcHail.reportCount} rpts, peak ${r.sources.spcHail.maxHailInches.toFixed(2)}", nearest ${r.sources.spcHail.nearestMiles?.toFixed(1) ?? '?'}mi`
      : 'no reports in radius',
  });

  rows.push({
    name: 'IEM LSR hail',
    status: r.sources.iemLsrHail.confirmed ? 'YES' : 'no',
    detail: r.sources.iemLsrHail.reportCount > 0
      ? `${r.sources.iemLsrHail.reportCount} rpts, peak ${r.sources.iemLsrHail.maxHailInches.toFixed(2)}", nearest ${r.sources.iemLsrHail.nearestMiles?.toFixed(1) ?? '?'}mi`
      : 'no reports in radius',
  });

  rows.push({
    name: 'Wind context',
    status: r.sources.windContext.confirmed ? 'YES' : 'no',
    detail: r.sources.windContext.reportCount > 0
      ? `${r.sources.windContext.reportCount} rpts, peak ${(r.sources.windContext.peakGustMph ?? 0).toFixed(0)} mph (${r.sources.windContext.sources.join(',')})`
      : 'no severe wind reports',
  });

  rows.push({
    name: 'Synoptic obs',
    status: r.sources.synoptic.confirmed ? 'YES' : 'no',
    detail: r.sources.synoptic.stationsTotal > 0
      ? `${r.sources.synoptic.stationsTotal} stations, ${r.sources.synoptic.stationsWithHailSignal} hail-signal, ${r.sources.synoptic.stationsWithSevereWindSignal} severe-wind`
      : 'no stations / no token',
  });

  rows.push({
    name: 'mPING crowd',
    status: r.sources.mping.confirmed ? 'YES' : 'no',
    detail: r.sources.mping.reportCount > 0
      ? `${r.sources.mping.reportCount} rpts, peak ${r.sources.mping.maxHailInches.toFixed(2)}", nearest ${r.sources.mping.nearestMiles?.toFixed(1) ?? '?'}mi`
      : 'no reports / no token',
  });

  rows.push({
    name: 'HailTrace',
    status: r.sources.hailtrace.confirmed ? 'YES' : 'no',
    detail: !r.sources.hailtrace.configured
      ? 'no token (unconfigured)'
      : r.sources.hailtrace.reportCount > 0
        ? `${r.sources.hailtrace.reportCount} rpts, peak ${r.sources.hailtrace.maxHailInches.toFixed(2)}", ${r.sources.hailtrace.certifiedCount} certified`
        : 'no reports in radius',
  });

  rows.push({
    name: 'NCEI SWDI',
    status: r.sources.ncerSwdi.confirmed ? 'YES' : 'no',
    detail: r.sources.ncerSwdi.cellCount > 0
      ? `${r.sources.ncerSwdi.cellCount} cells, peak ${r.sources.ncerSwdi.maxHailInches.toFixed(2)}", ${r.sources.ncerSwdi.peakSeverePct.toFixed(0)}% severe`
      : 'no NX3HAIL cells in radius',
  });

  rows.push({
    name: 'NWS warnings',
    status: r.sources.nwsWarnings.confirmed ? 'YES' : 'no',
    detail: r.sources.nwsWarnings.warningCount > 0
      ? `${r.sources.nwsWarnings.warningCount} warning${r.sources.nwsWarnings.warningCount === 1 ? '' : 's'}, in-polygon: ${r.sources.nwsWarnings.inWarningPolygon ? 'YES' : 'no'}, types: ${r.sources.nwsWarnings.types.join('+') || '-'}`
      : 'no warnings on date',
  });

  const header = `${pad('SOURCE', 16)}  ${pad('SIGNAL', 6)}  DETAIL`;
  console.log(header);
  console.log('-'.repeat(header.length));
  for (const row of rows) {
    console.log(`${pad(row.name, 16)}  ${pad(row.status, 6)}  ${row.detail}`);
  }

  console.log('');
  console.log('── Adjuster-curated output (auto-omits absences) ──');
  if (r.curated.confirmedSources.length === 0) {
    console.log('(no positives — section would be silently omitted from PDF)');
  } else {
    console.log(`Confirmed sources: ${r.curated.confirmedSources.join(', ')}`);
    console.log('');
    for (const line of r.curated.evidenceLines) {
      console.log(`  • ${line}`);
    }
    console.log('');
    console.log('Narrative:');
    console.log(r.curated.narrative);
  }
  console.log('');
}

function pad(s: string, w: number): string {
  if (s.length >= w) return s;
  return s + ' '.repeat(w - s.length);
}

main().catch((err: unknown) => {
  console.error('ERROR:', (err as Error).message);
  process.exit(1);
});
