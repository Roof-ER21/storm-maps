-- Phase 2a: Role taxonomy migration for RIQ21 4-role IA.
--
-- Replaces ('rep','admin','manager') with ('admin','exec','employee','analytics').
-- Per restructure plan §2.1 + decision log §8 in D:\shadow21\RIQ21-RESTRUCTURE-PLAN.md
--
-- Backfill mapping (defensible defaults; admin can re-assign individual rows via
-- /api/admin/users/:id/role after this migration applies):
--   rep      → employee   (sales reps / canvassers / ops coordinators)
--   manager  → exec       (managerial / leadership)
--   admin    → admin      (unchanged)
--   root admin override (is_root_admin = TRUE) remains independent
--
-- Apply with:
--   psql "$RIQ_DB_PUBLIC_URL" -f server/migrations/sa/300_role_taxonomy.sql
--
-- Reverse migration: server/migrations/sa/300_role_taxonomy_down.sql
-- Round-trip tested via scripts/test-role-migration.mjs (forward + down
-- restores users.role column + constraint to IDENTICAL pre-migration state).

BEGIN;

-- 1. Drop the existing CHECK constraint so we can write the new role values.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;

-- 2. Backfill rows that won't pass the new constraint.
UPDATE users SET role = 'employee' WHERE role = 'rep' OR role IS NULL;
UPDATE users SET role = 'exec'     WHERE role = 'manager';
-- 'admin' values pass through unchanged.

-- 3. New default for inserts created after this migration.
ALTER TABLE users ALTER COLUMN role SET DEFAULT 'employee';

-- 4. Make NOT NULL (defensive; pre-existing rows have all been backfilled above).
ALTER TABLE users ALTER COLUMN role SET NOT NULL;

-- 5. Add the new CHECK constraint over the 4 roles.
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('admin','exec','employee','analytics'));

-- 6. Sanity assert: every row matches a known role.
DO $$
DECLARE
  bad_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO bad_count
    FROM users
    WHERE role NOT IN ('admin','exec','employee','analytics');
  IF bad_count > 0 THEN
    RAISE EXCEPTION 'Role taxonomy migration failed: % rows still hold an unknown role', bad_count;
  END IF;
END $$;

COMMIT;
