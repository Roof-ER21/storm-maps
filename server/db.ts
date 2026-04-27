import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';
import * as aiSchema from './ai/schema.js';

const connectionString = process.env.DATABASE_URL || 'postgresql://localhost:5432/hailyes';
// Silence "relation X already exists, skipping" NOTICEs that flood the log
// every boot because the migrate scripts use idempotent CREATE IF NOT EXISTS.
// Real errors still surface — postgres.js routes those through the query
// rejection path, not the notice channel. Anything ≥ WARNING still prints.
export const sql = postgres(connectionString, {
  onnotice: (notice) => {
    if (notice.severity && notice.severity !== 'NOTICE') {
      console.warn('[pg notice]', notice.severity, notice.message);
    }
  },
});
export const db = drizzle(sql, { schema: { ...schema, ...aiSchema } });
export type DB = typeof db;
