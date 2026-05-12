// Railway-native refresh — works without any pre-existing local files.
// Triggered by the in-app Refresh Button or Railway cron.
//
// Flow:
//   1. Stage data/* from Postgres intel_blobs (so existing builder scripts work)
//   2. Pull fresh IEM storm data (NOAA public)
//   3. Re-correlate jobs × storms
//   4. Re-build derived patterns + resurrection + storm-exposure + storm-playbook + orphans
//   5. Push all results back to Postgres
//
// NEVER touches portal.theroofdocs.com — pure rebuild from existing job data
// plus fresh storms. New jobs only enter the system via manual ./refresh-all.sh
// on Ahmed's Mac.

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import postgres from 'postgres';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL not set');
  process.exit(1);
}

// Where to stage files on disk so the builder scripts (which read data/*.json)
// can work. On Railway this is /tmp inside the container; locally it'd be a
// throw-away dir to avoid clobbering existing data/.
const RIQ_BASE = process.env.RIQ_BASE || '/tmp/riq-railway';
const DATA_DIR = path.join(RIQ_BASE, 'data');
const STORMS_DIR = path.join(DATA_DIR, 'storms');

const sql = postgres(DATABASE_URL, {
  ssl: DATABASE_URL.includes('railway.internal') ? false : { rejectUnauthorized: false },
  max: 4,
  idle_timeout: 60,
});

function log(...args) {
  console.log('[refresh-railway]', ...args);
}

async function stageFromDb() {
  log('Staging files from Postgres → ' + DATA_DIR);
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(STORMS_DIR, { recursive: true });

  const stagings = [
    { key: 'projects',        out: path.join(DATA_DIR, 'projects.json') },
    { key: 'storms-light',    out: path.join(STORMS_DIR, 'iem-hail-wind-2018-2026.json') },
    { key: 'geocoded',        out: path.join(DATA_DIR, 'geocoded.json'), optional: true },
    { key: 'job-storms',      out: path.join(DATA_DIR, 'job-storms.json'), optional: true },
  ];

  for (const { key, out, optional } of stagings) {
    const rows = await sql`SELECT data FROM intel_blobs WHERE key = ${key} LIMIT 1`;
    if (rows.length === 0) {
      if (optional) {
        log(`  ${key}: not in DB (optional, skipping)`);
        continue;
      }
      throw new Error(`Required dataset ${key} not in Postgres — run a full refresh on the Mac first to seed`);
    }
    fs.writeFileSync(out, JSON.stringify(rows[0].data));
    const size = (fs.statSync(out).size / 1024 / 1024).toFixed(1);
    log(`  ${key}: ${size} MB → ${out}`);
  }
}

function runChild(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, {
      env: { ...process.env, RIQ_BASE, DATABASE_URL },
      stdio: ['ignore', 'pipe', 'pipe'],
      ...opts,
    });
    p.stdout.on('data', (c) => process.stdout.write('  ' + c));
    p.stderr.on('data', (c) => process.stderr.write('  ' + c));
    p.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${args.join(' ')} exited ${code}`));
    });
  });
}

async function pushDerivedToDb() {
  log('Pushing derived files back to Postgres…');

  // We push every output file the builders may have created. Each is upserted
  // by key; missing files are skipped (cron may have only produced a subset).
  const outputs = [
    { key: 'projects',        file: path.join(DATA_DIR, 'projects.json') },
    { key: 'patterns',        file: path.join(DATA_DIR, 'patterns.json') },
    { key: 'resurrection',    file: path.join(DATA_DIR, 'resurrection.json') },
    { key: 'storm-exposure',  file: path.join(DATA_DIR, 'storm-exposure.json') },
    { key: 'storm-playbook',  file: path.join(DATA_DIR, 'storm-playbook.json') },
    { key: 'receivables',     file: path.join(DATA_DIR, 'receivables.json') },
    { key: 'notes',           file: path.join(DATA_DIR, 'notes.json') },
    { key: 'job-storms',      file: path.join(DATA_DIR, 'job-storms.json') },
    { key: 'carrier-orphans', file: path.join(DATA_DIR, 'carrier-orphans.json') },
    { key: 'storms-light',    file: path.join(STORMS_DIR, 'iem-hail-wind-2018-2026.json') },
  ];

  for (const { key, file } of outputs) {
    if (!fs.existsSync(file)) {
      log(`  skip ${key} (builder didn't produce ${file})`);
      continue;
    }
    const stat = fs.statSync(file);
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    const rowCount = Array.isArray(data)
      ? data.length
      : Array.isArray(data?.features)
        ? data.features.length
        : Array.isArray(data?.all)
          ? data.all.length
          : 1;

    await sql`
      INSERT INTO intel_blobs (key, data, source_mtime, bytes, row_count, updated_at)
      VALUES (${key}, ${data}::jsonb, ${stat.mtime.toISOString()}, ${stat.size}, ${rowCount}, NOW())
      ON CONFLICT (key) DO UPDATE
        SET data = EXCLUDED.data,
            source_mtime = EXCLUDED.source_mtime,
            bytes = EXCLUDED.bytes,
            row_count = EXCLUDED.row_count,
            updated_at = NOW()
    `;
    log(`  ✓ ${key} (${(stat.size / 1024 / 1024).toFixed(1)} MB · ${rowCount.toLocaleString()} rows)`);
  }
}

(async () => {
  const startedAt = Date.now();
  log(`=== START ${new Date().toISOString()} (base=${RIQ_BASE}) ===`);

  try {
    await stageFromDb();

    log('Pulling fresh IEM storm data (NOAA public)…');
    await runChild('node', ['scripts/roofdocs/pull-storms.mjs']);

    log('Re-correlating jobs × storms…');
    await runChild('node', ['scripts/roofdocs/correlate-storms.mjs']);

    log('Building storm exposure + playbook…');
    await runChild('node', ['scripts/roofdocs/build-storm-exposure.mjs']);

    log('Mining patterns…');
    await runChild('node', ['scripts/roofdocs/build-patterns.mjs']);

    log('Building carrier orphans…');
    await runChild('node', ['scripts/roofdocs/build-carrier-orphans.mjs']);

    await pushDerivedToDb();

    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
    log(`=== DONE in ${elapsed}s ===`);
    await sql.end();
  } catch (err) {
    log('FAILED:', err.message);
    await sql.end();
    process.exit(1);
  }
})();
