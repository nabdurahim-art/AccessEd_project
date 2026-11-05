import { getDB } from './connection.js';

/* ------------------------------------------------------------------ *
 *  Catalogue: courses, packs, modules
 * ------------------------------------------------------------------ */

/** Saves the course list. Call this BEFORE saveCoursePacks for the same course. */
export async function saveCourses(courses) {
  const db = await getDB();
  await db.withTransactionAsync(async () => {
    for (const c of courses) {
      await db.runAsync(
        `INSERT INTO courses (course_id, title, subject, language, description)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(course_id) DO UPDATE SET
           title = excluded.title,
           subject = excluded.subject,
           language = excluded.language,
           description = excluded.description;`,
        [c.course_id, c.title, c.subject || null, c.language || null, c.description || null]
      );
    }
  });
}

/** The saved courses, optionally for one language ('en', 'fr' or 'rw'). */
export async function getCourses(language = null) {
  const db = await getDB();
  if (language) {
    return db.getAllAsync('SELECT * FROM courses WHERE language = ? ORDER BY title;', [language]);
  }
  return db.getAllAsync('SELECT * FROM courses ORDER BY title;');
}

/**
 * Saves the server's pack list for a course. Updates version, size and
 * checksum, and never touches downloaded_version or local_path. A missing
 * size or checksum becomes 0 or '' so one odd pack cannot block the list.
 */
export async function saveCoursePacks(courseId, packs) {
  const db = await getDB();
  await db.withTransactionAsync(async () => {
    for (const p of packs) {
      await db.runAsync(
        `INSERT INTO packs
           (pack_id, course_id, week_number, title, version, file_size_kb, checksum, downloaded_version, local_path)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, NULL)
         ON CONFLICT(pack_id) DO UPDATE SET
           week_number = excluded.week_number,
           title = excluded.title,
           version = excluded.version,
           file_size_kb = excluded.file_size_kb,
           checksum = excluded.checksum;`,
        [p.pack_id, courseId, p.week_number, p.title, p.version, p.file_size_kb ?? 0, p.checksum ?? '']
      );
    }
  });
}

// Adds the state the screens show: Download, Update available or Ready offline.
function withState(p) {
  const state = !p.downloaded_version
    ? 'not_downloaded'
    : p.version > p.downloaded_version
      ? 'update_available'
      : 'downloaded';
  return { ...p, state };
}

/**
 * The packs of a course, by week, each with a state for the screen:
 * 'not_downloaded' (Download), 'update_available' or 'downloaded' (Ready offline).
 * file_size_kb is 0 when the size is not known.
 */
export async function getPacksForCourse(courseId) {
  const db = await getDB();
  const packs = await db.getAllAsync(
    'SELECT * FROM packs WHERE course_id = ? ORDER BY week_number ASC;',
    [courseId]
  );

  return packs.map(withState);
}

/** One pack by id, with its state, or null. */
export async function getPack(packId) {
  const db = await getDB();
  const p = await db.getFirstAsync('SELECT * FROM packs WHERE pack_id = ?;', [packId]);
  return p ? withState(p) : null;
}

/**
 * Records that a pack was downloaded, checked and unpacked. Call this only
 * after the checksum matched and the modules were saved.
 */
export async function markPackDownloaded(packId, version, localPath) {
  const db = await getDB();
  await db.runAsync(
    'UPDATE packs SET downloaded_version = ?, local_path = ? WHERE pack_id = ?;',
    [version, localPath, packId]
  );
}

// Replaces the lessons of a pack with the ones in the list. Runs inside the
// caller's transaction. Each module: { key, title, order, duration_min, body_file, audio, quiz }.
async function writeModules(db, packId, modules) {
  await db.runAsync('DELETE FROM modules WHERE pack_id = ?;', [packId]);
  for (let i = 0; i < modules.length; i++) {
    const m = modules[i];
    await db.runAsync(
      `INSERT INTO modules
         (pack_id, module_key, title, sort_order, duration_min, body_file, audio, quiz_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        packId,
        m.key,
        m.title || null,
        m.order ?? i + 1,
        m.duration_min ?? null,
        m.body_file || null,
        m.audio || null,
        m.quiz ? JSON.stringify(m.quiz) : null,
      ]
    );
  }
}

/**
 * Replaces the lessons of a pack with the ones in its manifest.json (the
 * manifest is the truth for the pack on the phone). Progress is never touched.
 */
export async function saveModules(packId, modules) {
  const db = await getDB();
  await db.withTransactionAsync(() => writeModules(db, packId, modules));
}

/**
 * Finishes a download in ONE step: saves the lessons AND marks the pack as
 * downloaded, or does neither. localPath is relative to the app's document
 * folder, for example 'packs/7/', because the full path can change when the
 * app is updated.
 */
export async function installPack(packId, version, localPath, modules) {
  const db = await getDB();
  await db.withTransactionAsync(async () => {
    await writeModules(db, packId, modules);
    await db.runAsync(
      'UPDATE packs SET downloaded_version = ?, local_path = ? WHERE pack_id = ?;',
      [version, localPath, packId]
    );
  });
}

/** Packs the database says are on the phone. Used to check the files are really there. */
export async function getDownloadedPacks() {
  const db = await getDB();
  return db.getAllAsync('SELECT * FROM packs WHERE downloaded_version > 0;');
}

/** Forgets that a pack is downloaded (its files are gone). The list shows Download again. */
export async function resetPackDownload(packId) {
  const db = await getDB();
  await db.runAsync(
    'UPDATE packs SET downloaded_version = 0, local_path = NULL WHERE pack_id = ?;',
    [packId]
  );
}

/** The lessons of a pack in order. quiz is the parsed quiz object, or null. */
export async function getModules(packId) {
  const db = await getDB();
  const rows = await db.getAllAsync(
    'SELECT * FROM modules WHERE pack_id = ? ORDER BY sort_order ASC;',
    [packId]
  );
  return rows.map(parseModule);
}

/** One lesson, or null. */
export async function getModule(packId, moduleKey) {
  const db = await getDB();
  const row = await db.getFirstAsync(
    'SELECT * FROM modules WHERE pack_id = ? AND module_key = ?;',
    [packId, moduleKey]
  );
  return row ? parseModule(row) : null;
}

function parseModule(row) {
  let quiz = null;
  if (row.quiz_json) {
    try {
      quiz = JSON.parse(row.quiz_json);
    } catch {
      quiz = null;
    }
  }
  const { quiz_json, ...rest } = row;
  return { ...rest, quiz };
}
