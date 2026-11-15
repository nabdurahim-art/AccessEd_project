// Publishing a pack by uploading its zip (the admin screen).
//
// The zip made by tools/build_packs.py carries the course details in its
// manifest.json, so the admin only picks the file. The server checks the zip,
// finds the course (or creates it), saves the pack and its lessons, and keeps
// the file. Everything happens in one transaction: a pack that fails a check
// is never saved.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('../config/database');
const { PACKS_DIR } = require('../utils/packFiles');
const { readManifest, validateManifest } = require('../utils/manifest');
const { saveModules } = require('../utils/packImport');
const { looksLikeZip, checkZipSize, readIdentity, storedFileName } = require('../utils/uploadChecks');

// A problem found while publishing, with the HTTP status to answer with.
class PublishError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

/**
 * Checks a pack zip and publishes it. Shared by the upload screen and the
 * lesson editor, so both follow exactly the same rules.
 * Returns { status, payload } on success and throws PublishError for a pack
 * that fails a check. Uploading the same course and week again replaces the
 * pack and adds 1 to its version, so learners get the update.
 */
async function publishPackBuffer(body) {
  if (!looksLikeZip(body)) {
    throw new PublishError(400, Buffer.isBuffer(body) && body.length > 0
      ? 'This file is not a valid zip.'
      : 'Send a .zip file as the request body (Content-Type: application/zip).');
  }

  const sizeProblem = checkZipSize(body);
  if (sizeProblem) throw new PublishError(400, sizeProblem);

  // 1. Read and check everything inside the zip. Nothing is saved yet.
  const read = readManifest(body);
  if (!read.ok) throw new PublishError(400, read.error);

  const checked = validateManifest(read.manifest, read.files);
  if (!checked.valid) throw new PublishError(400, 'manifest.json has problems.', checked.errors);

  const identity = readIdentity(read.manifest);
  if (!identity.valid) throw new PublishError(400, identity.errors[0], identity.errors);

  const { course, pack } = identity;
  const checksum = crypto.createHash('sha256').update(body).digest('hex');
  const fileSizeKb = Math.max(1, Math.round(body.length / 1024));

  // 2. Write the zip beside its final place under a temporary name. It is
  //    renamed inside the transaction, so the final name never holds a
  //    half-written file.
  const tempPath = path.join(PACKS_DIR, `.upload-${crypto.randomBytes(8).toString('hex')}.tmp`);
  try {
    fs.mkdirSync(PACKS_DIR, { recursive: true });
    fs.writeFileSync(tempPath, body);
  } catch (err) {
    console.error('Publish: could not write the pack file:', err);
    throw new PublishError(500, 'The server could not save the file.');
  }

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    // Two uploads for the same course at the same moment must not create two
    // courses, so they wait for each other here.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',
      [`${course.level}|${course.language}|${course.title.toLowerCase()}`]);

    // 3. Find the course, or create it from the details in the zip.
    let courseRow;
    let courseCreated = false;
    const found = await client.query(
      `SELECT course_id FROM courses
       WHERE lower(title) = lower($1) AND language = $2 AND level = $3
       ORDER BY course_id LIMIT 1`,
      [course.title, course.language, course.level]
    );
    if (found.rows.length > 0) {
      // The details in the newest zip win, so editing course.json and
      // uploading again also updates the course.
      const updated = await client.query(
        `UPDATE courses SET subject = $2, description = COALESCE($3, description)
         WHERE course_id = $1
         RETURNING course_id, title, subject, language, level`,
        [found.rows[0].course_id, course.subject, course.description]
      );
      courseRow = updated.rows[0];
    } else {
      const created = await client.query(
        `INSERT INTO courses (title, subject, language, level, description)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING course_id, title, subject, language, level`,
        [course.title, course.subject, course.language, course.level, course.description]
      );
      courseRow = created.rows[0];
      courseCreated = true;
    }

    // 4. Save the pack. Same course and week again means a new version.
    const fileName = storedFileName(course.level, courseRow.course_id, pack.week_number);
    const saved = await client.query(
      `INSERT INTO content_packs
         (course_id, title, week_number, version, file_path, file_size_kb, checksum)
       VALUES ($1, $2, $3, 1, $4, $5, $6)
       ON CONFLICT (course_id, week_number) DO UPDATE SET
         title = EXCLUDED.title,
         file_path = EXCLUDED.file_path,
         file_size_kb = EXCLUDED.file_size_kb,
         checksum = EXCLUDED.checksum,
         version = content_packs.version + 1
       RETURNING pack_id, course_id, title, week_number, version, file_size_kb, checksum,
                 (xmax = 0) AS inserted`,
      [courseRow.course_id, pack.title, pack.week_number, fileName, fileSizeKb, checksum]
    );
    const { inserted, ...packRow } = saved.rows[0];

    // 5. Save the lessons and quizzes.
    const imported = await saveModules(client, packRow.pack_id, checked.modules);

    // 6. Put the file in its place, then commit. If the rename fails, the
    //    database changes are rolled back.
    fs.renameSync(tempPath, path.join(PACKS_DIR, fileName));
    await client.query('COMMIT');

    return {
      status: inserted ? 201 : 200,
      payload: {
        message: inserted ? 'Pack published.' : 'Pack updated. Learners will see the new version.',
        course: { ...courseRow, created: courseCreated },
        pack: packRow,
        imported
      }
    };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (e) { /* already closed */ }
    if (err instanceof PublishError) throw err;
    console.error('Publish pack error:', err);
    throw new PublishError(500, 'Internal server error while publishing the pack.');
  } finally {
    client.release();
    fs.rm(tempPath, { force: true }, () => {}); // does nothing after a successful rename
  }
}

