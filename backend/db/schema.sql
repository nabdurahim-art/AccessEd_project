-- AccessEd database schema (PostgreSQL)
-- The 11 tables from section 3.5 of the proposal, plus the few extra columns
-- the backend relies on (marked "added"). Run once on an empty database.
-- To change a table later, use ALTER TABLE, or recreate the database
-- (docker compose down -v) while you are still developing.

-- ---------------------------------------------------------------- people

CREATE TABLE users (
    user_id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username            VARCHAR(50)  NOT NULL UNIQUE,
    -- Email and phone are optional. UNIQUE still allows many empty (NULL) values.
    email               VARCHAR(255) UNIQUE,
    phone_number        VARCHAR(20)  UNIQUE,
    password_hash       VARCHAR(255) NOT NULL,
    full_name           VARCHAR(100) NOT NULL,
    role                VARCHAR(20)  NOT NULL DEFAULT 'learner'
                        CHECK (role IN ('learner', 'admin')),
    points              INTEGER      NOT NULL DEFAULT 0 CHECK (points >= 0),
    streak_days         INTEGER      NOT NULL DEFAULT 0 CHECK (streak_days >= 0),
    last_activity_date  DATE,        -- added: last day (Rwanda time) the learner studied
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE devices (
    -- Created on the device itself, so it exists before the first contact.
    -- A device is not tied to one learner: phones are shared at the centre.
    device_id      UUID PRIMARY KEY,
    platform       VARCHAR(20)  NOT NULL CHECK (platform IN ('android', 'ios', 'web')),
    last_seen_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- --------------------------------------------------------------- content

CREATE TABLE courses (
    course_id      INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    title          VARCHAR(150) NOT NULL,
    subject        VARCHAR(80)  NOT NULL,
    language       VARCHAR(5)   NOT NULL CHECK (language IN ('en', 'fr', 'rw')),
    description    TEXT,                                  -- added
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()    -- added
);

CREATE TABLE content_packs (
    pack_id        INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    course_id      INTEGER      NOT NULL REFERENCES courses (course_id),
    title          VARCHAR(150) NOT NULL,
    week_number    INTEGER      NOT NULL CHECK (week_number >= 1),
    -- Goes up by one every time the pack is republished.
    version        INTEGER      NOT NULL DEFAULT 1 CHECK (version >= 1),
    file_path      VARCHAR(255) NOT NULL,   -- file name inside the packs folder
    file_size_kb   INTEGER      NOT NULL CHECK (file_size_kb >= 1),
    checksum       VARCHAR(64)  NOT NULL,   -- SHA-256 of the file
    -- One pack per course and week. The publish query depends on this rule.
    CONSTRAINT uq_pack_course_week UNIQUE (course_id, week_number)
);

CREATE TABLE modules (
    module_id      INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    pack_id        INTEGER      NOT NULL REFERENCES content_packs (pack_id) ON DELETE CASCADE,
    -- added: the short key used in manifest.json. The phone uses it when syncing,
    -- so it never needs the database number.
    module_key     VARCHAR(50)  NOT NULL,
    title          VARCHAR(150) NOT NULL,
    duration_min   INTEGER      NOT NULL DEFAULT 10 CHECK (duration_min >= 1),
    audio_path     VARCHAR(255),
    sort_order     INTEGER      NOT NULL DEFAULT 1,
    CONSTRAINT uq_module_key UNIQUE (pack_id, module_key)
);

CREATE TABLE quizzes (
    quiz_id        INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    -- UNIQUE: a module has at most one quiz (the "0..1" in the class diagram).
    module_id      INTEGER      NOT NULL UNIQUE REFERENCES modules (module_id) ON DELETE CASCADE,
    pass_mark      INTEGER      NOT NULL DEFAULT 70 CHECK (pass_mark BETWEEN 0 AND 100)
);

-- ------------------------------------------------------ learner activity

CREATE TABLE offline_downloads (
    download_id         INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id             UUID    NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
    device_id           UUID    NOT NULL REFERENCES devices (device_id) ON DELETE CASCADE,
    pack_id             INTEGER NOT NULL REFERENCES content_packs (pack_id) ON DELETE CASCADE,
    downloaded_version  INTEGER NOT NULL CHECK (downloaded_version >= 1),
    downloaded_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    sync_status         VARCHAR(20) NOT NULL DEFAULT 'synced'
                        CHECK (sync_status IN ('synced', 'pending_update')),
    -- Downloading the same pack again on the same device updates this row.
    CONSTRAINT uq_download UNIQUE (user_id, device_id, pack_id)
);

CREATE TABLE user_progress (
    -- Made on the phone, so a record sent twice is never stored twice.
    progress_id       UUID PRIMARY KEY,
    user_id           UUID    NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
    module_id         INTEGER NOT NULL REFERENCES modules (module_id) ON DELETE CASCADE,
    status            VARCHAR(20) NOT NULL CHECK (status IN ('in_progress', 'completed')),
    percent_complete  INTEGER NOT NULL DEFAULT 0 CHECK (percent_complete BETWEEN 0 AND 100),
    -- Set by the phone, with no default on purpose: if a sync forgets it, the
    -- insert fails loudly instead of quietly using the server's time.
    updated_at        TIMESTAMPTZ NOT NULL,
    -- One progress record per learner and module, so "newest wins" has a single row to compare.
    CONSTRAINT uq_progress UNIQUE (user_id, module_id)
);

CREATE TABLE quiz_attempts (
    attempt_id    UUID PRIMARY KEY,         -- made on the phone
    user_id       UUID    NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
    quiz_id       INTEGER NOT NULL REFERENCES quizzes (quiz_id) ON DELETE CASCADE,
    score         INTEGER NOT NULL CHECK (score BETWEEN 0 AND 100),
    attempted_at  TIMESTAMPTZ NOT NULL      -- set by the phone, no default
);

-- ---------------------------------------------------------------- badges

CREATE TABLE badges (
    badge_id   INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    -- UNIQUE: the rewards code finds each badge's rule by its name.
    name       VARCHAR(80)  NOT NULL UNIQUE,
    criteria   VARCHAR(255) NOT NULL
);

CREATE TABLE user_badges (
    user_id    UUID    NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
    badge_id   INTEGER NOT NULL REFERENCES badges (badge_id) ON DELETE CASCADE,
    earned_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, badge_id)         -- a badge can be earned only once
);

-- ------------------------------------------------------------- indexes
-- Speed up the lookups the app does most.

CREATE INDEX idx_modules_pack   ON modules (pack_id);
CREATE INDEX idx_attempts_user  ON quiz_attempts (user_id);
CREATE INDEX idx_attempts_quiz  ON quiz_attempts (quiz_id);
