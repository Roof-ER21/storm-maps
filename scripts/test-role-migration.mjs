#!/usr/bin/env node
// Phase 2a — round-trip + dry-run test for 300_role_taxonomy migration.
// Mac condition 1 + 2: prove the rollback path leaves users in pre-state,
// AND surface the proposed role distribution before applying.
//
// Safety: every statement runs inside a single BEGIN ... ROLLBACK block.
// Nothing commits. Prod state is unchanged after the script exits.
//
// Run:
//   node --env-file=.env.local scripts/test-role-migration.mjs
import postgres from 'postgres';

const url = process.env.RIQ_DB_PUBLIC_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error('missing RIQ_DB_PUBLIC_URL or DATABASE_URL');
  process.exit(1);
}

const sql = postgres(url, { onnotice: () => {} });

function dumpState(rows) {
  return rows.map((r) => Object.entries(r).map(([k, v]) => `${k}=${v}`).join(' | ')).join('\n');
}

async function captureStructuralState(transactionSql) {
  const column = await transactionSql`
    SELECT column_name, data_type, column_default, is_nullable
      FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'role'
  `;
  const constraint = await transactionSql`
    SELECT conname, pg_get_constraintdef(oid) AS def
      FROM pg_constraint
     WHERE conrelid = 'public.users'::regclass
       AND conname = 'users_role_check'
  `;
  return { column, constraint };
}

function fmtState(s) {
  return [
    '  column:',
    dumpState(s.column).split('\n').map(line => '    ' + line).join('\n'),
    '  constraint:',
    dumpState(s.constraint).split('\n').map(line => '    ' + line).join('\n'),
  ].join('\n');
}

const FORWARD = `
  ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
  UPDATE users SET role = 'employee' WHERE role = 'rep' OR role IS NULL;
  UPDATE users SET role = 'exec'     WHERE role = 'manager';
  ALTER TABLE users ALTER COLUMN role SET DEFAULT 'employee';
  ALTER TABLE users ALTER COLUMN role SET NOT NULL;
  ALTER TABLE users ADD CONSTRAINT users_role_check
    CHECK (role IN ('admin','exec','employee','analytics'));
`;

const DOWN = `
  ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
  UPDATE users SET role = 'rep'     WHERE role = 'employee';
  UPDATE users SET role = 'manager' WHERE role = 'exec';
  UPDATE users SET role = 'rep'     WHERE role = 'analytics';
  ALTER TABLE users ALTER COLUMN role SET DEFAULT 'rep';
  ALTER TABLE users ALTER COLUMN role DROP NOT NULL;
  ALTER TABLE users ADD CONSTRAINT users_role_check
    CHECK (role IN ('rep','admin','manager'));
`;

try {
  console.log('=== Phase 2a migration test ===\n');

  // --- 1. Pre-state snapshot (outside TX, observed state of prod) ---
  console.log('STEP 1: pre-migration state of users.role');
  const pre = await captureStructuralState(sql);
  console.log(fmtState(pre));

  const preDist = await sql`SELECT role, COUNT(*)::int AS n FROM users GROUP BY role ORDER BY role`;
  console.log('  distribution:');
  for (const r of preDist) console.log(`    role=${r.role} n=${r.n}`);
  console.log();

  // --- 2. Dry-run forward (TX 1: forward + distribution + rollback) ---
  console.log('STEP 2: dry-run forward — distribution after backfill');
  await sql.begin(async (tx) => {
    await tx.unsafe(FORWARD);
    const postForward = await tx`SELECT role, COUNT(*)::int AS n FROM users GROUP BY role ORDER BY role`;
    console.log('  distribution after forward:');
    for (const r of postForward) console.log(`    role=${r.role} n=${r.n}`);
    // Throw to trigger rollback explicitly
    throw new Error('intentional rollback after dry-run');
  }).catch((e) => {
    if (e.message !== 'intentional rollback after dry-run') throw e;
  });
  console.log('  (rolled back — prod unchanged)\n');

  // --- 3. Round-trip test (TX 2: forward + down + capture + rollback) ---
  console.log('STEP 3: roundtrip — forward then down, capture both states');
  await sql.begin(async (tx) => {
    await tx.unsafe(FORWARD);
    const midState = await captureStructuralState(tx);
    console.log('  mid-state (after forward):');
    console.log(fmtState(midState));

    await tx.unsafe(DOWN);
    const postState = await captureStructuralState(tx);
    console.log('  post-state (after down):');
    console.log(fmtState(postState));

    // Compare pre vs post inside the TX
    const preCol  = JSON.stringify(pre.column);
    const postCol = JSON.stringify(postState.column);
    const preCon  = JSON.stringify(pre.constraint);
    const postCon = JSON.stringify(postState.constraint);

    console.log('\n  ROUND-TRIP COMPARISON:');
    console.log(`    column:     ${preCol === postCol ? 'IDENTICAL ✓' : 'DRIFT'}`);
    console.log(`    constraint: ${preCon === postCon ? 'IDENTICAL ✓' : 'DRIFT'}`);
    if (preCol !== postCol || preCon !== postCon) {
      console.log('    !!! DRIFT DETAILS !!!');
      console.log('    pre column:', preCol);
      console.log('    post column:', postCol);
      console.log('    pre constraint:', preCon);
      console.log('    post constraint:', postCon);
    }

    throw new Error('intentional rollback after roundtrip');
  }).catch((e) => {
    if (e.message !== 'intentional rollback after roundtrip') throw e;
  });
  console.log('\n  (rolled back — prod unchanged)\n');

  // --- 4. Post-test verification (outside TX, prod still unchanged) ---
  console.log('STEP 4: post-test prod state (should equal STEP 1)');
  const after = await captureStructuralState(sql);
  console.log(fmtState(after));

  const aColJSON = JSON.stringify(after.column);
  const aConJSON = JSON.stringify(after.constraint);
  const preColJSON = JSON.stringify(pre.column);
  const preConJSON = JSON.stringify(pre.constraint);
  console.log('\n  PROD UNCHANGED:');
  console.log(`    column:     ${preColJSON === aColJSON ? 'IDENTICAL ✓' : 'DRIFT'}`);
  console.log(`    constraint: ${preConJSON === aConJSON ? 'IDENTICAL ✓' : 'DRIFT'}`);
} finally {
  await sql.end();
}
