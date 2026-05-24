// Phase 8c backfill: read data/fixes.json → write per-row to intel_fixes.
//
// Idempotent: TRUNCATE + reinsert each run (open-fixes set is small).
// Called by import-to-postgres.mjs after a fixes refresh; or standalone:
//
//   DATABASE_URL=$RIQ_DB_PUBLIC_URL node scripts/roofdocs/backfill-intel-fixes.mjs

import postgres from 'postgres';
import fs from 'node:fs';
import path from 'node:path';

const RIQ_BASE = process.env.RIQ_BASE || path.resolve(import.meta.dirname, '..', '..');
const FIXES_FILE = path.join(RIQ_BASE, 'data', 'fixes.json');

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const sql = postgres(DATABASE_URL, { ssl: 'require', max: 4 });

async function ensureTable() {
  await sql`
    CREATE TABLE IF NOT EXISTS intel_fixes (
      id INTEGER PRIMARY KEY,
      job_id INTEGER,
      employee_id INTEGER,
      trade TEXT,
      description TEXT,
      completed BOOLEAN DEFAULT FALSE,
      created_date TEXT,
      completed_date TEXT,
      photo_count INTEGER DEFAULT 0,
      data JSONB NOT NULL,
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_intel_fixes_emp_completed ON intel_fixes (employee_id, completed)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_intel_fixes_job ON intel_fixes (job_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_intel_fixes_open ON intel_fixes (created_date) WHERE completed = FALSE`;
}

function fixRow(f) {
  return {
    id: f.jobFixID,
    job_id: f.jobId ?? null,
    employee_id: f.employeeId ?? null,
    trade: f.trade ?? null,
    description: f.description ?? null,
    completed: typeof f.completed === 'boolean' ? f.completed : false,
    created_date: f.createdAt ?? null,
    completed_date: f.completedAt ?? null,
    photo_count: Array.isArray(f.photos) ? f.photos.length : 0,
    data: f,
  };
}

async function main() {
  if (!fs.existsSync(FIXES_FILE)) {
    console.error(`Missing ${FIXES_FILE} — the portal pull must run first`);
    process.exit(1);
  }
  const raw = JSON.parse(fs.readFileSync(FIXES_FILE, 'utf8'));
  const fixes = raw?.data ?? raw;
  if (!Array.isArray(fixes)) {
    console.error(`Expected array, got ${typeof fixes}`);
    process.exit(1);
  }

  console.log(`Backfilling intel_fixes (${fixes.length} rows)…`);
  await ensureTable();
  await sql`TRUNCATE intel_fixes`;
  const rows = fixes.map(fixRow).filter((r) => r.id != null);
  if (rows.length === 0) {
    console.log('No valid rows to insert');
    await sql.end();
    return;
  }
  const chunkSize = 200;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    await sql`INSERT INTO intel_fixes ${sql(chunk)}`;
    inserted += chunk.length;
  }
  console.log(`  ✓ inserted ${inserted} fixes`);
  await sql.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
