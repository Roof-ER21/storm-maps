#!/usr/bin/env node
// Generic migration runner — applies a single .sql file against
// RIQ_DB_PUBLIC_URL (or DATABASE_URL). Used in lieu of psql for environments
// without it (Windows dev box). Matches the test-role-migration.mjs pattern.
//
// Usage:
//   node --env-file=.env.local scripts/apply-migration.mjs <path-to-sql>
//
// Notes:
// - The .sql file is expected to wrap its own BEGIN/COMMIT (or be safe under
//   postgres.js's implicit single-statement transaction). The runner doesn't
//   add a transaction wrapper.
// - Exits 1 on any error; SQL is reported by postgres.js with line info.
import postgres from 'postgres';
import { readFileSync } from 'node:fs';

const file = process.argv[2];
if (!file) {
  console.error('usage: node scripts/apply-migration.mjs <path-to-sql>');
  process.exit(1);
}

const url = process.env.RIQ_DB_PUBLIC_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error('missing RIQ_DB_PUBLIC_URL or DATABASE_URL env var');
  process.exit(1);
}

const sql = postgres(url, { max: 1, onnotice: () => {} });
try {
  const body = readFileSync(file, 'utf8');
  console.log(`[apply] ${file}`);
  await sql.unsafe(body);
  console.log(`[apply] OK`);
} catch (err) {
  console.error(`[apply] FAILED: ${err.message}`);
  process.exitCode = 1;
} finally {
  await sql.end();
}
