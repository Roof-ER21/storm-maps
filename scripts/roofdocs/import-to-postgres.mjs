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

const DATA_DIR = path.resolve(import.meta.dirname, '..', '..', 'data');

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
  { key: 'storms-light',     file: 'storms/iem-hail-wind-2018-2026.json' },
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

  const ok = results.filter((r) => r.status === 'ok');
  const skipped = results.filter((r) => r.status !== 'ok');
  console.log('');
  console.log(`Summary: ${ok.length} imported, ${skipped.length} skipped/failed`);

  await sql.end();
})();
