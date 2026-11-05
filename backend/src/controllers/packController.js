// Publishing, listing and updating content packs (the admin side).

const db = require('../config/database');
const { toId, isId } = require('../utils/ids');
const { resolvePackFile, hashFile, sizeInKb } = require('../utils/packFiles');
const { readManifest, validateManifest } = require('../utils/manifest');
const { saveModules } = require('../utils/packImport');

/**
 * Finds the pack file and checks its manifest.json before anything is saved.
 * Returns { ok: true, fullPath, modules } or { ok: false, error, details }.
 */
function checkPackFile(fileName) {
  const fullPath = resolvePackFile(fileName);
  if (!fullPath) {
    return { ok: false, error: 'File not found in the packs folder.' };
  }

  const read = readManifest(fullPath);
  if (!read.ok) return { ok: false, error: read.error };

  const checked = validateManifest(read.manifest, read.files);
  if (!checked.valid) {
    return { ok: false, error: 'manifest.json has problems.', details: checked.errors };
  }
  return { ok: true, fullPath, modules: checked.modules };
}

/**
 * Publishes a pack. The zip must already be inside the packs folder, and
 * file_path is just its file name. The server reads the zip's manifest.json,
 * works out the checksum and the size itself, and raises the version, so the
 * client cannot get them wrong. The pack's lessons and quizzes are saved from
 * the manifest in the same transaction.
 * Publishing the same course and week again replaces the pack and adds 1 to
 * the version.
 */
const createContentPack = async (req, res) => {
  try {
    const { course_id, title, week_number, file_path } = req.body;

    if (!isId(course_id)) {
      return res.status(400).json({ error: 'Course ID is required and must be a positive whole number.' });
    }
    if (!title || typeof title !== 'string' || title.trim() === '' || title.length > 150) {
      return res.status(400).json({ error: 'Title is required (up to 150 characters).' });
    }
    if (!isId(week_number)) {
      return res.status(400).json({ error: 'Week number is required and must be a positive whole number.' });
    }
    if (!file_path || typeof file_path !== 'string' || file_path.length > 255) {
      return res.status(400).json({ error: 'A valid file name is required.' });
    }

    // Check the file and its manifest first, so a broken pack is never saved.
    const checked = checkPackFile(file_path);
    if (!checked.ok) {
      return res.status(400).json({ error: checked.error, details: checked.details });
    }

    const checksum = await hashFile(checked.fullPath);
    const fileSizeKb = sizeInKb(checked.fullPath);

    // One statement does both cases, so two admins publishing at the same
    // moment cannot create two rows for the same week. It needs this rule in
    // the database: UNIQUE (course_id, week_number).
    // "xmax = 0" is true only when a new row was inserted.
    const query = `
      INSERT INTO content_packs
        (course_id, title, week_number, version, file_path, file_size_kb, checksum)
      VALUES ($1, $2, $3, 1, $4, $5, $6)
      ON CONFLICT (course_id, week_number) DO UPDATE SET
        title = EXCLUDED.title,
        file_path = EXCLUDED.file_path,
        file_size_kb = EXCLUDED.file_size_kb,
        checksum = EXCLUDED.checksum,
        version = content_packs.version + 1
      RETURNING pack_id, course_id, title, week_number, version, file_size_kb, checksum,
                (xmax = 0) AS inserted;
    `;

    // The pack and its lessons are saved together or not at all.
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(query, [course_id, title.trim(), week_number, file_path, fileSizeKb, checksum]);
      const { inserted, ...pack } = result.rows[0];
      const imported = await saveModules(client, pack.pack_id, checked.modules);
      await client.query('COMMIT');

      return res.status(inserted ? 201 : 200).json({
        message: inserted
          ? 'Content pack created successfully.'
          : 'Content pack updated successfully with version bump.',
        pack,
        imported
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    if (err.code === '23503') {
      return res.status(404).json({ error: 'Referenced course does not exist.' });
    }
    console.error('Create content pack error:', err);
    return res.status(500).json({ error: 'Internal server error while creating content pack.' });
  }
};

const getPacksByCourse = async (req, res) => {
  try {
    const courseId = toId(req.params.courseId);
    if (courseId === null) {
      return res.status(400).json({ error: 'Invalid course ID format. Must be a positive whole number.' });
    }

    // The server file path is private, so it is not returned.
    const query = `
      SELECT pack_id, title, week_number, version, file_size_kb, checksum
      FROM content_packs
      WHERE course_id = $1
      ORDER BY week_number ASC;
    `;

    const result = await db.query(query, [courseId]);

    return res.status(200).json({
      course_id: courseId,
      count: result.rows.length,
      packs: result.rows
    });
  } catch (err) {
    console.error('Get packs by course error:', err);
    return res.status(500).json({ error: 'Internal server error while fetching content packs.' });
  }
};

/**
 * Updates one pack by its ID. Every update adds 1 to the version, and the
 * checksum and size are worked out again from the file on disk, because the
 * file may have been replaced.
 */
const updateContentPack = async (req, res) => {
  try {
    const packId = toId(req.params.packId);
    if (packId === null) {
      return res.status(400).json({ error: 'Invalid pack ID format. Must be a positive whole number.' });
    }

    const { title, file_path } = req.body;

    if (title !== undefined && title !== null &&
        (typeof title !== 'string' || title.trim() === '' || title.length > 150)) {
      return res.status(400).json({ error: 'Title must be text of up to 150 characters.' });
    }
    if (file_path !== undefined && file_path !== null &&
        (typeof file_path !== 'string' || file_path.length > 255)) {
      return res.status(400).json({ error: 'File name must be text.' });
    }

    const existing = await db.query('SELECT file_path FROM content_packs WHERE pack_id = $1', [packId]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Content pack not found.' });
    }

    const targetFile = file_path || existing.rows[0].file_path;

    // The file may have been replaced, so its manifest is read again.
    const checked = checkPackFile(targetFile);
    if (!checked.ok) {
      return res.status(400).json({ error: checked.error, details: checked.details });
    }

    const checksum = await hashFile(checked.fullPath);
    const fileSizeKb = sizeInKb(checked.fullPath);

    const query = `
      UPDATE content_packs
      SET version = version + 1,
          title = COALESCE($1, title),
          file_path = $2,
          file_size_kb = $3,
          checksum = $4
      WHERE pack_id = $5
      RETURNING pack_id, course_id, title, week_number, version, file_size_kb, checksum;
    `;

    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(query, [title ? title.trim() : null, targetFile, fileSizeKb, checksum, packId]);

      if (result.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Content pack not found.' });
      }

      const imported = await saveModules(client, packId, checked.modules);
      await client.query('COMMIT');

      return res.status(200).json({
        message: 'Content pack updated successfully with version bump.',
        pack: result.rows[0],
        imported
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Update content pack error:', err);
    return res.status(500).json({ error: 'Internal server error while updating content pack.' });
  }
};

module.exports = { createContentPack, getPacksByCourse, updateContentPack };
