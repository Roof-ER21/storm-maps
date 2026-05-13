#!/usr/bin/env node
/**
 * One-time backfill — normalize denial_intake.carrier + identified_carrier
 * for legacy rows that were submitted before the canonical normalizer shipped.
 *
 * Run via:
 *   railway run --service riq21 node scripts/roofdocs/backfill-intake-carriers.mjs
 *
 * Idempotent — skips rows already canonical.
 */
import postgres from 'postgres';
import { normalizeCarrier } from '../../server/intel/carrier-normalize.mjs';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL not set');
  process.exit(1);
}

const sql = postgres(url, { ssl: 'require' });

try {
  const rows = await sql`
    SELECT id, carrier, identified_carrier
    FROM denial_intake
    ORDER BY id
  `;
  console.log(`Loaded ${rows.length} rows`);

  let updated = 0;
  let skipped = 0;
  for (const r of rows) {
    const newCarrier = normalizeCarrier(r.carrier);
    const newIdent = normalizeCarrier(r.identified_carrier);

    const carrierChanged = newCarrier && newCarrier !== r.carrier;
    const identChanged = newIdent && newIdent !== r.identified_carrier;

    if (!carrierChanged && !identChanged) {
      skipped += 1;
      continue;
    }

    await sql`
      UPDATE denial_intake
      SET
        carrier = ${carrierChanged ? newCarrier : r.carrier},
        identified_carrier = ${identChanged ? newIdent : r.identified_carrier}
      WHERE id = ${r.id}
    `;

    console.log(
      `  id=${r.id}: ` +
        (carrierChanged ? `carrier: "${r.carrier}" → "${newCarrier}" ` : '') +
        (identChanged ? `identified: "${r.identified_carrier}" → "${newIdent}"` : '')
    );
    updated += 1;
  }

  console.log(`\nDone. Updated ${updated}, skipped ${skipped} (already canonical or unmatched).`);
} catch (e) {
  console.error('Backfill failed:', e.message);
  process.exit(1);
} finally {
  await sql.end();
}
