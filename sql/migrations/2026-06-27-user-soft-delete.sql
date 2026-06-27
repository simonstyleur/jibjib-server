-- Account deletion (soft delete): mark users as deleted instead of hard-removing.
-- Apply to prod with: psql "$DATABASE_URL" -f sql/migrations/2026-06-27-user-soft-delete.sql
-- Idempotent.

ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_users_active ON users (id) WHERE deleted_at IS NULL;
