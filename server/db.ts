import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';
import * as aiSchema from './ai/schema.js';

const connectionString = process.env.DATABASE_URL || 'postgresql://localhost:5432/hailyes';
export const sql = postgres(connectionString);
export const db = drizzle(sql, { schema: { ...schema, ...aiSchema } });
export type DB = typeof db;
