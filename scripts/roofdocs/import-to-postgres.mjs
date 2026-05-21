// Import intel JSON files → Postgres `intel_blobs` table.
// Idempotent: upserts by key. Run after refresh-all.sh or on demand.
//
// Locally:   DATABASE_URL=postgresql://… node scripts/roofdocs/import-to-postgres.mjs
// Railway:   railway run --service riq21 -- node scripts/roofdocs/import-to-postgres.mjs
//
// One row per dataset. Stored as JSONB. /api/intel/:key reads these rows back
// and returns the same shape as the file-based serving did.

import fs from 'node:fs';
import path from 'node:path';
import postgres from 'postgres';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL not set');
  process.exit(1);
}

// Support RIQ_BASE env var so the script can be run from any directory
// when the data directory lives outside the git repo (e.g. D:\storm-maps\data).
const DATA_DIR = process.env.RIQ_BASE
  ? path.join(process.env.RIQ_BASE, 'data')
  : path.resolve(import.meta.dirname, '..', '..', 'data');

// Datasets to import — key matches the /api/intel/:key route param.
const DATASETS = [
  { key: 'projects',         file: 'projects.json' },
  { key: 'patterns',         file: 'patterns.json' },
  { key: 'resurrection',     file: 'resurrection.json' },
  { key: 'storm-exposure',   file: 'storm-exposure.json' },
  { key: 'storm-playbook',   file: 'storm-playbook.json' },
  { key: 'receivables',      file: 'receivables.json' },
  { key: 'notes',            file: 'notes.json' },
  { key: 'job-storms',       file: 'job-storms.json' },
  { key: 'geocoded',         file: 'geocoded.json' },
  { key: 'carrier-orphans',  file: 'carrier-orphans.json' },
  { key: 'cheat-sheets',     file: 'cheat-sheets.json' },
  { key: 'carrier-patents',  file: 'carrier-patents.json' },
  { key: 'lifetime-touch',   file: 'lifetime-touch.json' },
  { key: 'denial-corpus',    file: 'denial-corpus.json' },
  { key: 'carrier-boilerplate', file: 'carrier-boilerplate.json' },
  { key: 'adjustments-open', file: 'adjustments-open.json' },
  { key: 'employee-roster',  file: 'employee-roster.json' },
  { key: 'active-work',      file: 'active-work.json' },
  { key: 'credits',          file: 'credits.json' },
  { key: 'pricing-margins',  file: 'pricing-margins.json' },
  { key: 'pricing-templates', file: 'pricing-templates.json' },
  { key: 'pricing-library',  file: 'pricing-library.json' },
  { key: 'storms-light',     file: 'storms/iem-hail-wind-2018-2026.json' },
  // Portal KPI + finance
  { key: 'portal-kpi-profit',   file: 'portal-kpi-profit.json' },
  { key: 'portal-kpi-summary',  file: 'portal-kpi-summary.json' },
  { key: 'portal-insurance-names', file: 'portal-insurance-names.json' },
  { key: 'finance-plans',       file: 'finance-plans.json' },
  // Leads funnel rollup + employee-lead assignments
  { key: 'leads-rollup',        file: 'leads-rollup.json' },
  { key: 'leads-employees',     file: 'leads-employees.json' },
  // NAIC carrier complaint index (enriched with AM Best, per-state data, enforcement)
  { key: 'naic-complaint-index', file: 'naic-complaint-index.json' },
  // Full insurer rankings: composite scores + AM Best + market share + county storm risk
  { key: 'insurer-rankings',    file: 'insurer-rankings.json' },
];

const sql = postgres(DATABASE_URL, {
  ssl: DATABASE_URL.includes('railway.internal') ? false : { rejectUnauthorized: false },
  max: 4,
  // jsonb payloads can be big; let one upsert take its time
  idle_timeout: 60,
});

async function importDataset({ key, file }) {
  const fullPath = path.join(DATA_DIR, file);
  if (!fs.existsSync(fullPath)) {
    console.log(`  ✗ ${key.padEnd(18)} — file not found, skipping`);
    return { key, status: 'missing' };
  }
  const stat = fs.statSync(fullPath);
  const raw = fs.readFileSync(fullPath, 'utf8');
  const parsed = JSON.parse(raw);
  const rowCount = Array.isArray(parsed)
    ? parsed.length
    : Array.isArray(parsed?.features)
      ? parsed.features.length
      : Array.isArray(parsed?.all)
        ? parsed.all.length
        : 1;

  await sql`
    INSERT INTO intel_blobs (key, data, source_mtime, bytes, row_count, updated_at)
    VALUES (${key}, ${parsed}::jsonb, ${stat.mtime.toISOString()}, ${stat.size}, ${rowCount}, NOW())
    ON CONFLICT (key) DO UPDATE
      SET data = EXCLUDED.data,
          source_mtime = EXCLUDED.source_mtime,
          bytes = EXCLUDED.bytes,
          row_count = EXCLUDED.row_count,
          updated_at = NOW()
  `;
  const mb = (stat.size / 1024 / 1024).toFixed(1);
  console.log(`  ✓ ${key.padEnd(18)} — ${mb} MB · ${rowCount.toLocaleString()} rows`);
  return { key, status: 'ok', bytes: stat.size, rowCount };
}

