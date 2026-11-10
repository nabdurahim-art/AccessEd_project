-- Run once on a database that already exists (a new database gets this from schema.sql).
-- Existing courses become 'secondary'. It is safe to run twice.
ALTER TABLE courses
  ADD COLUMN IF NOT EXISTS level VARCHAR(10) NOT NULL DEFAULT 'secondary';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'courses_level_check') THEN
    ALTER TABLE courses ADD CONSTRAINT courses_level_check CHECK (level IN ('primary', 'secondary'));
  END IF;
END $$;
