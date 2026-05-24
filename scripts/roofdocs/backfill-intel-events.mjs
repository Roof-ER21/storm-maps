// Phase 8d backfill: read data/events-sales.json + data/events-production.json →
// write per-row to intel_events. (events/customers + events/employees are entity
// directories, NOT calendar events — they are NOT ingested here.)
//
// Idempotent: TRUNCATE + reinsert each run. Called by import-to-postgres.mjs after
// an events refresh; or standalone:
//
//   DATABASE_URL=$RIQ_DB_PUBLIC_URL node scripts/roofdocs/backfill-intel-events.mjs

import postgres from 'postgres';
import fs from 'node:fs';
import path from 'node:path';

const RIQ_BASE = process.env.RIQ_BASE || path.resolve(import.meta.dirname, '..', '..');
const SOURCES = [
  { file: path.join(RIQ_BASE, 'data', 'events-sales.json'), source: 'sales' },
  { file: path.join(RIQ_BASE, 'data', 'events-production.json'), source: 'production' },
];

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const sql = postgres(DATABASE_URL, { ssl: 'require', max: 4 });

async function ensureTable() {
  await sql`
    CREATE TABLE IF NOT EXISTS intel_events (
      id TEXT PRIMARY KEY,
      event_type TEXT,
      audience TEXT,
      start_time TIMESTAMPTZ,
      end_time TIMESTAMPTZ,
      customer_id TEXT,
      lead_id TEXT,
      supplier_id TEXT,
      notes TEXT,
      source TEXT,
      last_updated TIMESTAMPTZ,
      data JSONB NOT NULL,
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_intel_events_start ON intel_events (start_time)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_intel_events_customer ON intel_events (customer_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_intel_events_lead ON intel_events (lead_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_intel_events_type ON intel_events (event_type)`;
}

// The feed has been seen as {data:[...]}; stay robust to a bare array, {events:[]},
// or a map keyed by id (values are event objects).
function extractArray(raw) {
  if (Array.isArray(raw)) return raw;
  if (raw && Array.isArray(raw.data)) return raw.data;
  if (raw && Array.isArray(raw.events)) return raw.events;
  if (raw && typeof raw === 'object') {
    const vals = Object.values(raw);
    if (vals.length && vals.every((v) => v && typeof v === 'object' && (v.eventID || v.eventId))) return vals;
  }
  return null;
}

function isoOrNull(v) {
  if (!v) return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

function eventRow(e, source) {
  const id = e.eventID ?? e.eventId ?? null;
  if (id == null) return null;
  return {
    id: String(id),
    event_type: e.eventType ?? null,
    audience: e.audience ?? null,
    start_time: isoOrNull(e.startTime),
    end_time: isoOrNull(e.endTime),
    customer_id: e.customerId ?? null,
    lead_id: e.leadId ?? null,
    supplier_id: e.supplierId ?? null,
    notes: e.notes ?? null,
    source,
    last_updated: isoOrNull(e.lastUpdated),
    data: e,
  };
}

async function main() {
  await ensureTable();
  const byId = new Map();
  let filesFound = 0;
  for (const { file, source } of SOURCES) {
    if (!fs.existsSync(file)) {
      console.warn(`(skip) ${path.basename(file)} not present`);
      continue;
    }
    filesFound++;
    const arr = extractArray(JSON.parse(fs.readFileSync(file, 'utf8')));
    if (!Array.isArray(arr)) {
      console.warn(`(skip) ${path.basename(file)}: could not find an event array`);
      continue;
    }
    let kept = 0;
    for (const e of arr) {
      const r = eventRow(e, source);
      if (r) { byId.set(r.id, r); kept++; }
    }
    console.log(`  ${source}: ${arr.length} events (${kept} valid)`);
  }
  if (filesFound === 0) {
    console.error('No event files present — the portal pull must run first');
    process.exit(1);
  }

  const rows = [...byId.values()];
  console.log(`Backfilling intel_events (${rows.length} unique events)…`);
  await sql`TRUNCATE intel_events`;
  if (rows.length === 0) {
    console.log('No valid rows to insert');
    await sql.end();
    return;
  }
  const chunkSize = 200;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    await sql`INSERT INTO intel_events ${sql(chunk)}`;
    inserted += chunk.length;
  }
  console.log(`  ✓ inserted ${inserted} events`);
  await sql.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
