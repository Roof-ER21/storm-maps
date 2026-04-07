import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

/**
 * Create AI property analysis tables in the hailyes database.
 * Called from the main migrate.ts during startup.
 */
export async function ensureAiTables(db: PostgresJsDatabase) {
  console.log('[ai-migrate] Creating AI property analysis tables...');

  // Create enums (idempotent)
  await db.execute(sql`
    DO $$ BEGIN
      CREATE TYPE roof_type AS ENUM ('three_tab_shingle','architectural_shingle','designer_shingle','wood_shake','synthetic_shake','metal_standing_seam','metal_ribbed','tile_clay','tile_concrete','slate','flat_membrane','unknown');
    EXCEPTION WHEN duplicate_object THEN null; END $$
  `);
  await db.execute(sql`
    DO $$ BEGIN
      CREATE TYPE siding_type AS ENUM ('aluminum','vinyl','wood','fiber_cement','brick','stone','stucco','composite','unknown');
    EXCEPTION WHEN duplicate_object THEN null; END $$
  `);
  await db.execute(sql`
    DO $$ BEGIN
      CREATE TYPE condition_rating AS ENUM ('excellent','good','fair','poor','critical','unknown');
    EXCEPTION WHEN duplicate_object THEN null; END $$
  `);
  await db.execute(sql`
    DO $$ BEGIN
      CREATE TYPE analysis_status AS ENUM ('pending','geocoding','fetching_images','analyzing','completed','failed');
    EXCEPTION WHEN duplicate_object THEN null; END $$
  `);
  await db.execute(sql`
    DO $$ BEGIN
      CREATE TYPE batch_status AS ENUM ('uploading','processing','completed','failed');
    EXCEPTION WHEN duplicate_object THEN null; END $$
  `);

  // batch_jobs first (referenced by property_analyses)
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS batch_jobs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      file_name VARCHAR(255),
      total_addresses INTEGER DEFAULT 0,
      processed_count INTEGER DEFAULT 0,
      success_count INTEGER DEFAULT 0,
      failed_count INTEGER DEFAULT 0,
      status batch_status DEFAULT 'uploading',
      error_message TEXT,
      summary_stats JSONB,
      started_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT now()
    )
  `);

  // property_analyses — the core AI table
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS property_analyses (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      input_address TEXT NOT NULL,
      normalized_address TEXT,
      lat REAL,
      lng REAL,
      place_id VARCHAR(255),
      street_view_url TEXT,
      satellite_url TEXT,
      street_view_available BOOLEAN DEFAULT true,
      street_view_date VARCHAR(10),
      roof_type roof_type,
      roof_condition condition_rating,
      roof_age_estimate INTEGER,
      roof_confidence REAL,
      roof_color VARCHAR(100),
      is_aluminum_siding BOOLEAN DEFAULT false,
      siding_type siding_type,
      siding_condition condition_rating,
      siding_confidence REAL,
      roof_features JSONB DEFAULT '[]',
      siding_features JSONB DEFAULT '[]',
      reasoning TEXT,
      damage_indicators JSONB DEFAULT '[]',
      prospect_score INTEGER,
      is_high_priority BOOLEAN DEFAULT false,
      ai_raw_response JSONB,
      ai_model_used VARCHAR(100),
      starred BOOLEAN DEFAULT false,
      lead_status VARCHAR(30) DEFAULT 'new',
      rep_notes TEXT,
      last_contacted_at TIMESTAMPTZ,
      status analysis_status DEFAULT 'pending',
      error_message TEXT,
      batch_job_id UUID REFERENCES batch_jobs(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ DEFAULT now(),
      analyzed_at TIMESTAMPTZ
    )
  `);

  // Indexes
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_analyses_status ON property_analyses(status)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_analyses_batch_job_id ON property_analyses(batch_job_id)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_analyses_prospect_score ON property_analyses(prospect_score)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_analyses_is_high_priority ON property_analyses(is_high_priority)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_analyses_starred ON property_analyses(starred)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_analyses_lead_status ON property_analyses(lead_status)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_analyses_created_at ON property_analyses(created_at)`);
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_analyses_place_id ON property_analyses(place_id)`);

  // property_images — permanent image storage
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS property_images (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      analysis_id UUID NOT NULL REFERENCES property_analyses(id) ON DELETE CASCADE,
      image_type VARCHAR(30) NOT NULL,
      image_data TEXT NOT NULL,
      mime_type VARCHAR(20) DEFAULT 'image/jpeg',
      capture_date VARCHAR(10),
      lat REAL, lng REAL,
      size_bytes INTEGER,
      created_at TIMESTAMPTZ DEFAULT now()
    )
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_images_analysis_id ON property_images(analysis_id)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_images_type ON property_images(image_type)`);

  // activity_log — audit trail
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS activity_log (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      action VARCHAR(50) NOT NULL,
      analysis_id UUID,
      details JSONB,
      ip_address VARCHAR(45),
      created_at TIMESTAMPTZ DEFAULT now()
    )
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_activity_action ON activity_log(action)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_activity_created_at ON activity_log(created_at)`);

  // data_cache — enrichment API result caching
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS data_cache (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      cache_key VARCHAR(255) NOT NULL UNIQUE,
      data_type VARCHAR(30) NOT NULL,
      data JSONB NOT NULL,
      lat REAL,
      lng REAL,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ DEFAULT now()
    )
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_data_cache_key ON data_cache(cache_key)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_data_cache_type ON data_cache(data_type)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_data_cache_expires ON data_cache(expires_at)`);

  console.log('[ai-migrate] AI tables ready.');
}
