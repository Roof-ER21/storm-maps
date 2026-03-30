import postgres from 'postgres';

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

  console.log('[migrate] All 7 tables created successfully.');
  await sql.end();
}

migrate().catch((err) => {
  console.error('[migrate] Failed:', err);
  process.exit(1);
});
