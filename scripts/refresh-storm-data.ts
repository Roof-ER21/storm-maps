/**
 * Operator orchestrator for storm-data refresh.
 *
 * This intentionally shells out to the existing npm scripts instead of
 * importing their modules so each job keeps its own process lifecycle and DB
 * connection cleanup. Use --plan locally to verify the exact commands without
 * touching network or Postgres.
 *
 * Usage:
 *   npm run ops:refresh-storm-data -- --years 2024-2026 --iem-days 45 --hail-days 180
 *   npm run ops:refresh-storm-data -- --plan
 *   npm run ops:refresh-storm-data -- --dry-run
 *
 * Defaults roll forward automatically: current year minus two through current
 * year for NCEI, plus recent IEM LSR and MRMS cache windows.
 */

import { spawn } from 'node:child_process';

interface Args {
  years: string;
  iemDays: number;
  hailDays: number;
  plan: boolean;
  dryRun: boolean;
  skipNcei: boolean;
  skipIem: boolean;
  skipHail: boolean;
}

interface Step {
  label: string;
  args: string[];
}

function defaultYearRange(now = new Date()): string {
  const year = now.getFullYear();
  return `${year - 2}-${year}`;
}

function parseArgs(argv: string[]): Args {
  const defaultYears = defaultYearRange();
  const out: Args = {
    years: defaultYears,
    iemDays: 45,
    hailDays: 180,
    plan: false,
    dryRun: false,
    skipNcei: false,
    skipIem: false,
    skipHail: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--years' && next) {
      out.years = next;
      i += 1;
    } else if (arg === '--iem-days' && next) {
      out.iemDays = parsePositiveInt(next, '--iem-days');
      i += 1;
    } else if (arg === '--hail-days' && next) {
      out.hailDays = parsePositiveInt(next, '--hail-days');
      i += 1;
    } else if (arg === '--plan') {
      out.plan = true;
    } else if (arg === '--dry-run') {
      out.dryRun = true;
    } else if (arg === '--skip-ncei') {
      out.skipNcei = true;
    } else if (arg === '--skip-iem') {
      out.skipIem = true;
    } else if (arg === '--skip-hail') {
      out.skipHail = true;
    } else if (arg === '--help' || arg === '-h') {
      printHelp(defaultYears);
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!/^\d{4}-\d{4}$/.test(out.years) && !/^\d{4}$/.test(out.years)) {
    throw new Error(`--years must be YYYY or YYYY-YYYY, got ${out.years}`);
  }

  return out;
}

function parsePositiveInt(value: string, label: string): number {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return n;
}

function printHelp(defaultYears = defaultYearRange()): void {
  console.log(`Usage:
  npm run ops:refresh-storm-data -- [options]

Options:
  --years YYYY-YYYY    NCEI year or year range. Default: ${defaultYears}
  --iem-days N         IEM LSR recent-day window. Default: 45
  --hail-days N        MRMS hail prewarm window. Default: 180
  --dry-run            Parse/fetch where supported but do not write
  --plan               Print commands only; no network or DB
  --skip-ncei          Skip NCEI backfill
  --skip-iem           Skip IEM LSR backfill
  --skip-hail          Skip MRMS hail prewarm
`);
}

function buildSteps(args: Args): Step[] {
  const steps: Step[] = [];

  if (!args.skipNcei) {
    steps.push({
      label: 'NCEI official archive backfill',
      args: [
        'run',
        'backfill:ncei',
        '--',
        args.years.includes('-') ? '--years' : '--year',
        args.years,
        ...(args.dryRun ? ['--dry-run'] : []),
      ],
    });
  }

  if (!args.skipIem) {
    steps.push({
      label: 'IEM Local Storm Reports recent backfill',
      args: [
        'run',
        'backfill:iem-lsr',
        '--',
        '--days',
        String(args.iemDays),
        ...(args.dryRun ? ['--dry-run'] : []),
      ],
    });
  }

  if (!args.skipHail) {
    steps.push({
      label: 'MRMS hail swath cache prewarm',
      args: [
        'run',
        'prewarm:hail',
        '--',
        '--days',
        String(args.hailDays),
        ...(args.dryRun ? ['--dry-run'] : []),
      ],
    });
  }

  return steps;
}

function commandString(step: Step): string {
  return ['npm', ...step.args].join(' ');
}

function runStep(step: Step): Promise<void> {
  return new Promise((resolve, reject) => {
    console.log(`\n[ops] ${step.label}`);
    console.log(`[ops] $ ${commandString(step)}`);
    const child = spawn('npm', step.args, {
      stdio: 'inherit',
      shell: false,
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${step.label} failed with exit code ${code}`));
      }
    });
  });
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const steps = buildSteps(args);
  if (steps.length === 0) {
    throw new Error('No steps selected');
  }

  console.log('[ops] storm-data refresh plan');
  for (const [idx, step] of steps.entries()) {
    console.log(`  ${idx + 1}. ${step.label}`);
    console.log(`     ${commandString(step)}`);
  }

  if (args.plan) {
    console.log('[ops] plan only; no commands executed');
    return;
  }

  for (const step of steps) {
    await runStep(step);
  }
  console.log('\n[ops] storm-data refresh complete');
}

main().catch((err) => {
  console.error('[ops] fatal:', (err as Error).message);
  process.exit(1);
});
