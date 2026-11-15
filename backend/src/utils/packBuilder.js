// Builds a lesson pack zip from what the lesson editor sends, and reads a pack
// back into the same shape for editing.
//
// This does in JavaScript what tools/build_packs.py does for files on a
// computer, with the same rules, so a pack written in the editor and a pack
// built from the content/ folder look the same to the app.
//
// What the editor sends (a "spec"):
//   {
//     course: { title, subject, language, level, description },
//     pack:   { title, week_number },
//     lessons: [{
//       key,            // only for a lesson that is already published
//       title, body,    // body is the lesson text
//       duration_min,   // optional
//       audio,          // null, { keep: true } or { token: "<from the audio upload>" }
//       quiz            // null or { pass_mark, questions: [{ prompt, options, correct_index, explanation }] }
//     }]
//   }

const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const { PACKS_DIR } = require('./packFiles');
const { readIdentity } = require('./uploadChecks');

const AUDIO_DIR = path.join(PACKS_DIR, '.audio');   // audio waiting to be used in a pack
const MAX_AUDIO_BYTES = 2 * 1024 * 1024;            // same limit as build_packs.py
const MAX_LESSONS = 50;
const MAX_QUESTIONS = 50;
const MAX_BODY_CHARS = 12000;
const MAX_ERRORS = 20;
const KEY_RULE = /^[A-Za-z0-9_-]{1,30}$/;
const TOKEN_RULE = /^[a-f0-9]{32}$/;

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isText = (v, max) => typeof v === 'string' && v.trim() !== '' && v.length <= max;

// The app shows headings, **bold**, *italic*, "- " bullets and images only.
// These are the same checks as check_lesson_text in build_packs.py.
function lessonTextProblems(text) {
  const out = [];
  text.split(/\r?\n/).forEach((line, i) => {
    const n = i + 1;
    if (/^\s*\d+[.)]\s/.test(line)) out.push(`line ${n}: numbered lists are not shown as a list, use "- " bullets`);
    const lead = line.trimStart();
    if (lead.startsWith('```') || lead.startsWith('|') || lead.startsWith('>')) {
      out.push(`line ${n}: code blocks, tables and quotes are not supported`);
    }
    if (/\[[^\]]+\]\(http/.test(line)) out.push(`line ${n}: links do not work offline, remove them`);
  });
  return out.slice(0, 3);
}

// An MP3 starts with an "ID3" tag or with a frame header (0xFF 0xEx).
function looksLikeMp3(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 128) return false;
  if (buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) return true;
  return buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0;
}

function audioPath(token) {
  return TOKEN_RULE.test(token) ? path.join(AUDIO_DIR, `${token}.mp3`) : null;
}

/**
 * Builds the pack zip.
 * existing  null for a new pack, or { manifest, zip } of the pack being edited
 *           (used to keep its audio and images and to keep lesson keys steady).
 * Returns { ok: true, zip: Buffer, spec } or { ok: false, errors: [text, ...] }.
 */
