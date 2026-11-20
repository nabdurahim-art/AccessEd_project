// The lesson editor (admin screen): write lessons in the browser, and the
// server builds the pack zip and publishes it with the same checks as an
// uploaded zip.
//
// Three requests:
//   POST /content/admin/audio              upload one MP3, get a token back
//   POST /content/admin/lessons            save a pack written in the editor
//   GET  /content/admin/packs/:id/source   load a published pack to edit it
//   DELETE /content/admin/packs/:id/lessons/:key   delete a published lesson, even if learners have progress on it
//
// Nothing new is stored in the database for this. The pack zip is the one
// place where the lessons live, and editing a pack reads it back.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const AdmZip = require('adm-zip');
const db = require('../config/database');
const { resolvePackFile } = require('../utils/packFiles');
const { buildPack, readPackSource, looksLikeMp3, audioPath, AUDIO_DIR, MAX_AUDIO_BYTES } = require('../utils/packBuilder');
const { publishPackBuffer, sendPublishError } = require('./uploadController');

const DAY_MS = 24 * 60 * 60 * 1000;

// Removes audio that was uploaded but never used in a pack.
function sweepOldAudio() {
  try {
    for (const name of fs.readdirSync(AUDIO_DIR)) {
      const p = path.join(AUDIO_DIR, name);
      if (Date.now() - fs.statSync(p).mtimeMs > DAY_MS) fs.rmSync(p, { force: true });
    }
  } catch (err) { /* the folder may not exist yet */ }
}

const uploadAudio = async (req, res) => {
  const body = req.body;
  if (!Buffer.isBuffer(body) || body.length === 0) {
    return res.status(400).json({ error: 'Send an MP3 file as the request body.' });
  }
  if (body.length > MAX_AUDIO_BYTES) {
    return res.status(413).json({ error: 'The audio is over 2 MB. Make it smaller (mono, 32 kbps is enough for speech).' });
  }
  if (!looksLikeMp3(body)) {
    return res.status(400).json({ error: 'Only MP3 audio can be added.' });
  }
  try {
    fs.mkdirSync(AUDIO_DIR, { recursive: true });
    sweepOldAudio();
    const token = crypto.randomBytes(16).toString('hex');
    fs.writeFileSync(path.join(AUDIO_DIR, `${token}.mp3`), body);
    return res.status(201).json({ token, size_kb: Math.max(1, Math.round(body.length / 1024)) });
  } catch (err) {
    console.error('Audio upload error:', err);
    return res.status(500).json({ error: 'The server could not save the audio.' });
  }
};

// Finds the pack for this course and week, if it is already published.
async function findExisting(spec) {
  const c = spec && spec.course;
  const p = spec && spec.pack;
  if (!c || !p || typeof c.title !== 'string' || typeof c.language !== 'string' ||
      typeof c.level !== 'string' || !Number.isInteger(p.week_number)) return null;

  const found = await db.query(
    `SELECT p.file_path
     FROM courses c JOIN content_packs p ON p.course_id = c.course_id
     WHERE lower(c.title) = lower($1) AND c.language = $2 AND c.level = $3 AND p.week_number = $4
     LIMIT 1`,
    [c.title.trim(), c.language, c.level, p.week_number]
  );
  if (found.rows.length === 0) return null;

  const full = resolvePackFile(found.rows[0].file_path);
  if (!full) return null;
  const zip = new AdmZip(full);
  const entry = zip.getEntry('manifest.json');
  if (!entry) return null;
  return { manifest: JSON.parse(entry.getData().toString('utf8')), zip };
}

const saveLessons = async (req, res) => {
  const spec = req.body;
  try {
    const existing = await findExisting(spec);

    // A pack written from a blank form has no lesson keys. If this course and week
    // are already published, it would replace them by accident, so ask first.
    if (existing && Array.isArray(spec.lessons) && !spec.lessons.some((l) => l && l.key)) {
      const msg = 'A pack for this course and week is already published. Open it from the Lessons list to edit it, or choose another week number.';
      return res.status(409).json({ error: msg, details: [msg] });
    }
    const built = buildPack(spec, existing);
    if (!built.ok) {
      return res.status(400).json({ error: built.errors[0], details: built.errors });
    }

    // A lesson that is already published cannot be removed here: that would
    // also remove every learner's progress on it.
    if (existing) {
      const missing = (existing.manifest.modules || []).filter((m) => !built.keys.includes(m.key));
      if (missing.length > 0) {
        return res.status(400).json({
          error: `The lesson "${missing[0].title}" is already published. To remove it, use "Delete lesson" on that lesson.`,
          details: missing.map((m) => `Keep the lesson "${m.title}", or delete it with "Delete lesson".`)
        });
      }
    }

    const result = await publishPackBuffer(built.zip);

    // The audio is now inside the pack, so the waiting copies can go.
    for (const l of spec.lessons) {
      const p = l && l.audio && audioPath(l.audio.token);
      if (p) fs.rm(p, { force: true }, () => {});
    }
    return res.status(result.status).json(result.payload);
  } catch (err) {
    return sendPublishError(res, err);
  }
};

