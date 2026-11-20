-- Run once on a database that already exists (a new database gets this from schema.sql).
-- It is safe to run twice.

-- Learners who forgot their password ask for a reset code from the login screen.
-- The admin sees the open requests, makes a code, and gives it to the learner.
CREATE TABLE IF NOT EXISTS reset_requests (
    request_id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID        NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
    note        VARCHAR(200),                       -- optional: how the learner can be reached
    status      VARCHAR(10) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done', 'dismissed')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    handled_by  UUID        REFERENCES users (user_id) ON DELETE SET NULL,
    handled_at  TIMESTAMPTZ
);
-- One open request per learner: asking again only refreshes it.
CREATE UNIQUE INDEX IF NOT EXISTS uq_reset_request_open ON reset_requests (user_id) WHERE status = 'open';