// Answers a request with the result of publishPackBuffer.
const sendPublishError = (res, err) => {
  if (err instanceof PublishError) {
    return res.status(err.status).json({ error: err.message, ...(err.details ? { details: err.details } : {}) });
  }
  console.error('Unexpected publish error:', err);
  return res.status(500).json({ error: 'Internal server error while publishing the pack.' });
};

/**
 * POST /content/admin/upload
 * The body is the zip file itself (Content-Type: application/zip).
 */
const uploadPack = async (req, res) => {
  try {
    const result = await publishPackBuffer(req.body);
    return res.status(result.status).json(result.payload);
  } catch (err) {
    return sendPublishError(res, err);
  }
};

/**
 * GET /content/admin/published
 * Everything that is published, grouped by course, for the admin screen.
 */
const listPublished = async (req, res) => {
  try {
    const result = await db.query(
      `SELECT c.course_id, c.title, c.subject, c.language, c.level,
              p.pack_id, p.title AS pack_title, p.week_number, p.version, p.file_size_kb,
              (SELECT COUNT(*) FROM modules m WHERE m.pack_id = p.pack_id)::int AS lessons
       FROM courses c
       LEFT JOIN content_packs p ON p.course_id = c.course_id
       ORDER BY c.level ASC, c.language, c.title, p.week_number`
    );

    const byCourse = new Map();
    for (const r of result.rows) {
      if (!byCourse.has(r.course_id)) {
        byCourse.set(r.course_id, {
          course_id: r.course_id, title: r.title, subject: r.subject,
          language: r.language, level: r.level, packs: []
        });
      }
      if (r.pack_id !== null) {
        byCourse.get(r.course_id).packs.push({
          pack_id: r.pack_id, title: r.pack_title, week_number: r.week_number,
          version: r.version, size_kb: r.file_size_kb, lessons: r.lessons
        });
      }
    }
    return res.status(200).json({ courses: [...byCourse.values()] });
  } catch (err) {
    console.error('List published error:', err);
    return res.status(500).json({ error: 'Internal server error while listing content.' });
  }
};

module.exports = { uploadPack, listPublished, publishPackBuffer, sendPublishError, PublishError };
