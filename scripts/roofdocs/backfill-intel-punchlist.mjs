// Phase 8c backfill: read data/punchlist.json → write per-row to intel_punchlist.
//
// Idempotent: TRUNCATE + reinsert each run (punch list is ~dozens of jobs).
// Called by import-to-postgres.mjs after a punch-list refresh; or standalone:
//
//   DATABASE_URL=$RIQ_DB_PUBLIC_URL node scripts/roofdocs/backfill-intel-punchlist.mjs

import postgres from 'postgres';
import fs from 'node:fs';
import path from 'node:path';

const RIQ_BASE = process.env.RIQ_BASE || path.resolve(import.meta.dirname, '..', '..');
const PUNCH_FILE = path.join(RIQ_BASE, 'data', 'punchlist.json');

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const sql = postgres(DATABASE_URL, { ssl: 'require', max: 4 });

async function ensureTable() {
  await sql`
    CREATE TABLE IF NOT EXISTS intel_punchlist (
      id INTEGER PRIMARY KEY,
      name TEXT,
      address_line1 TEXT,
      city TEXT,
      state TEXT,
      zip TEXT,
      user_id TEXT,
      project_manager_id TEXT,
      status_id INTEGER,
      substatus_id INTEGER,
      notes TEXT,
      using_enhanced_photos BOOLEAN DEFAULT FALSE,
      work_completed BOOLEAN DEFAULT FALSE,
      data JSONB NOT NULL,
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_intel_punchlist_status ON intel_punchlist (status_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_intel_punchlist_pm ON intel_punchlist (project_manager_id)`;
}

function punchRow(p) {
  return {
    id: p.jobID,
    name: p.name ?? null,
    address_line1: p.addressLine1 ?? null,
    city: p.city ?? null,
    state: p.state ?? null,
    zip: p.zipCode ?? null,
    user_id: p.userId ?? null,
    project_manager_id: p.projectManagerId ?? null,
    status_id: p.statusId ?? null,
    substatus_id: p.substatusId ?? null,
    notes: p.notes ?? null,
    using_enhanced_photos: typeof p.usingEnhancedPhotos === 'boolean' ? p.usingEnhancedPhotos : false,
    work_completed: typeof p.workCompleted === 'boolean' ? p.workCompleted : false,
    data: p,
  };
}

async function main() {
  if (!fs.existsSync(PUNCH_FILE)) {
    console.error(`Missing ${PUNCH_FILE} — the portal pull must run first`);
    process.exit(1);
  }
  const raw = JSON.parse(fs.readFileSync(PUNCH_FILE, 'utf8'));
  const punch = raw?.data ?? raw;
  if (!Array.isArray(punch)) {
    console.error(`Expected array, got ${typeof punch}`);
    process.exit(1);
  }

  console.log(`Backfilling intel_punchlist (${punch.length} rows)…`);
  await ensureTable();
  await sql`TRUNCATE intel_punchlist`;
  const rows = punch.map(punchRow).filter((r) => r.id != null);
  if (rows.length === 0) {
    console.log('No valid rows to insert');
    await sql.end();
    return;
  }
  const chunkSize = 200;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    await sql`INSERT INTO intel_punchlist ${sql(chunk)}`;
    inserted += chunk.length;
  }
  console.log(`  ✓ inserted ${inserted} punch-list jobs`);
  await sql.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