function buildPack(spec, existing) {
  const errors = [];
  const fail = (text) => { if (errors.length < MAX_ERRORS) errors.push(text); };

  if (!isObject(spec) || !isObject(spec.course) || !isObject(spec.pack)) {
    return { ok: false, errors: ['Send the course, the pack and the lessons.'] };
  }

  const identity = readIdentity({ language: spec.course.language, course: spec.course, pack: spec.pack });
  if (!identity.valid) return { ok: false, errors: identity.errors };
  const { course, pack } = identity;

  const lessons = spec.lessons;
  if (!Array.isArray(lessons) || lessons.length === 0) {
    return { ok: false, errors: ['Add at least one lesson.'] };
  }
  if (lessons.length > MAX_LESSONS) {
    return { ok: false, errors: [`A pack can have at most ${MAX_LESSONS} lessons.`] };
  }

  const oldModules = new Map();
  if (existing && Array.isArray(existing.manifest.modules)) {
    existing.manifest.modules.forEach((m) => oldModules.set(m.key, m));
  }

  // Keys: a lesson that is already published keeps its key, because learners'
  // progress is tied to it. A new lesson gets the next free "mN".
  const used = new Set();
  lessons.forEach((l) => {
    if (isObject(l) && typeof l.key === 'string' && KEY_RULE.test(l.key) && !used.has(l.key)) used.add(l.key);
  });
  let next = 1;
  const newKey = () => {
    while (used.has(`m${next}`)) next += 1;
    used.add(`m${next}`);
    return `m${next}`;
  };

  const manifestModules = [];
  const files = new Map(); // name in the zip -> Buffer
  const seenKeys = new Set();
  const keptSpec = [];

  lessons.forEach((l, i) => {
    const at = `Lesson ${i + 1}`;
    if (!isObject(l)) { fail(`${at}: not valid.`); return; }

    let key = l.key;
    if (key === undefined || key === null || key === '') key = newKey();
    if (typeof key !== 'string' || !KEY_RULE.test(key)) { fail(`${at}: invalid key.`); return; }
    if (seenKeys.has(key)) { fail(`${at}: the key "${key}" is used twice.`); return; }
    seenKeys.add(key);

    if (!isText(l.title, 150)) fail(`${at}: add a title (up to 150 characters).`);
    const body = typeof l.body === 'string' ? l.body.replace(/\r\n/g, '\n') : '';
    if (body.trim().length < 40) fail(`${at}: the lesson text is almost empty (at least 40 characters).`);
    else if (body.length > MAX_BODY_CHARS) fail(`${at}: the lesson text is too long (up to ${MAX_BODY_CHARS} characters).`);
    else lessonTextProblems(body).forEach((p) => fail(`${at}: ${p}.`));

    let duration = 10;
    if (l.duration_min !== undefined && l.duration_min !== null && l.duration_min !== '') {
      if (Number.isInteger(l.duration_min) && l.duration_min >= 1 && l.duration_min <= 240) duration = l.duration_min;
      else fail(`${at}: minutes must be a whole number from 1 to 240.`);
    }

    const entry = {
      key,
      title: typeof l.title === 'string' ? l.title.trim() : '',
      order: i + 1,
      duration_min: duration,
      content_type: 'markdown',
      body_file: `${key}/lesson.md`
    };
    files.set(entry.body_file, Buffer.from(body, 'utf8'));

    // Audio: keep the one already in the pack, or use a new upload.
    const old = oldModules.get(key);
    if (isObject(l.audio) && l.audio.keep === true) {
      const oldEntry = old && old.audio ? existing.zip.getEntry(old.audio) : null;
      if (!oldEntry) fail(`${at}: there is no earlier audio to keep.`);
      else {
        entry.audio = `${key}/audio.mp3`;
        files.set(entry.audio, oldEntry.getData());
      }
    } else if (isObject(l.audio) && l.audio.token !== undefined) {
      const p = audioPath(l.audio.token);
      let data = null;
      try { data = p ? fs.readFileSync(p) : null; } catch (e) { /* missing */ }
      if (!data) fail(`${at}: the audio file expired, add it again.`);
      else {
        entry.audio = `${key}/audio.mp3`;
        files.set(entry.audio, data);
      }
    } else if (l.audio !== undefined && l.audio !== null) {
      fail(`${at}: audio is not valid.`);
    }

    // Images and other files the lesson already uses stay with the lesson.
    if (old && Array.isArray(old.assets)) {
      const kept = [];
      old.assets.forEach((a) => {
        const e = a && typeof a.path === 'string' ? existing.zip.getEntry(a.path) : null;
        if (e) { kept.push(a); files.set(a.path, e.getData()); }
      });
      if (kept.length) entry.assets = kept;
    }

    // Quiz.
    if (l.quiz !== undefined && l.quiz !== null) {
      const q = l.quiz;
      if (!isObject(q)) fail(`${at}: the quiz is not valid.`);
      else {
        let passMark = 70;
        if (q.pass_mark !== undefined && q.pass_mark !== null && q.pass_mark !== '') {
          if (Number.isInteger(q.pass_mark) && q.pass_mark >= 0 && q.pass_mark <= 100) passMark = q.pass_mark;
          else fail(`${at}: the pass mark must be a whole number from 0 to 100.`);
        }
        const qs = q.questions;
        if (!Array.isArray(qs) || qs.length === 0) fail(`${at}: a quiz needs at least one question (or remove the quiz).`);
        else if (qs.length > MAX_QUESTIONS) fail(`${at}: a quiz can have at most ${MAX_QUESTIONS} questions.`);
        else {
          const cleaned = [];
          qs.forEach((qu, k) => {
            const qa = `${at}, question ${k + 1}`;
            if (!isObject(qu)) { fail(`${qa}: not valid.`); return; }
            if (!isText(qu.prompt, 500)) fail(`${qa}: write the question (up to 500 characters).`);
            const opts = Array.isArray(qu.options) ? qu.options.map((o) => (typeof o === 'string' ? o.trim() : o)) : null;
            if (!opts || opts.length < 2 || opts.length > 6 || !opts.every((o) => isText(o, 200))) {
              fail(`${qa}: give 2 to 6 answers, none empty.`); return;
            }
            if (new Set(opts).size !== opts.length) fail(`${qa}: two answers are the same.`);
            if (!(Number.isInteger(qu.correct_index) && qu.correct_index >= 0 && qu.correct_index < opts.length)) {
              fail(`${qa}: choose the correct answer.`); return;
            }
            const item = { key: `q${k + 1}`, type: 'multiple_choice', prompt: String(qu.prompt || '').trim(), options: opts, correct_index: qu.correct_index };
            if (typeof qu.explanation === 'string' && qu.explanation.trim() !== '') {
              if (qu.explanation.length > 500) fail(`${qa}: the explanation is too long (up to 500 characters).`);
              else item.explanation = qu.explanation.trim();
            }
            cleaned.push(item);
          });
          if (cleaned.length === qs.length) entry.quiz = { pass_mark: passMark, questions: cleaned };
        }
      }
    }

    manifestModules.push(entry);
    keptSpec.push(key);
  });

  if (errors.length > 0) return { ok: false, errors };

  const manifest = {
    manifest_version: 1,
    language: course.language,
    course: {
      title: course.title,
      subject: course.subject,
      language: course.language,
      level: course.level,
      description: course.description || ''
    },
    pack: { title: pack.title, week_number: pack.week_number },
    modules: manifestModules
  };

  const zip = new AdmZip();
  zip.addFile('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'));
  [...files.keys()].sort().forEach((name) => zip.addFile(name, files.get(name)));
  return { ok: true, zip: zip.toBuffer(), keys: keptSpec, course, pack };
}