const getPackSource = async (req, res) => {
  const packId = Number(req.params.packId);
  if (!Number.isInteger(packId) || packId < 1) {
    return res.status(400).json({ error: 'Pack id must be a positive whole number.' });
  }
  try {
    const found = await db.query(
      `SELECT p.pack_id, p.title, p.week_number, p.version, p.file_path,
              c.title AS course_title, c.subject, c.language, c.level, c.description
       FROM content_packs p JOIN courses c ON c.course_id = p.course_id
       WHERE p.pack_id = $1`,
      [packId]
    );
    if (found.rows.length === 0) return res.status(404).json({ error: 'Pack not found.' });
    const r = found.rows[0];

    const full = resolvePackFile(r.file_path);
    if (!full) return res.status(404).json({ error: 'The pack file is missing on the server.' });

    const source = readPackSource(fs.readFileSync(full),
      { title: r.course_title, subject: r.subject, language: r.language, level: r.level, description: r.description },
      { title: r.title, week_number: r.week_number, version: r.version });
    if (!source) return res.status(422).json({ error: 'This pack has no manifest.json.' });
    return res.status(200).json(source);
  } catch (err) {
    console.error('Pack source error:', err);
    return res.status(500).json({ error: 'Internal server error while loading the pack.' });
  }
};

const KEY_RULE = /^[A-Za-z0-9_-]{1,30}$/;

/**
 * DELETE /content/admin/packs/:packId/lessons/:key
 *
 * Removes one lesson from a published pack, together with its quiz, audio and
 * pictures, and publishes the smaller pack as a new version so phones update.
 * Learners' progress and quiz results on that lesson are deleted with it (the
 * database does this because they point at the lesson). Points and badges
 * already earned are kept, because they are stored on the learner.
 * A pack must keep at least one lesson.
 */
const deleteLesson = async (req, res) => {
  const packId = Number(req.params.packId);
  const key = String(req.params.key || '');
  if (!Number.isInteger(packId) || packId < 1 || !KEY_RULE.test(key)) {
    return res.status(400).json({ error: 'The pack id or the lesson key is not valid.' });
  }
  try {
    const found = await db.query('SELECT file_path FROM content_packs WHERE pack_id = $1', [packId]);
    if (found.rows.length === 0) return res.status(404).json({ error: 'Pack not found.' });
    const full = resolvePackFile(found.rows[0].file_path);
    if (!full) return res.status(404).json({ error: 'The pack file is missing on the server.' });

    const zip = new AdmZip(full);
    const manifestEntry = zip.getEntry('manifest.json');
    if (!manifestEntry) return res.status(422).json({ error: 'This pack has no manifest.json.' });
    const manifest = JSON.parse(manifestEntry.getData().toString('utf8'));
    const modules = Array.isArray(manifest.modules) ? manifest.modules : [];
    const target = modules.find((m) => m && m.key === key);

    const row = await db.query('SELECT module_id FROM modules WHERE pack_id = $1 AND module_key = $2', [packId, key]);
    if (!target && row.rows.length === 0) return res.status(404).json({ error: 'That lesson is not in this pack.' });
    if (target && modules.length <= 1) {
      return res.status(400).json({ error: 'A pack must keep at least one lesson. Publish a different pack instead of deleting the last lesson.' });
    }

    let version = null;
    if (target) {
      const rest = modules.filter((m) => m !== target).map((m, i) => ({ ...m, order: i + 1 }));
      const used = new Set(['manifest.json']);
      rest.forEach((m) => {
        if (typeof m.body_file === 'string') used.add(m.body_file);
        if (typeof m.audio === 'string') used.add(m.audio);
        (Array.isArray(m.assets) ? m.assets : []).forEach((a) => a && typeof a.path === 'string' && used.add(a.path));
      });
      const smaller = new AdmZip();
      zip.getEntries().forEach((e) => {
        if (e.isDirectory || e.entryName === 'manifest.json') return;
        if (used.has(e.entryName)) smaller.addFile(e.entryName, e.getData());
      });
      smaller.addFile('manifest.json', Buffer.from(JSON.stringify({ ...manifest, modules: rest }, null, 2), 'utf8'));
      const result = await publishPackBuffer(smaller.toBuffer());
      version = result.payload.pack.version;
    }

    // Delete the lesson row. Learners' progress and quiz results go with it.
    const affected = await db.query(
      `SELECT COUNT(DISTINCT up.user_id)::int AS learners
       FROM modules m LEFT JOIN user_progress up ON up.module_id = m.module_id
       WHERE m.pack_id = $1 AND m.module_key = $2`, [packId, key]);
    await db.query('DELETE FROM modules WHERE pack_id = $1 AND module_key = $2', [packId, key]);

    return res.status(200).json({
      message: 'Lesson deleted.',
      deleted_key: key,
      version,
      learners_with_progress: affected.rows[0] ? affected.rows[0].learners : 0
    });
  } catch (err) {
    return sendPublishError(res, err);
  }
};

module.exports = { uploadAudio, saveLessons, getPackSource, deleteLesson };
