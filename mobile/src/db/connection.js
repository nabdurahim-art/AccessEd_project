import * as SQLite from 'expo-sqlite';

/* ------------------------------------------------------------------ *
 *  Connection and migrations
 * ------------------------------------------------------------------ */

let dbPromise = null;
let initPromise = null;

/**
 * Opens the database once. Concurrent callers share the same promise, so the
 * file is never opened twice. Foreign keys are switched on explicitly so the
 * phone behaves the same way in every Expo version.
 */
export function getDB() {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await SQLite.openDatabaseAsync('accessed_offline.db');
      await db.execAsync('PRAGMA foreign_keys = ON;');
      return db;
    })();
  }
  return dbPromise;
}

/**
 * Creates or upgrades the tables, using PRAGMA user_version to remember the
 * schema version. Safe to call many times, and safe to call at the same
 * moment from several places. To change a table later, add a new
 * "if (currentVersion < N)" block. Never edit an old block, because phones
 * that already ran it will not run it again.
 */
export function initDatabase() {
  if (!initPromise) {
    initPromise = runMigrations().catch((err) => {
      initPromise = null; // allow a retry after a failure
      throw err;
    });
  }
  return initPromise;
}

async function runMigrations() {
  const db = await getDB();

  const versionRow = await db.getFirstAsync('PRAGMA user_version;');
  const currentVersion = versionRow ? Object.values(versionRow)[0] : 0;

  if (currentVersion < 1) {
    await db.execAsync(`
      PRAGMA journal_mode = WAL;

      CREATE TABLE IF NOT EXISTS local_progress (
        progress_id TEXT PRIMARY KEY,
        pack_id INTEGER NOT NULL,
        module_key TEXT NOT NULL,
        percent_complete INTEGER NOT NULL,
        status TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        synced INTEGER DEFAULT 0,
        reject_reason TEXT,
        UNIQUE(pack_id, module_key)
      );

      CREATE TABLE IF NOT EXISTS local_quiz_attempts (
        attempt_id TEXT PRIMARY KEY,
        pack_id INTEGER NOT NULL,
        module_key TEXT NOT NULL,
        score INTEGER NOT NULL,
        passed INTEGER NOT NULL,
        attempted_at TEXT NOT NULL,
        synced INTEGER DEFAULT 0,
        reject_reason TEXT
      );

      CREATE TABLE IF NOT EXISTS downloaded_packs (
        pack_id INTEGER PRIMARY KEY,
        version INTEGER NOT NULL,
        downloaded_at TEXT NOT NULL
      );

      PRAGMA user_version = 1;
    `);
  }

  if (currentVersion < 2) {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS courses (
        course_id INTEGER PRIMARY KEY,
        title TEXT NOT NULL,
        subject TEXT,
        language TEXT,
        description TEXT
      );

      CREATE TABLE IF NOT EXISTS packs (
        pack_id INTEGER PRIMARY KEY,
        course_id INTEGER NOT NULL,
        week_number INTEGER NOT NULL,
        title TEXT NOT NULL,
        version INTEGER NOT NULL,
        file_size_kb INTEGER NOT NULL,
        checksum TEXT NOT NULL,
        downloaded_version INTEGER DEFAULT 0,
        local_path TEXT,
        FOREIGN KEY (course_id) REFERENCES courses(course_id)
      );

      CREATE TABLE IF NOT EXISTS modules (
        pack_id INTEGER NOT NULL,
        module_key TEXT NOT NULL,
        title TEXT,
        sort_order INTEGER,
        duration_min INTEGER,
        body_file TEXT,
        audio TEXT,
        quiz_json TEXT,
        PRIMARY KEY (pack_id, module_key),
        FOREIGN KEY (pack_id) REFERENCES packs(pack_id)
      );

      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT
      );

      PRAGMA user_version = 2;
    `);
  }
}