/**
 * Turns a published pack back into the editor's shape.
 * course comes from the database, because older packs have no course block.
 */
function readPackSource(zipBuffer, courseRow, packRow) {
  const zip = new AdmZip(zipBuffer);
  const manifestEntry = zip.getEntry('manifest.json');
  if (!manifestEntry) return null;
  const manifest = JSON.parse(manifestEntry.getData().toString('utf8'));

  const lessons = (manifest.modules || []).map((m) => {
    const bodyEntry = typeof m.body_file === 'string' ? zip.getEntry(m.body_file) : null;
    const lesson = {
      key: m.key,
      title: m.title,
      body: bodyEntry ? bodyEntry.getData().toString('utf8') : '',
      duration_min: m.duration_min || 10,
      audio: m.audio && zip.getEntry(m.audio) ? { keep: true } : null,
      quiz: null
    };
    if (m.quiz && Array.isArray(m.quiz.questions)) {
      lesson.quiz = {
        pass_mark: Number.isInteger(m.quiz.pass_mark) ? m.quiz.pass_mark : 70,
        questions: m.quiz.questions.map((q) => ({
          prompt: q.prompt,
          options: q.options,
          correct_index: q.correct_index,
          explanation: q.explanation || ''
        }))
      };
    }
    return lesson;
  });

  return {
    course: {
      title: courseRow.title,
      subject: courseRow.subject,
      language: courseRow.language,
      level: courseRow.level,
      description: courseRow.description || ''
    },
    pack: { title: packRow.title, week_number: packRow.week_number, version: packRow.version },
    lessons
  };
}

module.exports = { buildPack, readPackSource, looksLikeMp3, audioPath, AUDIO_DIR, MAX_AUDIO_BYTES };
