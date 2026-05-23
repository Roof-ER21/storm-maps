-- Phase 2a reverse migration — undoes 300_role_taxonomy.sql.
--
-- Restores users.role to the pre-300 state: ('rep','admin','manager') CHECK,
-- 'rep' default, nullable. Backfills the new 4-role values back into the old
-- 3-role values:
--   employee  → rep
--   exec      → manager
--   analytics → rep   (analytics didn't exist pre-300; map to rep as the
--                      lowest-privilege landing; admin can re-curate)
--   admin     → admin (unchanged)
--
-- Apply with:
--   psql "$RIQ_DB_PUBLIC_URL" -f server/migrations/sa/300_role_taxonomy_down.sql
--
-- Round-trip-tested against prod via scripts/test-role-migration.mjs:
--   structural diff (column + constraint) IDENTICAL after forward + down.

BEGIN;

-- 1. Drop the 4-role constraint.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;

-- 2. Backfill new roles back into old roles before re-adding the old constraint.
UPDATE users SET role = 'rep'     WHERE role = 'employee';
UPDATE users SET role = 'manager' WHERE role = 'exec';
UPDATE users SET role = 'rep'     WHERE role = 'analytics';
-- 'admin' values pass through unchanged.

-- 3. Restore pre-300 column attributes:
--    default = 'rep', nullable = YES (300 had set both differently).
ALTER TABLE users ALTER COLUMN role SET DEFAULT 'rep';
ALTER TABLE users ALTER COLUMN role DROP NOT NULL;

-- 4. Re-add the original 3-role CHECK.
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('rep','admin','manager'));

COMMIT;
