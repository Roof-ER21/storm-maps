-- Phase 1: Auth migration — extend Hail Yes users table to support
-- storm-archive PIN+session model alongside the existing bcrypt+JWT users.
--
-- Strategy:
--   - Add SA columns as NULLABLE so the 2 existing Stripe users survive.
--   - Rename HY activity_log → ai_activity_log to avoid collision with
--     the audit-trail table SA needs to add.
--   - Create sessions + (renamed) activity_log fresh.

-- 1. Rename existing AI activity_log so we can add SA's audit log without conflict
ALTER TABLE IF EXISTS activity_log RENAME TO ai_activity_log;

-- Drop and recreate any indexes that reference the old name
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT indexname FROM pg_indexes WHERE tablename = 'ai_activity_log' AND indexname LIKE 'activity_log%' LOOP
    EXECUTE format('ALTER INDEX %I RENAME TO %I', r.indexname, replace(r.indexname, 'activity_log', 'ai_activity_log'));
  END LOOP;
END $$;

-- 2. Extend users table with SA columns
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS display_name      TEXT,
  ADD COLUMN IF NOT EXISTS role              TEXT DEFAULT 'rep',
  ADD COLUMN IF NOT EXISTS pin_length        INTEGER NOT NULL DEFAULT 4,
  ADD COLUMN IF NOT EXISTS pin_hash          TEXT,
  ADD COLUMN IF NOT EXISTS pin_set_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS enroll_token      TEXT,
  ADD COLUMN IF NOT EXISTS enroll_expires    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS failed_attempts   INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS locked_until      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_login_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS archived_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS is_root_admin     BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS welcome_seen_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS phone             TEXT,
  ADD COLUMN IF NOT EXISTS notification_prefs JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Backfill display_name from existing 'name' column where NULL (HY's column was 'name')
UPDATE users SET display_name = name WHERE display_name IS NULL;

-- Add CHECK constraints (drop-then-add to be idempotent)
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('rep','admin','manager'));

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_pin_length_check;
ALTER TABLE users ADD CONSTRAINT users_pin_length_check
  CHECK (pin_length IN (4,6));

-- Indexes
CREATE INDEX IF NOT EXISTS users_archived_idx
  ON users (archived_at) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS users_role_idx
  ON users (role);
CREATE UNIQUE INDEX IF NOT EXISTS users_enroll_token_key
  ON users (enroll_token) WHERE enroll_token IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS users_one_root_admin
  ON users (is_root_admin) WHERE is_root_admin = TRUE;

-- 3. sessions table (storm-archive migration 005 schema)
CREATE TABLE IF NOT EXISTS sessions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_agent    TEXT,
  ip_addr       INET,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at    TIMESTAMPTZ NOT NULL,
  revoked_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS sessions_active_idx
  ON sessions(expires_at) WHERE revoked_at IS NULL;

-- 4. SA-style activity_log (HTTP audit trail; AI's table was renamed above)
CREATE TABLE IF NOT EXISTS activity_log (
  id          BIGSERIAL PRIMARY KEY,
  user_id     INTEGER REFERENCES users(id),
  session_id  UUID REFERENCES sessions(id),
  ts          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  route       TEXT NOT NULL,
  method      TEXT NOT NULL,
  status      INTEGER,
  duration_ms INTEGER,
  payload     JSONB,
  ip_addr     INET
);
CREATE INDEX IF NOT EXISTS activity_log_user_idx ON activity_log(user_id, ts DESC);
CREATE INDEX IF NOT EXISTS activity_log_route_idx ON activity_log(route, ts DESC);
CREATE INDEX IF NOT EXISTS activity_log_ts_idx ON activity_log(ts DESC);
