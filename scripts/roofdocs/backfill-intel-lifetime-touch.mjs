#!/usr/bin/env node
/**
 * Phase 4d backfill: flatten intel_blobs[lifetime-touch] into a per-customer
 * indexed table. Blob has byRep (rep → [rows]) + topTier; dedups across reps
 * by customer `key`. Each unique customer becomes one row.
 *
 *   DATABASE_URL=postgres://... node scripts/roofdocs/backfill-intel-lifetime-touch.mjs
 *
 * Wired into both import-to-postgres.mjs and refresh-railway.mjs.
 */
import postgres from 'postgres';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('[backfill-intel-lifetime-touch] DATABASE_URL not set');
  process.exit(1);
}

const sql = postgres(DATABASE_URL, {
  ssl: DATABASE_URL.includes('railway.internal') ? false : { rejectUnauthorized: false },
  max: 4,
});

async function main() {
  console.log('[backfill-intel-lifetime-touch] Loading blob from intel_blobs…');
  const blobRow = await sql`SELECT data FROM intel_blobs WHERE key = 'lifetime-touch' LIMIT 1`;
  if (blobRow.length === 0) {
    console.error('[backfill-intel-lifetime-touch] No lifetime-touch blob. Run import-to-postgres.mjs first.');
    await sql.end();
    process.exit(1);
  }
  const blob = blobRow[0].data;
  const byRep = blob.byRep || {};

  // Dedup: a customer can only appear in one rep's list, but defensive merge
  // by key picks the highest-score row if duplicates appear.
  const byKey = new Map();
  for (const repList of Object.values(byRep)) {
    if (!Array.isArray(repList)) continue;
    for (const c of repList) {
      const k = c.key;
      if (!k) continue;
      const existing = byKey.get(k);
      if (!existing || (c.score || 0) > (existing.score || 0)) {
        byKey.set(k, c);
      }
    }
  }
  console.log(`[backfill-intel-lifetime-touch] ${byKey.size} unique customers across ${Object.keys(byRep).length} reps`);

  await sql`TRUNCATE intel_lifetime_touch`;
  console.log('[backfill-intel-lifetime-touch] Truncated. Starting chunked insert…');

  const rows = [...byKey.values()].map((c) => ({
    key: c.key,
    customer: c.customer || null,
    address: c.address || null,
    city: c.city || null,
    state: c.state || null,
    zip: c.zip || null,
    lat: typeof c.lat === 'number' ? c.lat : null,
    lng: typeof c.lng === 'number' ? c.lng : null,
    customer_email: c.customerEmail || null,
    customer_cell: c.customerCell || null,
    sales_rep: c.salesRep || null,
    last_completed: c.lastCompleted || null,
    first_completed: c.firstCompleted || null,
    years_since_last: typeof c.yearsSinceLast === 'number' ? c.yearsSinceLast : null,
    job_count: c.jobCount || 0,
    insurance: c.insurance || null,
    storm_hits_since_last: c.stormHitsSinceLast || 0,
    hail_hits_since_last: c.hailHitsSinceLast || 0,
    strongest_storm_since_last: typeof c.strongestStormSinceLast === 'number' ? c.strongestStormSinceLast : null,
    score: c.score || 0,
    contact_quality: c.contactQuality || null,
    data: c,
  }));

  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    await sql`INSERT INTO intel_lifetime_touch ${sql(chunk,
      'key', 'customer', 'address', 'city', 'state', 'zip', 'lat', 'lng',
      'customer_email', 'customer_cell', 'sales_rep',
      'last_completed', 'first_completed', 'years_since_last', 'job_count',
      'insurance', 'storm_hits_since_last', 'hail_hits_since_last',
      'strongest_storm_since_last', 'score', 'contact_quality', 'data'
    )}`;
    console.log(`[backfill-intel-lifetime-touch]   inserted ${Math.min(i + CHUNK, rows.length)}/${rows.length}`);
  }

  const stats = await sql`SELECT
    COUNT(*)::int AS total,
    COUNT(DISTINCT sales_rep)::int AS reps,
    COUNT(*) FILTER (WHERE score >= 60)::int AS high_tier,
    COUNT(*) FILTER (WHERE score >= 40 AND score < 60)::int AS mid_tier,
    COUNT(*) FILTER (WHERE storm_hits_since_last > 0)::int AS with_storm
  FROM intel_lifetime_touch`;
  console.log(`[backfill-intel-lifetime-touch] Total: ${stats[0].total} customers / ${stats[0].reps} reps`);
  console.log(`[backfill-intel-lifetime-touch]   high_tier=${stats[0].high_tier}, mid_tier=${stats[0].mid_tier}, with_storm=${stats[0].with_storm}`);

  await sql.end();
}

main().catch((err) => {
  console.error('[backfill-intel-lifetime-touch] FAILED:', err);
  process.exit(1);
});
