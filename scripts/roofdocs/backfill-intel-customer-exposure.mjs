#!/usr/bin/env node
/**
 * Phase 4c backfill: read storm-exposure rows from intel_blobs and upsert
 * each per-customer record into intel_customer_exposure for indexed queries.
 *
 * Dedup key: lower(customer || '|' || addressLine1). Matches what
 * customer-deep and customer-leads use.
 *
 * Idempotent — truncates the table then chunked INSERT. Standalone CLI:
 *
 *   DATABASE_URL=postgres://... node scripts/roofdocs/backfill-intel-customer-exposure.mjs
 *
 * Wired into both import-to-postgres.mjs (manual refresh) and
 * refresh-railway.mjs (stealth refresh).
 */
import postgres from 'postgres';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('[backfill-intel-customer-exposure] DATABASE_URL not set');
  process.exit(1);
}

const sql = postgres(DATABASE_URL, {
  ssl: DATABASE_URL.includes('railway.internal') ? false : { rejectUnauthorized: false },
  max: 4,
});

function custKey(c) {
  return (
    String(c.customer || '').trim().toLowerCase() + '|' +
    String(c.addressLine1 || '').trim().toLowerCase()
  );
}

async function main() {
  console.log('[backfill-intel-customer-exposure] Loading blob from intel_blobs...');
  const blobRow = await sql`SELECT data FROM intel_blobs WHERE key = 'storm-exposure' LIMIT 1`;
  if (blobRow.length === 0) {
    console.error('[backfill-intel-customer-exposure] No storm-exposure blob in intel_blobs. Run import-to-postgres.mjs first.');
    await sql.end();
    process.exit(1);
  }
  const entries = blobRow[0].data;
  if (!Array.isArray(entries)) {
    console.error('[backfill-intel-customer-exposure] Blob is not an array.');
    await sql.end();
    process.exit(1);
  }
  console.log(`[backfill-intel-customer-exposure] ${entries.length} customer exposure rows in blob`);

  // Dedup — last-write-wins on collisions (rare; shouldn't happen but defensive).
  const byKey = new Map();
  for (const c of entries) {
    const k = custKey(c);
    if (!k.replace(/\|/g, '').trim()) continue;
    byKey.set(k, c);
  }
  console.log(`[backfill-intel-customer-exposure] ${byKey.size} unique keys after dedup`);

  await sql`TRUNCATE intel_customer_exposure`;
  console.log('[backfill-intel-customer-exposure] Truncated. Starting chunked insert...');

  const rows = [...byKey.entries()].map(([key, c]) => {
    const s = c.strongestStorm || {};
    const m = c.mostRecentStorm || {};
    return {
      key,
      customer: c.customer || null,
      address_line1: c.addressLine1 || null,
      city: c.city || null,
      state: c.state || null,
      zip: c.zip || null,
      lat: typeof c.lat === 'number' ? c.lat : null,
      lng: typeof c.lng === 'number' ? c.lng : null,
      customer_email: c.customerEmail || null,
      customer_cell: c.customerCell || null,
      storm_count: c.stormCount || 0,
      hail_count: (c.allStorms || []).filter((x) => x.type === 'HAIL').length,
      strongest_storm_type: s.type || null,
      strongest_storm_mag: typeof s.mag === 'number' ? s.mag : null,
      strongest_storm_unit: s.unit || null,
      strongest_storm_date: s.valid || null,
      most_recent_storm_date: m.valid || null,
      most_recent_storm_type: m.type || null,
      most_recent_storm_mag: typeof m.mag === 'number' ? m.mag : null,
      first_contact: c.firstContact || null,
      last_date: c.lastDate || null,
      job_count: c.jobCount || 0,
      completed_job_count: c.completedJobCount || 0,
      total_rev: c.totalRev || 0,
      has_roof: !!c.hasRoof,
      data: c,
    };
  });

  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    await sql`INSERT INTO intel_customer_exposure ${sql(chunk,
      'key', 'customer', 'address_line1', 'city', 'state', 'zip', 'lat', 'lng',
      'customer_email', 'customer_cell', 'storm_count', 'hail_count',
      'strongest_storm_type', 'strongest_storm_mag', 'strongest_storm_unit', 'strongest_storm_date',
      'most_recent_storm_date', 'most_recent_storm_type', 'most_recent_storm_mag',
      'first_contact', 'last_date', 'job_count', 'completed_job_count', 'total_rev',
      'has_roof', 'data'
    )}`;
    console.log(`[backfill-intel-customer-exposure]   inserted ${Math.min(i + CHUNK, rows.length)}/${rows.length}`);
  }

  const stats = await sql`SELECT
    COUNT(*)::int AS total,
    COUNT(*) FILTER (WHERE storm_count > 0)::int AS with_storms,
    COUNT(*) FILTER (WHERE hail_count > 0)::int AS with_hail,
    COUNT(*) FILTER (
      WHERE most_recent_storm_date IS NOT NULL
        AND most_recent_storm_date::timestamptz >= NOW() - INTERVAL '90 days'
    )::int AS recent_90d
  FROM intel_customer_exposure`;
  console.log(`[backfill-intel-customer-exposure] Total: ${stats[0].total}`);
  console.log(`[backfill-intel-customer-exposure]   with_storms=${stats[0].with_storms}, with_hail=${stats[0].with_hail}, recent_90d=${stats[0].recent_90d}`);

  await sql.end();
}

main().catch((err) => {
  console.error('[backfill-intel-customer-exposure] FAILED:', err);
  process.exit(1);
});
