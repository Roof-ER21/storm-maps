// Phase 4b backfill: read intel_blobs[projects] → write per-row to intel_projects.
//
// Idempotent: drops + reinserts the whole table each run. The projects blob is
// ~16k rows / 36 MB; full rewrite takes ~5-10s. Cheaper to truncate than to
// diff. Called automatically by import-to-postgres.mjs after a projects blob
// update; can also be run standalone:
//
//   DATABASE_URL=$RIQ_DB_PUBLIC_URL node scripts/roofdocs/backfill-intel-projects.mjs
//
// Reads carrier normalization from server/intel/carrier-normalize.mjs (single
// source of truth — same module the analyzer uses). Stores both normalized
// (`insurance`) and original (`insurance_raw`) for audit.

import postgres from 'postgres';
import { normalizeCarrier } from '../../server/intel/carrier-normalize.mjs';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const sql = postgres(DATABASE_URL, { ssl: 'require', max: 4 });

async function ensureTable() {
  // Idempotent — same DDL as server/migrate.ts. Lets standalone runs work
  // even if the migrate step hasn't run on this DB yet.
  await sql`
    CREATE TABLE IF NOT EXISTS intel_projects (
      id INTEGER PRIMARY KEY,
      customer TEXT,
      customer_id TEXT,
      address_line1 TEXT,
      city TEXT,
      state TEXT,
      zip TEXT,
      lat REAL,
      lng REAL,
      insurance TEXT,
      insurance_raw TEXT,
      adjuster_name TEXT,
      adjuster_phone TEXT,
      adjuster_email TEXT,
      claim_number TEXT,
      claim_type TEXT,
      job_type TEXT,
      stage TEXT,
      status_id INTEGER,
      sales_rep TEXT,
      rep_id TEXT,
      lead_source TEXT,
      house_type TEXT,
      roof_access TEXT,
      signed_date TEXT,
      completed_date TEXT,
      finalized_date TEXT,
      date_of_loss TEXT,
      job_total REAL,
      acv REAL,
      deductible REAL,
      insurance_total REAL,
      paused BOOLEAN DEFAULT FALSE,
      data JSONB NOT NULL,
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_intel_projects_carrier_zip ON intel_projects (insurance, zip)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_intel_projects_carrier_state ON intel_projects (insurance, state)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_intel_projects_rep_signed ON intel_projects (sales_rep, signed_date)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_intel_projects_zip ON intel_projects (zip)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_intel_projects_state_city ON intel_projects (state, city)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_intel_projects_stage ON intel_projects (stage)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_intel_projects_signed_date ON intel_projects (signed_date)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_intel_projects_adjuster ON intel_projects (adjuster_name)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_intel_projects_lead_source ON intel_projects (lead_source)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_intel_projects_latlng ON intel_projects USING BRIN (lat, lng)`;
}

async function loadProjectsBlob() {
  const rows = await sql`SELECT data FROM intel_blobs WHERE key = 'projects' LIMIT 1`;
  if (rows.length === 0) {
    throw new Error('intel_blobs[projects] not found — run import-to-postgres.mjs first');
  }
  const data = rows[0].data;
  if (!Array.isArray(data)) {
    throw new Error(`intel_blobs[projects].data is not an array (got ${typeof data})`);
  }
  return data;
}

function projectRow(p) {
  // Promote indexed columns; keep full record in `data` JSONB.
  const insuranceRaw = p.insurance ?? null;
  const insurance = insuranceRaw ? normalizeCarrier(insuranceRaw) : null;
  return {
    id: p.id,
    customer: p.customer ?? null,
    customer_id: p.customerId ?? null,
    address_line1: p.addressLine1 ?? null,
    city: p.city ?? null,
    state: p.state ?? null,
    zip: p.zip ?? null,
    lat: typeof p.lat === 'number' ? p.lat : null,
    lng: typeof p.lng === 'number' ? p.lng : null,
    insurance,
    insurance_raw: insuranceRaw,
    adjuster_name: p.adjusterName ?? null,
    adjuster_phone: p.adjusterPhone ?? null,
    adjuster_email: p.adjusterEmail ?? null,
    claim_number: p.claimNumber ?? null,
    claim_type: p.claimType ?? null,
    job_type: p.jobType ?? null,
    stage: p.stage ?? null,
    status_id: typeof p.statusId === 'number' ? p.statusId : null,
    sales_rep: p.salesRep ?? null,
    rep_id: p.repId ?? null,
    lead_source: p.leadSource ?? null,
    house_type: p.houseType ?? null,
    roof_access: p.roofAccess ?? null,
    signed_date: p.signedDate ?? p.projectSignedDate ?? null,
    completed_date: p.completedDate ?? null,
    finalized_date: p.finalizedDate ?? null,
    date_of_loss: p.dateOfLoss ?? null,
    job_total: typeof p.jobTotal === 'number' ? p.jobTotal : null,
    acv: typeof p.acv === 'number' ? p.acv : null,
    deductible: typeof p.deductible === 'number' ? p.deductible : null,
    insurance_total: typeof p.insuranceTotal === 'number' ? p.insuranceTotal : null,
    paused: Boolean(p.paused),
    data: p,
  };
}

async function backfill() {
  const t0 = Date.now();
  console.log('[backfill-intel-projects] Ensuring table + indexes…');
  await ensureTable();

  console.log('[backfill-intel-projects] Loading projects blob from intel_blobs…');
  const blob = await loadProjectsBlob();
  console.log(`[backfill-intel-projects] ${blob.length} rows from blob`);

  console.log('[backfill-intel-projects] Truncating intel_projects…');
  await sql`TRUNCATE TABLE intel_projects`;

  // Chunked insert to keep memory + statement size reasonable. postgres.js handles
  // VALUES expansion via sql(rows) helper.
  const CHUNK = 500;
  let inserted = 0;
  for (let i = 0; i < blob.length; i += CHUNK) {
    const slice = blob.slice(i, i + CHUNK).map(projectRow).filter((r) => r.id != null);
    if (slice.length === 0) continue;
    await sql`INSERT INTO intel_projects ${sql(slice)}`;
    inserted += slice.length;
    if (i % (CHUNK * 10) === 0) {
      process.stdout.write(`  ${inserted}/${blob.length}…\r`);
    }
  }
  process.stdout.write(`  ${inserted}/${blob.length} done.\n`);

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`[backfill-intel-projects] Inserted ${inserted} rows in ${elapsed}s`);

  // Sanity stats
  const [{ count: total }] = await sql`SELECT COUNT(*)::int AS count FROM intel_projects`;
  const carriers = await sql`SELECT insurance, COUNT(*)::int AS n FROM intel_projects WHERE insurance IS NOT NULL GROUP BY insurance ORDER BY n DESC LIMIT 5`;
  console.log(`[backfill-intel-projects] Total: ${total}`);
  console.log('[backfill-intel-projects] Top 5 carriers:');
  for (const row of carriers) console.log(`    ${row.insurance.padEnd(25)} ${row.n}`);

  await sql.end();
}

backfill().catch((err) => {
  console.error('[backfill-intel-projects] FAILED:', err);
  process.exit(1);
});
