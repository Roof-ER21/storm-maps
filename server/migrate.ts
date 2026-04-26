import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { ensureAiTables } from './ai/migrate.js';

const connectionString = process.env.DATABASE_URL || 'postgresql://localhost:5432/hailyes';
const sql = postgres(connectionString);

async function migrate() {
  console.log('[migrate] Creating tables...');

  await sql`
    CREATE TABLE IF NOT EXISTS reps (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      team_code TEXT DEFAULT '',
      role TEXT DEFAULT 'rep',
      created_at TIMESTAMP DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS properties (
      id TEXT PRIMARY KEY,
      location_label TEXT NOT NULL,
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      result_type TEXT DEFAULT 'address',
      radius_miles REAL DEFAULT 20,
      history_preset TEXT DEFAULT '1y',
      since_date TEXT,
      storm_date_count REAL DEFAULT 0,
      latest_storm_date TEXT,
      latest_max_hail_inches REAL DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS leads (
      id TEXT PRIMARY KEY,
      property_label TEXT NOT NULL,
      storm_date TEXT NOT NULL,
      storm_label TEXT NOT NULL,
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      location_label TEXT NOT NULL,
      source_event_id TEXT,
      source_label TEXT DEFAULT '',
      top_hail_inches REAL DEFAULT 0,
      report_count REAL DEFAULT 0,
      evidence_count REAL DEFAULT 0,
      priority TEXT DEFAULT 'Monitor',
      status TEXT DEFAULT 'queued',
      outcome TEXT DEFAULT 'none',
      lead_stage TEXT DEFAULT 'new',
      notes TEXT DEFAULT '',
      reminder_at TEXT,
      assigned_rep TEXT DEFAULT '',
      deal_value REAL,
      stage_history JSONB DEFAULT '[]',
      homeowner_name TEXT DEFAULT '',
      homeowner_phone TEXT DEFAULT '',
      homeowner_email TEXT DEFAULT '',
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),
      visited_at TIMESTAMP,
      completed_at TIMESTAMP
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS evidence (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      provider TEXT NOT NULL,
      media_type TEXT NOT NULL,
      property_label TEXT NOT NULL,
      storm_date TEXT,
      title TEXT NOT NULL,
      notes TEXT,
      external_url TEXT,
      thumbnail_url TEXT,
      published_at TEXT,
      file_name TEXT,
      mime_type TEXT,
      size_bytes REAL,
      status TEXT DEFAULT 'pending',
      include_in_report BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS archives (
      id TEXT PRIMARY KEY,
      property_label TEXT NOT NULL,
      summary_label TEXT NOT NULL,
      stops JSONB DEFAULT '[]',
      created_at TIMESTAMP DEFAULT NOW(),
      archived_at TIMESTAMP DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS shareable_reports (
      id SERIAL PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      address TEXT NOT NULL,
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      storm_date TEXT NOT NULL,
      storm_label TEXT NOT NULL,
      max_hail_inches REAL DEFAULT 0,
      max_wind_mph REAL DEFAULT 0,
      event_count REAL DEFAULT 0,
      rep_name TEXT,
      rep_phone TEXT,
      company_name TEXT,
      homeowner_name TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      expires_at TIMESTAMP
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      plan TEXT DEFAULT 'free',
      stripe_customer_id TEXT,
      stripe_subscription_id TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `;

  // Swath polygon cache — see schema.ts for the rationale.
  await sql`
    CREATE TABLE IF NOT EXISTS swath_cache (
      id SERIAL PRIMARY KEY,
      source TEXT NOT NULL,
      date TEXT NOT NULL,
      bbox_hash TEXT NOT NULL,
      bbox_north REAL NOT NULL,
      bbox_south REAL NOT NULL,
      bbox_east REAL NOT NULL,
      bbox_west REAL NOT NULL,
      metadata JSONB DEFAULT '{}',
      payload JSONB NOT NULL,
      feature_count INTEGER DEFAULT 0,
      max_value REAL DEFAULT 0,
      generated_at TIMESTAMP DEFAULT NOW(),
      expires_at TIMESTAMP NOT NULL
    )
  `;
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS swath_cache_lookup_idx
      ON swath_cache (source, date, bbox_hash)
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS swath_cache_expires_idx
      ON swath_cache (expires_at)
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS swath_cache_date_idx
      ON swath_cache (source, date)
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id SERIAL PRIMARY KEY,
      endpoint TEXT NOT NULL UNIQUE,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      rep_id TEXT,
      territory_states JSONB DEFAULT '[]',
      user_agent TEXT,
      label TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),
      invalidated_at TIMESTAMP,
      last_pushed_at TIMESTAMP,
      last_alert_id TEXT
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS push_subscriptions_active_idx
      ON push_subscriptions (rep_id) WHERE invalidated_at IS NULL
  `;

  // Verified hail events — write-after-compute target for the consilience
  // service (server/storm/consilienceService.ts). Optional optimization layer:
  // the consilience service runs stateless from the 5 underlying sources, but
  // when it produces a positive result the row gets upserted here so repeat
  // adjuster-PDF generation for the same (date, property) doesn't re-fetch.
  // Schema mirrors a minimal subset of sa21's verified_hail_events (per-source
  // boolean flags + a confidence tier); add columns as more sources land.
  await sql`
    CREATE TABLE IF NOT EXISTS verified_hail_events (
      id SERIAL PRIMARY KEY,
      event_date DATE NOT NULL,
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      lat_bucket TEXT NOT NULL,
      lng_bucket TEXT NOT NULL,
      hail_size_inches REAL DEFAULT 0,
      source_mrms BOOLEAN DEFAULT FALSE,
      source_spc_hail BOOLEAN DEFAULT FALSE,
      source_iem_lsr BOOLEAN DEFAULT FALSE,
      source_wind_context BOOLEAN DEFAULT FALSE,
      source_synoptic BOOLEAN DEFAULT FALSE,
      confirmed_count INTEGER DEFAULT 0,
      confidence_tier TEXT DEFAULT 'none',
      consilience_payload JSONB,
      generated_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `;
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS verified_hail_events_dedup_idx
      ON verified_hail_events (event_date, lat_bucket, lng_bucket)
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS verified_hail_events_date_idx
      ON verified_hail_events (event_date)
  `;

  // ── Migration to event-type-aware dedup ─────────────────────────────
  // Original dedup (event_date, lat_bucket, lng_bucket) merged Hail+Wind
  // at the same cell, corrupting the magnitude column. Migrate to include
  // event_type. Idempotent: counts the index's columns and only flips
  // when it has 3 (old key) → 4 (new key with event_type).
  const idxColCount = await sql<Array<{ count: number }>>`
    SELECT array_length(indkey::int2[], 1) AS count
      FROM pg_index pi
      JOIN pg_class pc ON pc.oid = pi.indexrelid
     WHERE pc.relname = 'verified_hail_events_dedup_idx'
     LIMIT 1
  `;
  const colCount = idxColCount[0] ? Number(idxColCount[0].count) : 0;
  console.log(`[migrate] verified_hail_events_dedup_idx column count: ${colCount}`);
  if (colCount === 3) {
    console.log(
      '[migrate] Switching verified_hail_events dedup key to (event_date, lat_bucket, lng_bucket, event_type)…',
    );
    await sql`DROP INDEX verified_hail_events_dedup_idx`;
    const wiped = await sql<Array<{ count: number }>>`
      DELETE FROM verified_hail_events
       WHERE source_ncei_storm_events = TRUE
       RETURNING 1 AS count
    `;
    console.log(`[migrate] Wiped ${wiped.length} NCEI rows for clean re-ingest.`);
    await sql`
      CREATE UNIQUE INDEX verified_hail_events_dedup_idx
        ON verified_hail_events (event_date, lat_bucket, lng_bucket, event_type)
    `;
    console.log('[migrate] New 4-column dedup key created.');
  }

  // Extend verified_hail_events with the full source-flag set + event metadata
  // for backfill ingestion. Idempotent — ADD COLUMN IF NOT EXISTS lets the
  // base CREATE TABLE above stay minimal while later adds extend cleanly.
  await sql`ALTER TABLE verified_hail_events
    ADD COLUMN IF NOT EXISTS source_ncei_storm_events BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS source_ncei_swdi BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS source_mping BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS source_hailtrace BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS source_nws_warnings BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS event_type TEXT,
    ADD COLUMN IF NOT EXISTS magnitude REAL,
    ADD COLUMN IF NOT EXISTS magnitude_type TEXT,
    ADD COLUMN IF NOT EXISTS state_code TEXT,
    ADD COLUMN IF NOT EXISTS county TEXT,
    ADD COLUMN IF NOT EXISTS wfo TEXT,
    ADD COLUMN IF NOT EXISTS episode_id BIGINT,
    ADD COLUMN IF NOT EXISTS ncei_event_id BIGINT,
    ADD COLUMN IF NOT EXISTS narrative TEXT,
    ADD COLUMN IF NOT EXISTS begin_time_utc TIMESTAMP,
    ADD COLUMN IF NOT EXISTS end_time_utc TIMESTAMP,
    ADD COLUMN IF NOT EXISTS consilience_generated_at TIMESTAMP,
    ADD COLUMN IF NOT EXISTS tor_f_scale TEXT
  `;
  // Consilience cache table — keyed on (date, property point) at 0.01°
  // resolution (~0.7 mi). Stores the full 10-source result so dashboard
  // reads are sub-50ms DB lookups instead of 10 concurrent network fetches.
  await sql`
    CREATE TABLE IF NOT EXISTS consilience_cache (
      id SERIAL PRIMARY KEY,
      event_date DATE NOT NULL,
      lat_q REAL NOT NULL,
      lng_q REAL NOT NULL,
      radius_miles REAL NOT NULL,
      confirmed_count INTEGER NOT NULL,
      confidence_tier TEXT NOT NULL,
      payload JSONB NOT NULL,
      generated_at TIMESTAMP DEFAULT NOW()
    )
  `;
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS consilience_cache_lookup_idx
      ON consilience_cache (event_date, lat_q, lng_q, radius_miles)
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS consilience_cache_generated_idx
      ON consilience_cache (generated_at)
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS verified_hail_events_state_idx
      ON verified_hail_events (state_code, event_date)
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS verified_hail_events_event_type_idx
      ON verified_hail_events (event_type)
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS verified_hail_events_ncei_event_id_idx
      ON verified_hail_events (ncei_event_id)
  `;

  // storm_days materialized view — pre-computed (event_date, region) ->
  // (max_hail_inches, max_wind_mph, source_count, confidence_tier) rollup
  // from verified_hail_events. Backs the dashboard's "Recent Storm Dates"
  // list without re-running the multi-source aggregator on every render.
  // Created as a view (not materialized) initially so it stays correct as
  // verified_hail_events grows; can be promoted to materialized + REFRESH
  // CONCURRENTLY scheduled once row counts justify the cost.
  await sql`
    CREATE OR REPLACE VIEW storm_days AS
    SELECT
      event_date,
      lat_bucket,
      lng_bucket,
      MAX(hail_size_inches) AS max_hail_inches,
      MAX(confirmed_count) AS confirmed_count,
      MAX(confidence_tier) AS confidence_tier,
      COUNT(*) AS event_count,
      MAX(generated_at) AS last_seen
    FROM verified_hail_events
    GROUP BY event_date, lat_bucket, lng_bucket
  `;

  // Storm-event cache for property-search responses.
  await sql`
    CREATE TABLE IF NOT EXISTS event_cache (
      id SERIAL PRIMARY KEY,
      cache_key TEXT NOT NULL UNIQUE,
      lat_q REAL NOT NULL,
      lng_q REAL NOT NULL,
      radius_miles REAL NOT NULL,
      months INTEGER NOT NULL,
      since_date TEXT,
      payload JSONB NOT NULL,
      event_count INTEGER DEFAULT 0,
      generated_at TIMESTAMP DEFAULT NOW(),
      expires_at TIMESTAMP NOT NULL
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS event_cache_expires_idx
      ON event_cache (expires_at)
  `;

  // Add AI bridge columns to leads table (idempotent)
  await sql`ALTER TABLE leads ADD COLUMN IF NOT EXISTS ai_analysis_id TEXT`;
  await sql`ALTER TABLE leads ADD COLUMN IF NOT EXISTS ai_prospect_score REAL`;
  await sql`ALTER TABLE leads ADD COLUMN IF NOT EXISTS ai_roof_type TEXT`;
  await sql`ALTER TABLE leads ADD COLUMN IF NOT EXISTS ai_roof_condition TEXT`;

  // Add AI scan tracking to users table (idempotent)
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS ai_scans_this_month INTEGER DEFAULT 0`;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS ai_scan_reset_at TIMESTAMP`;

  console.log('[migrate] All 11 core tables created successfully.');

  // Create AI property analysis tables
  const aiDb = drizzle(sql);
  await ensureAiTables(aiDb);

  console.log('[migrate] All tables created successfully.');

  // Seed admin user (idempotent)
  const adminEmail = 'ahmed@theroofdocs.com';
  const adminExists = await sql`SELECT id FROM users WHERE email = ${adminEmail}`;
  if (adminExists.length === 0) {
    const bcrypt = await import('bcryptjs');
    const hash = await bcrypt.hash('RoofER21!admin', 10);
    await sql`INSERT INTO users (email, name, password_hash, plan) VALUES (${adminEmail}, ${'Ahmed Mahmoud'}, ${hash}, ${'company'})`;
    console.log('[migrate] Admin user created');
  } else {
    // Ensure admin has company plan
    await sql`UPDATE users SET plan = 'company' WHERE email = ${adminEmail}`;
    console.log('[migrate] Admin user already exists — plan confirmed as company');
  }

  await sql.end();
}

migrate()
  .then(() => {
    // The actual NCEI backfill (BACKFILL_NCEI_ON_BOOT env flag) now runs
    // from server/index.ts as a fire-and-forget background task — that way
    // the server boots immediately and reps don't see a 502 while the
    // backfill is grinding through year files. Migrate just exits cleanly.
    process.exit(0);
  })
  .catch((err) => {
    console.error('[migrate] Failed:', err);
    process.exit(1);
  });
