-- Run once on a database that already exists (a new database gets this from schema.sql).
-- It is safe to run twice.
CREATE TABLE IF NOT EXISTS password_resets (
    reset_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID        NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
    code_hash   CHAR(64)    NOT NULL,
    expires_at  TIMESTAMPTZ NOT NULL,
    used_at     TIMESTAMPTZ,
    attempts    INTEGER     NOT NULL DEFAULT 0,
    created_by  UUID        REFERENCES users (user_id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_password_resets_user ON password_resets (user_id);