(async () => {
  console.log(`=== RIQ 21 intel import → ${DATABASE_URL.includes('railway.internal') ? 'Railway' : 'local'} Postgres ===`);

  // Make sure the table exists (in case migrate hasn't run)
  await sql`
    CREATE TABLE IF NOT EXISTS intel_blobs (
      key TEXT PRIMARY KEY,
      data JSONB NOT NULL,
      source_mtime TIMESTAMP,
      bytes INTEGER DEFAULT 0,
      row_count INTEGER DEFAULT 0,
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `;

  const results = [];
  for (const ds of DATASETS) {
    try {
      results.push(await importDataset(ds));
    } catch (err) {
      console.log(`  ✗ ${ds.key.padEnd(18)} — ${err.message}`);
      results.push({ key: ds.key, status: 'error', error: err.message });
    }
  }

  // Merge all denial-sources/ individual case files into one blob.
  // Each file is a single case object {carrier, patentMapping, rooferTactic, lessonForAnalyzer, ...}.
  // Stored as an array under key 'denial-sources-full' for the algorithm decoder page.
  const DENIAL_SRC_DIR = path.join(DATA_DIR, 'denial-sources');
  if (fs.existsSync(DENIAL_SRC_DIR)) {
    const srcFiles = fs.readdirSync(DENIAL_SRC_DIR).filter((f) => f.endsWith('.json')).sort();
    const merged = srcFiles.map((f) => {
      try { return JSON.parse(fs.readFileSync(path.join(DENIAL_SRC_DIR, f), 'utf8')); }
      catch { return null; }
    }).filter(Boolean);
    if (merged.length > 0) {
      try {
        const totalBytes = srcFiles.reduce((sum, f) => sum + fs.statSync(path.join(DENIAL_SRC_DIR, f)).size, 0);
        await sql`
          INSERT INTO intel_blobs (key, data, source_mtime, bytes, row_count, updated_at)
          VALUES ('denial-sources-full', ${merged}::jsonb, NOW(), ${totalBytes}, ${merged.length}, NOW())
          ON CONFLICT (key) DO UPDATE
            SET data = EXCLUDED.data,
                source_mtime = EXCLUDED.source_mtime,
                bytes = EXCLUDED.bytes,
                row_count = EXCLUDED.row_count,
                updated_at = NOW()
        `;
        console.log(`  ✓ ${'denial-sources-full'.padEnd(18)} — ${(totalBytes/1024).toFixed(0)} KB · ${merged.length} cases`);
        results.push({ key: 'denial-sources-full', status: 'ok' });
      } catch (err) {
        console.log(`  ✗ denial-sources-full     — ${err.message}`);
        results.push({ key: 'denial-sources-full', status: 'error', error: err.message });
      }
    }
  }

  const ok = results.filter((r) => r.status === 'ok');
  const skipped = results.filter((r) => r.status !== 'ok');
  console.log('');
  console.log(`Summary: ${ok.length} imported, ${skipped.length} skipped/failed`);

  await sql.end();

  // Phase 4b: if projects was imported, also backfill the decomposed indexed
  // table so the per-row query endpoints don't fall behind the blob.
  const { spawn } = await import('node:child_process');
  const here = import.meta.dirname;
  async function runBackfill(script, label) {
    console.log('');
    console.log(`→ ${label}…`);
    const child = spawn('node', [path.join(here, script)], {
      stdio: 'inherit',
      env: process.env,
    });
    await new Promise((resolve) => child.on('close', resolve));
  }
  if (ok.some((r) => r.key === 'projects')) {
    await runBackfill('backfill-intel-projects.mjs', 'Backfilling intel_projects (Phase 4b)');
  }
  if (ok.some((r) => r.key === 'storm-exposure')) {
    await runBackfill('backfill-intel-customer-exposure.mjs', 'Backfilling intel_customer_exposure (Phase 4c)');
  }
  if (ok.some((r) => r.key === 'lifetime-touch')) {
    await runBackfill('backfill-intel-lifetime-touch.mjs', 'Backfilling intel_lifetime_touch (Phase 4d)');
  }
  // Phase 8a: leads backfill is file-driven, not blob-driven. Runs whenever
  // data/leads.json exists (refresh-all.sh writes it from admin/leads pull).
  if (fs.existsSync(path.join(DATA_DIR, 'leads.json'))) {
    await runBackfill('backfill-intel-leads.mjs', 'Backfilling intel_leads (Phase 8a)');
  }
})();
