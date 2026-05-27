// Phase 8c backfill: read data/tasks.json → write per-row to intel_tasks.
//
// Idempotent: TRUNCATE + reinsert each run. Called by import-to-postgres.mjs
// after a tasks refresh; or standalone:
//
//   DATABASE_URL=$RIQ_DB_PUBLIC_URL node scripts/roofdocs/backfill-intel-tasks.mjs

import postgres from 'postgres';
import fs from 'node:fs';
import path from 'node:path';

const RIQ_BASE = process.env.RIQ_BASE || path.resolve(import.meta.dirname, '..', '..');
const TASKS_FILE = path.join(RIQ_BASE, 'data', 'tasks.json');

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const sql = postgres(DATABASE_URL, { ssl: 'require', max: 4 });

async function ensureTable() {
  await sql`
    CREATE TABLE IF NOT EXISTS intel_tasks (
      id INTEGER PRIMARY KEY,
      description TEXT,
      priority TEXT,
      employee_id TEXT,
      customer_id TEXT,
      assignor_id TEXT,
      contractor_id TEXT,
      due_date TEXT,
      created_date TEXT,
      completed_date TEXT,
      pending BOOLEAN DEFAULT TRUE,
      archived BOOLEAN DEFAULT FALSE,
      notes TEXT,
      data JSONB NOT NULL,
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_intel_tasks_emp_completed ON intel_tasks (employee_id, completed_date)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_intel_tasks_cust_due ON intel_tasks (customer_id, due_date)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_intel_tasks_overdue ON intel_tasks (due_date) WHERE pending = TRUE AND archived = FALSE`;
}

function taskRow(t) {
  return {
    id: t.taskListID,
    description: t.description ?? null,
    priority: t.priority ?? null,
    employee_id: t.employeeId ?? null,
    customer_id: t.customerId != null ? String(t.customerId) : null,
    assignor_id: t.assignorId ?? null,
    contractor_id: t.contractorId ?? null,
    due_date: t.dueDate ?? null,
    created_date: t.createdAt ?? null,
    completed_date: t.completedAt ?? null,
    pending: typeof t.pending === 'boolean' ? t.pending : true,
    archived: typeof t.archived === 'boolean' ? t.archived : false,
    notes: t.notes ?? null,
    data: t,
  };
}

async function main() {
  if (!fs.existsSync(TASKS_FILE)) {
    console.error(`Missing ${TASKS_FILE} — the portal pull must run first`);
    process.exit(1);
  }
  const raw = JSON.parse(fs.readFileSync(TASKS_FILE, 'utf8'));
  const tasks = raw?.data ?? raw;
  if (!Array.isArray(tasks)) {
    console.error(`Expected array, got ${typeof tasks}`);
    process.exit(1);
  }

  console.log(`Backfilling intel_tasks (${tasks.length} rows)…`);
  await ensureTable();
  await sql`TRUNCATE intel_tasks`;
  const rows = tasks.map(taskRow).filter((r) => r.id != null);
  if (rows.length === 0) {
    console.log('No valid rows to insert');
    await sql.end();
    return;
  }
  const chunkSize = 200;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    await sql`INSERT INTO intel_tasks ${sql(chunk)}`;
    inserted += chunk.length;
  }
  console.log(`  ✓ inserted ${inserted} tasks`);
  await sql.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
