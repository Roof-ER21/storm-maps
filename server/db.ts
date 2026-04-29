import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';
import * as aiSchema from './ai/schema.js';

const connectionString = process.env.DATABASE_URL || 'postgresql://localhost:5432/hailyes';

function positiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const pgMaxConnections = positiveIntEnv(
  'PG_MAX_CONNECTIONS',
  process.env.NODE_ENV === 'production' ? 6 : 10,
);

// Silence "relation X already exists, skipping" NOTICEs that flood the log
// every boot because the migrate scripts use idempotent CREATE IF NOT EXISTS.
// Real errors still surface — postgres.js routes those through the query
// rejection path, not the notice channel. Anything ≥ WARNING still prints.
export const sql = postgres(connectionString, {
  max: pgMaxConnections,
  connect_timeout: positiveIntEnv('PG_CONNECT_TIMEOUT_SECONDS', 8),
  idle_timeout: positiveIntEnv('PG_IDLE_TIMEOUT_SECONDS', 30),
  onnotice: (notice) => {
    if (notice.severity && notice.severity !== 'NOTICE') {
      console.warn('[pg notice]', notice.severity, notice.message);
    }
  },
});
export const db = drizzle(sql, { schema: { ...schema, ...aiSchema } });
export type DB = typeof db;
