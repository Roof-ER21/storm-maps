// Phase 8a backfill: read data/leads.json → write per-row to intel_leads.
//
// Idempotent: TRUNCATE + reinsert each run. The leads file is ~540 rows / 1MB;
// full rewrite is sub-second. Cheaper than diffing.
//
// Called automatically by import-to-postgres.mjs after a leads file refresh;
// can also be run standalone:
//
//   DATABASE_URL=$RIQ_DB_PUBLIC_URL node scripts/roofdocs/backfill-intel-leads.mjs

import postgres from 'postgres';
import fs from 'node:fs';
import path from 'node:path';

const RIQ_BASE = process.env.RIQ_BASE || path.resolve(import.meta.dirname, '..', '..');
const LEADS_FILE = path.join(RIQ_BASE, 'data', 'leads.json');

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const sql = postgres(DATABASE_URL, { ssl: 'require', max: 4 });

async function ensureTable() {
  await sql`
    CREATE TABLE IF NOT EXISTS intel_leads (
      lead_id INTEGER PRIMARY KEY,
      status TEXT,
      priority TEXT,
      lead_status TEXT,
      appointment_date TIMESTAMP,
      first_name TEXT,
      last_name TEXT,
      email TEXT,
      cell_phone TEXT,
      home_phone TEXT,
      address_line1 TEXT,
      address_line2 TEXT,
      city TEXT,
      state TEXT,
      zip TEXT,
      lat REAL,
      lng REAL,
      roof_age TEXT,
      roof_access TEXT,
      house_type TEXT,
      years_in_home INTEGER,
      referral_method TEXT,
      lives_at_property BOOLEAN,
      aluminum_siding BOOLEAN,
      discontinued TEXT,
      notes TEXT,
      sales_app_signup BOOLEAN,
      converted_to_customer BOOLEAN,
      active BOOLEAN,
      rep_id TEXT,
      rep_name TEXT,
      project_coordinator_id TEXT,
      project_coordinator_name TEXT,
      created_at TIMESTAMP,
      data JSONB NOT NULL,
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_intel_leads_status ON intel_leads (status)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_intel_leads_rep_status ON intel_leads (rep_id, status)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_intel_leads_zip_status ON intel_leads (zip, status)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_intel_leads_state ON intel_leads (state)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_intel_leads_created ON intel_leads (created_at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_intel_leads_appt ON intel_leads (appointment_date)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_intel_leads_converted ON intel_leads (converted_to_customer)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_intel_leads_referral ON intel_leads (referral_method)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_intel_leads_latlng ON intel_leads USING BRIN (lat, lng)`;
}

function leadRow(l) {
  const coords = l.coordinates?.coordinates ?? null;
  // Portal returns coordinates as [lat, lng] (not GeoJSON [lng, lat] standard).
  const lat = Array.isArray(coords) && coords.length >= 2 ? Number(coords[0]) : null;
  const lng = Array.isArray(coords) && coords.length >= 2 ? Number(coords[1]) : null;
  const repName = l.salesRep ? `${l.salesRep.firstName ?? ''} ${l.salesRep.lastName ?? ''}`.trim() : null;
  const pcName = l.projectCoordinator ? `${l.projectCoordinator.firstName ?? ''} ${l.projectCoordinator.lastName ?? ''}`.trim() : null;
  const yih = typeof l.yearsInHome === 'number' ? l.yearsInHome : null;

  return {
    lead_id: l.leadID,
    status: l.status ?? null,
    priority: l.priority ?? null,
    lead_status: l.leadStatus ?? null,
    appointment_date: l.appointmentDate ?? null,
    first_name: l.firstName ?? null,
    last_name: l.lastName ?? null,
    email: l.email ?? null,
    cell_phone: l.cellPhoneNumber ?? null,
    home_phone: l.homePhoneNumber ?? null,
    address_line1: l.addressLine1 ?? null,
    address_line2: l.addressLine2 ?? null,
    city: l.city ?? null,
    state: l.state ?? null,
    zip: l.zipCode ?? null,
    lat: Number.isFinite(lat) ? lat : null,
    lng: Number.isFinite(lng) ? lng : null,
    roof_age: l.roofAge ?? null,
    roof_access: l.roofAccess ?? null,
    house_type: l.houseType ?? null,
    years_in_home: yih,
    referral_method: l.referralMethod ?? null,
    lives_at_property: typeof l.livesAtProperty === 'boolean' ? l.livesAtProperty : null,
    aluminum_siding: typeof l.aluminumSiding === 'boolean' ? l.aluminumSiding : null,
    discontinued: l.discontinued ?? null,
    notes: l.notes ?? null,
    sales_app_signup: typeof l.salesAppSignUp === 'boolean' ? l.salesAppSignUp : null,
    converted_to_customer: typeof l.convertedToCustomer === 'boolean' ? l.convertedToCustomer : null,
    active: typeof l.active === 'boolean' ? l.active : null,
    rep_id: l.repId ?? null,
    rep_name: repName,
    project_coordinator_id: l.projectCoordinatorId ?? null,
    project_coordinator_name: pcName,
    created_at: l.createdAt ?? null,
    data: l,
  };
}

async function main() {
  if (!fs.existsSync(LEADS_FILE)) {
    console.error(`Missing ${LEADS_FILE} — refresh-all.sh must run first`);
    process.exit(1);
  }
  const raw = JSON.parse(fs.readFileSync(LEADS_FILE, 'utf8'));
  const leads = raw?.data ?? raw;
  if (!Array.isArray(leads)) {
    console.error(`Expected array, got ${typeof leads}`);
    process.exit(1);
  }

  console.log(`Backfilling intel_leads (${leads.length} rows)…`);
  await ensureTable();
  await sql`TRUNCATE intel_leads`;
  const rows = leads.map(leadRow).filter((r) => r.lead_id != null);
  if (rows.length === 0) {
    console.log('No valid rows to insert');
    await sql.end();
    return;
  }
  // Insert in chunks of 200
  const chunkSize = 200;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    await sql`INSERT INTO intel_leads ${sql(chunk)}`;
    inserted += chunk.length;
  }
  console.log(`  ✓ inserted ${inserted} leads`);
  await sql.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
