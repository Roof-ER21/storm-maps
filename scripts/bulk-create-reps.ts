/**
 * Bulk-import all sa21 active sales_reps into Hail Yes! `users`.
 * Sets PIN=1111 (argon2id) for every rep, role='rep'.
 *
 * Idempotent — runs `ON CONFLICT (email) DO UPDATE` so re-running just
 * re-syncs name/display_name. Existing pin_hash is preserved if a rep
 * has already changed it.
 *
 *   SA21_DATABASE_URL=...  HY_DATABASE_URL=...  npx tsx scripts/bulk-create-reps.ts
 */
import postgres from "postgres";
import argon2 from "argon2";

const SA21 = process.env.SA21_DATABASE_URL;
const HY   = process.env.HY_DATABASE_URL ?? process.env.DATABASE_URL;
if (!SA21 || !HY) {
  console.error("missing SA21_DATABASE_URL or HY_DATABASE_URL");
  process.exit(1);
}

const ARGON_OPTS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 19 * 1024,
  timeCost: 2,
  parallelism: 1,
};
const TEMP_PIN = "1111";

interface Sa21Rep { name: string; email: string; }

async function main(): Promise<void> {
  const sa21 = postgres(SA21!, { max: 1, onnotice: () => {} });
  const hy   = postgres(HY!,   { max: 1, onnotice: () => {} });

  console.log("Pulling sa21 active reps with emails...");
  const reps = await sa21<Sa21Rep[]>`
    SELECT name, email FROM sales_reps
    WHERE is_active = TRUE AND email IS NOT NULL AND email <> ''
    ORDER BY name
  `;
  console.log(`  found ${reps.length} active reps`);

  console.log(`Hashing PIN '${TEMP_PIN}' with argon2id...`);
  const pinHash = await argon2.hash(TEMP_PIN, ARGON_OPTS);

  let created = 0, updated = 0, skipped = 0;
  for (const r of reps) {
    const email = r.email.trim().toLowerCase();
    if (!email) continue;
    const name = r.name.trim();

    // Reps already have pin_hash? Don't overwrite.
    const exist = await hy<Array<{ id: number; pin_hash: string | null }>>`
      SELECT id, pin_hash FROM users WHERE email = ${email}
    `;
    if (exist.length > 0) {
      const u = exist[0]!;
      if (u.pin_hash) {
        // Just refresh name fields, leave PIN alone.
        await hy`UPDATE users SET name = ${name}, display_name = ${name} WHERE id = ${u.id}`;
        skipped++;
        continue;
      }
      // Has account but no PIN — set the temp PIN.
      await hy`
        UPDATE users SET
          name = ${name}, display_name = ${name}, role = 'rep',
          pin_length = 4, pin_hash = ${pinHash}, pin_set_at = NOW(),
          enroll_token = NULL, enroll_expires = NULL,
          failed_attempts = 0, locked_until = NULL
        WHERE id = ${u.id}
      `;
      updated++;
      continue;
    }
    // New user. password_hash is NOT NULL on legacy column — set it
    // to a sentinel that doesn't validate (login route still uses PIN
    // path; password path will fail-closed for these accounts, which
    // is exactly what we want).
    await hy`
      INSERT INTO users (email, name, display_name, password_hash, role, pin_length, pin_hash, pin_set_at)
      VALUES (${email}, ${name}, ${name}, '!pin-only', 'rep', 4, ${pinHash}, NOW())
    `;
    created++;
    if (created % 20 === 0) console.log(`  ...${created} created`);
  }
  console.log(`\nCreated=${created}  Updated=${updated}  Skipped(pin already set)=${skipped}`);

  const total = await hy<Array<{ n: number }>>`
    SELECT COUNT(*)::int AS n FROM users WHERE archived_at IS NULL
  `;
  const withPin = await hy<Array<{ n: number }>>`
    SELECT COUNT(*)::int AS n FROM users WHERE pin_hash IS NOT NULL AND archived_at IS NULL
  `;
  console.log(`Hail Yes users total: ${total[0]!.n}, with PIN: ${withPin[0]!.n}`);

  // Promote Ahmed to root admin (idempotent).
  await hy`
    UPDATE users SET role = 'admin', is_root_admin = TRUE
    WHERE email = 'ahmed.mahmoud@theroofdocs.com'
  `;
  const root = await hy<Array<{ n: number }>>`
    SELECT COUNT(*)::int AS n FROM users WHERE is_root_admin = TRUE
  `;
  console.log(`Root admin count: ${root[0]!.n} (must be 1)`);

  await sa21.end();
  await hy.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
