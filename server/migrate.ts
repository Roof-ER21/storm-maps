import postgres from 'postgres';
// drizzle + ai/migrate imports removed with the legacy storm-maps strip (2026-05-12).
// AI property-analysis tables were used only by the old Hail Yes shell.

const connectionString = process.env.DATABASE_URL || 'postgresql://localhost:5432/hailyes';
// Same onnotice handler as server/db.ts — suppresses the wall of
// "relation X already exists, skipping" NOTICEs that flooded boot
// logs because every CREATE TABLE / CREATE INDEX is idempotent.
const sql = postgres(connectionString, {
  onnotice: (notice) => {
    if (notice.severity && notice.severity !== 'NOTICE') {
      console.warn('[pg notice]', notice.severity, notice.message);
    }
  },
});

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

  // Extend verified_hail_events with the full source-flag set + event metadata
  // for backfill ingestion. Idempotent — ADD COLUMN IF NOT EXISTS lets the
  // base CREATE TABLE above stay minimal while later adds extend cleanly.
  //
  // ORDER MATTERS: this ALTER must run BEFORE the dedup-key migration below,
  // which references source_ncei_storm_events + event_type. On a fresh / DR
  // bootstrap those columns don't exist yet, so doing the ALTER first stops the
  // migration from aborting with "column does not exist". (Prod already has the
  // columns, so this is a no-op there.)
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

  // RIQ 21 intel blob storage — one jsonb row per dataset
  await sql`
    CREATE TABLE IF NOT EXISTS intel_blobs (
      key TEXT PRIMARY KEY,
      data JSONB NOT NULL,
      source_mtime TIMESTAMP,
      bytes INTEGER DEFAULT 0,
      row_count INTEGER DEFAULT 0,
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `;

  // Phase 4b: decomposed projects table — one row per job for indexed queries
  // like `WHERE insurance='State Farm' AND zip='20170'`. Backfilled by
  // scripts/roofdocs/backfill-intel-projects.mjs after the projects blob updates.
  await sql`
    CREATE TABLE IF NOT EXISTS intel_projects (
      id INTEGER PRIMARY KEY,
      customer TEXT,
      customer_id TEXT,
      address_line1 TEXT,
      city TEXT,
      state TEXT,
      zip TEXT,
      lat REAL,
      lng REAL,
      insurance TEXT,
      insurance_raw TEXT,
      adjuster_name TEXT,
      adjuster_phone TEXT,
      adjuster_email TEXT,
      claim_number TEXT,
      claim_type TEXT,
      job_type TEXT,
      stage TEXT,
      status_id INTEGER,
      sales_rep TEXT,
      rep_id TEXT,
      lead_source TEXT,
      house_type TEXT,
      roof_access TEXT,
      signed_date TEXT,
      completed_date TEXT,
      finalized_date TEXT,
      date_of_loss TEXT,
      job_total REAL,
      acv REAL,
      deductible REAL,
      insurance_total REAL,
      paused BOOLEAN DEFAULT FALSE,
      data JSONB NOT NULL,
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_intel_projects_carrier_zip ON intel_projects (insurance, zip)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_intel_projects_carrier_state ON intel_projects (insurance, state)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_intel_projects_rep_signed ON intel_projects (sales_rep, signed_date)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_intel_projects_zip ON intel_projects (zip)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_intel_projects_state_city ON intel_projects (state, city)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_intel_projects_stage ON intel_projects (stage)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_intel_projects_signed_date ON intel_projects (signed_date)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_intel_projects_adjuster ON intel_projects (adjuster_name)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_intel_projects_lead_source ON intel_projects (lead_source)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_intel_projects_latlng ON intel_projects USING BRIN (lat, lng)`;

  // Phase 4c: decomposed storm-exposure (one row per customer with their
  // storm history). Backfilled from intel_blobs[storm-exposure] by
  // scripts/roofdocs/backfill-intel-customer-exposure.mjs after the blob
  // updates.
  await sql`
    CREATE TABLE IF NOT EXISTS intel_customer_exposure (
      key TEXT PRIMARY KEY,
      customer TEXT,
      address_line1 TEXT,
      city TEXT,
      state TEXT,
      zip TEXT,
      lat REAL,
      lng REAL,
      customer_email TEXT,
      customer_cell TEXT,
      storm_count INTEGER DEFAULT 0,
      hail_count INTEGER DEFAULT 0,
      strongest_storm_type TEXT,
      strongest_storm_mag REAL,
      strongest_storm_unit TEXT,
      strongest_storm_date TEXT,
      most_recent_storm_date TEXT,
      most_recent_storm_type TEXT,
      most_recent_storm_mag REAL,
      first_contact TEXT,
      last_date TEXT,
      job_count INTEGER DEFAULT 0,
      completed_job_count INTEGER DEFAULT 0,
      total_rev REAL DEFAULT 0,
      has_roof BOOLEAN DEFAULT FALSE,
      data JSONB NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_intel_cust_exp_state_zip ON intel_customer_exposure (state, zip)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_intel_cust_exp_storm_count ON intel_customer_exposure (storm_count DESC) WHERE storm_count > 0`;
  await sql`CREATE INDEX IF NOT EXISTS idx_intel_cust_exp_recent ON intel_customer_exposure (most_recent_storm_date DESC) WHERE most_recent_storm_date IS NOT NULL`;
  await sql`CREATE INDEX IF NOT EXISTS idx_intel_cust_exp_latlng ON intel_customer_exposure USING BRIN (lat, lng)`;

  // Phase 4d: decomposed lifetime-touch (per-customer re-engagement queue).
  // Backfilled from intel_blobs[lifetime-touch] by
  // scripts/roofdocs/backfill-intel-lifetime-touch.mjs.
  await sql`
    CREATE TABLE IF NOT EXISTS intel_lifetime_touch (
      key TEXT PRIMARY KEY,
      customer TEXT,
      address TEXT,
      city TEXT,
      state TEXT,
      zip TEXT,
      lat REAL,
      lng REAL,
      customer_email TEXT,
      customer_cell TEXT,
      sales_rep TEXT,
      last_completed TEXT,
      first_completed TEXT,
      years_since_last REAL,
      job_count INTEGER DEFAULT 0,
      insurance TEXT,
      storm_hits_since_last INTEGER DEFAULT 0,
      hail_hits_since_last INTEGER DEFAULT 0,
      strongest_storm_since_last REAL,
      score INTEGER DEFAULT 0,
      contact_quality TEXT,
      data JSONB NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_intel_lt_rep_score ON intel_lifetime_touch (sales_rep, score DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_intel_lt_score ON intel_lifetime_touch (score DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_intel_lt_state ON intel_lifetime_touch (state)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_intel_lt_storm_hits ON intel_lifetime_touch (storm_hits_since_last DESC) WHERE storm_hits_since_last > 0`;

  // Phase 5: public short-code shareable lists (resurrection, orphans, hot-zips,
  // etc.) Reps can share a snapshot to a manager or homeowner with no login.
  await sql`
    CREATE TABLE IF NOT EXISTS intel_shared_lists (
      id SERIAL PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      list_type TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      snapshot_data JSONB NOT NULL,
      filter_params JSONB DEFAULT '{}',
      creator_email TEXT,
      creator_label TEXT,
      views INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      expires_at TIMESTAMPTZ
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_intel_shared_lists_slug ON intel_shared_lists(slug)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_intel_shared_lists_creator ON intel_shared_lists(creator_email)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_intel_shared_lists_expires ON intel_shared_lists(expires_at) WHERE expires_at IS NOT NULL`;

  // Phase 6: AI assistant — audit log + chat history. Additive, idempotent.
  // (Audit retained forever per product decision; archival is a separate cron.)
  await sql`
    CREATE TABLE IF NOT EXISTS ai_tool_log (
      id             SERIAL PRIMARY KEY,
      user_id        INTEGER REFERENCES users(id) ON DELETE SET NULL,
      session_id     TEXT,
      thread_id      INTEGER,
      tool           TEXT NOT NULL,
      kind           TEXT NOT NULL DEFAULT 'read',
      params_json    JSONB,
      result_summary TEXT,
      confirmed_at   TIMESTAMPTZ,
      error          TEXT,
      model          TEXT,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS ai_tool_log_user_created_idx ON ai_tool_log (user_id, created_at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS ai_tool_log_tool_idx ON ai_tool_log (tool)`;
  await sql`
    CREATE TABLE IF NOT EXISTS ai_threads (
      id         SERIAL PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title      TEXT NOT NULL DEFAULT 'New chat',
      model      TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS ai_threads_user_idx ON ai_threads (user_id, updated_at DESC)`;
  await sql`
    CREATE TABLE IF NOT EXISTS ai_messages (
      id         SERIAL PRIMARY KEY,
      thread_id  INTEGER NOT NULL REFERENCES ai_threads(id) ON DELETE CASCADE,
      role       TEXT NOT NULL,
      content    TEXT,
      tool_calls JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS ai_messages_thread_idx ON ai_messages (thread_id, created_at)`;

  // Writable entity notes — user/AI-authored annotations attached to any intel
  // entity (job/customer/carrier/rep/adjuster/lead/zip). Distinct from imported
  // read-only job notes (notes.json). Written via append_note (AI) or the
  // requireAuth manual route; see server/intel/notes-store.ts.
  await sql`
    CREATE TABLE IF NOT EXISTS entity_notes (
      id           SERIAL PRIMARY KEY,
      entity_type  TEXT NOT NULL,
      entity_id    TEXT NOT NULL,
      content      TEXT NOT NULL,
      author_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
      author_email TEXT,
      source       TEXT NOT NULL DEFAULT 'ai',
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS entity_notes_lookup_idx ON entity_notes (entity_type, entity_id, created_at DESC)`;

  // ── Phase 8c: Operational Surveillance ──────────────────────────────────
  // Mirrors the portal's open fixes / tasks / punch list (admin/fixes/open,
  // admin/tasks/all, dashboard/punchList/all). One indexed row per record +
  // a `data` JSONB fallback, same shape as intel_projects. Backfilled by
  // scripts/roofdocs/backfill-intel-{fixes,tasks,punchlist}.mjs. Portal date
  // fields are kept as TEXT (they arrive as strings), like intel_projects.
  await sql`
    CREATE TABLE IF NOT EXISTS intel_fixes (
      id INTEGER PRIMARY KEY,
      job_id INTEGER,
      employee_id TEXT,
      trade TEXT,
      description TEXT,
      completed BOOLEAN DEFAULT FALSE,
      created_date TEXT,
      completed_date TEXT,
      photo_count INTEGER DEFAULT 0,
      data JSONB NOT NULL,
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_intel_fixes_emp_completed ON intel_fixes (employee_id, completed)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_intel_fixes_job ON intel_fixes (job_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_intel_fixes_open ON intel_fixes (created_date) WHERE completed = FALSE`;

  await sql`
    CREATE TABLE IF NOT EXISTS intel_tasks (
      id INTEGER PRIMARY KEY,
      description TEXT,
      priority TEXT,
      employee_id TEXT,
      customer_id TEXT,
      assignor_id TEXT,
      contractor_id TEXT,
      due_date TEXT,
      created_date TEXT,
      completed_date TEXT,
      pending BOOLEAN DEFAULT TRUE,
      archived BOOLEAN DEFAULT FALSE,
      notes TEXT,
      data JSONB NOT NULL,
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_intel_tasks_emp_completed ON intel_tasks (employee_id, completed_date)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_intel_tasks_cust_due ON intel_tasks (customer_id, due_date)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_intel_tasks_overdue ON intel_tasks (due_date) WHERE pending = TRUE AND archived = FALSE`;

  await sql`
    CREATE TABLE IF NOT EXISTS intel_punchlist (
      id INTEGER PRIMARY KEY,
      name TEXT,
      address_line1 TEXT,
      city TEXT,
      state TEXT,
      zip TEXT,
      user_id TEXT,
      project_manager_id TEXT,
      status_id INTEGER,
      substatus_id INTEGER,
      notes TEXT,
      using_enhanced_photos BOOLEAN DEFAULT FALSE,
      work_completed BOOLEAN DEFAULT FALSE,
      data JSONB NOT NULL,
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_intel_punchlist_status ON intel_punchlist (status_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_intel_punchlist_pm ON intel_punchlist (project_manager_id)`;

  // Self-heal: the portal's person IDs (employee/assignor/contractor/user/PM) are
  // UUIDs, not ints. Earlier schema typed them INTEGER, which made backfill-intel-*
  // throw "invalid input syntax for type integer". Re-type to TEXT in place — only
  // fires when a column is still integer, so it's a no-op once migrated.
  await sql`
    DO $$
    BEGIN
      IF (SELECT data_type FROM information_schema.columns WHERE table_name='intel_fixes' AND column_name='employee_id') = 'integer' THEN
        ALTER TABLE intel_fixes ALTER COLUMN employee_id TYPE TEXT USING employee_id::text;
      END IF;
      IF (SELECT data_type FROM information_schema.columns WHERE table_name='intel_tasks' AND column_name='employee_id') = 'integer' THEN
        ALTER TABLE intel_tasks ALTER COLUMN employee_id TYPE TEXT USING employee_id::text;
      END IF;
      IF (SELECT data_type FROM information_schema.columns WHERE table_name='intel_tasks' AND column_name='assignor_id') = 'integer' THEN
        ALTER TABLE intel_tasks ALTER COLUMN assignor_id TYPE TEXT USING assignor_id::text;
      END IF;
      IF (SELECT data_type FROM information_schema.columns WHERE table_name='intel_tasks' AND column_name='contractor_id') = 'integer' THEN
        ALTER TABLE intel_tasks ALTER COLUMN contractor_id TYPE TEXT USING contractor_id::text;
      END IF;
      IF (SELECT data_type FROM information_schema.columns WHERE table_name='intel_punchlist' AND column_name='user_id') = 'integer' THEN
        ALTER TABLE intel_punchlist ALTER COLUMN user_id TYPE TEXT USING user_id::text;
      END IF;
      IF (SELECT data_type FROM information_schema.columns WHERE table_name='intel_punchlist' AND column_name='project_manager_id') = 'integer' THEN
        ALTER TABLE intel_punchlist ALTER COLUMN project_manager_id TYPE TEXT USING project_manager_id::text;
      END IF;
    END $$;
  `;

  // ── Phase 8d: Calendar / Scheduling ─────────────────────────────────────
  // Mirrors the portal's real event feed (events/sales/all + events/production/all
  // — NOT events/customers|employees, which are just entity directories RIQ21
  // already has). One row per calendar event. start_time/end_time are TIMESTAMPTZ
  // (the feed sends clean ISO), so today/week filtering is correct + indexed in SQL
  // via AT TIME ZONE (no text-date cast footgun). Backfilled by backfill-intel-events.mjs.
  await sql`
    CREATE TABLE IF NOT EXISTS intel_events (
      id TEXT PRIMARY KEY,
      event_type TEXT,
      audience TEXT,
      start_time TIMESTAMPTZ,
      end_time TIMESTAMPTZ,
      customer_id TEXT,
      lead_id TEXT,
      supplier_id TEXT,
      notes TEXT,
      source TEXT,
      last_updated TIMESTAMPTZ,
      data JSONB NOT NULL,
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_intel_events_start ON intel_events (start_time)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_intel_events_customer ON intel_events (customer_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_intel_events_lead ON intel_events (lead_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_intel_events_type ON intel_events (event_type)`;

  console.log('[migrate] All core tables created successfully.');

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
