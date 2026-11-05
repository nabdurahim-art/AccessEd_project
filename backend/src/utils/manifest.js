// Reads and checks the manifest.json inside a lesson pack.
//
// The manifest sits at the root of the zip and describes the pack's lessons
// and quizzes. The server reads it when a pack is published, so the database
// always matches the file that learners download. Nothing is saved here: this
// file only reads and checks, and the caller decides what to do with the result.

const AdmZip = require('adm-zip');

const MAX_MANIFEST_BYTES = 256 * 1024; // a manifest bigger than this is not a manifest
const MAX_MODULES = 50;
const MAX_QUESTIONS = 50;
const MAX_ASSETS = 200;
const MAX_ERRORS = 20; // enough to fix a manifest without flooding the reply

const KEY_RULE = /^[A-Za-z0-9_-]{1,50}$/;

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isText = (v, max) => typeof v === 'string' && v.trim() !== '' && v.length <= max;

// A path inside the zip: no leading slash, no "..", no backslashes.
function isSafePath(p) {
  if (typeof p !== 'string' || p === '' || p.length > 255) return false;
  if (p.startsWith('/') || p.includes('\\')) return false;
  return !p.split('/').some((part) => part === '..' || part === '');
}

/**
 * Opens the zip and parses manifest.json.
 * Returns { ok: true, manifest, files } or { ok: false, error }.
 * "files" is the set of file names inside the zip, used to check that every
 * file the manifest mentions really exists.
 */
function readManifest(zipPath) {
  let zip;
  try {
    zip = new AdmZip(zipPath);
  } catch (err) {
    return { ok: false, error: 'The pack file is not a valid zip.' };
  }

  const entry = zip.getEntry('manifest.json');
  if (!entry) {
    return { ok: false, error: 'manifest.json is missing at the root of the zip.' };
  }
  if (entry.header.size > MAX_MANIFEST_BYTES) {
    return { ok: false, error: 'manifest.json is too large.' };
  }

  let manifest;
  try {
    manifest = JSON.parse(entry.getData().toString('utf8'));
  } catch (err) {
    return { ok: false, error: 'manifest.json is not valid JSON.' };
  }

  const files = new Set(zip.getEntries().map((e) => e.entryName));
  return { ok: true, manifest, files };
}

/**
 * Checks the manifest and returns the cleaned lessons.
 * Returns { valid: true, modules } or { valid: false, errors: [text, ...] }.
 * Each cleaned module is { key, title, order, duration_min, audio, pass_mark }
 * where pass_mark is null if the module has no quiz.
 * Quiz questions are checked here but not returned, because they stay inside
 * the zip and the phone reads them from there.
 */
function validateManifest(manifest, files) {
  const errors = [];
  const fail = (text) => { if (errors.length < MAX_ERRORS) errors.push(text); };

  if (!isObject(manifest)) {
    return { valid: false, errors: ['manifest.json must contain a JSON object.'] };
  }
  if (manifest.manifest_version !== 1) {
    fail('manifest_version must be 1.');
  }
  if (manifest.language !== undefined && !['en', 'fr', 'rw'].includes(manifest.language)) {
    fail('language must be en, fr or rw.');
  }
  if (!Array.isArray(manifest.modules) || manifest.modules.length === 0) {
    fail('modules must be a list with at least one lesson.');
    return { valid: false, errors };
  }
  if (manifest.modules.length > MAX_MODULES) {
    fail(`A pack can have at most ${MAX_MODULES} lessons.`);
    return { valid: false, errors };
  }

  // A file the manifest names must be a safe path and really be in the zip.
  const checkFile = (where, p) => {
    if (!isSafePath(p)) fail(`${where}: not a valid file path.`);
    else if (!files.has(p)) fail(`${where}: "${p}" is not in the zip.`);
  };

  const modules = [];
  const seenKeys = new Set();

  manifest.modules.forEach((m, i) => {
    const at = `modules[${i}]`;
    if (!isObject(m)) { fail(`${at}: must be an object.`); return; }

    if (typeof m.key !== 'string' || !KEY_RULE.test(m.key)) {
      fail(`${at}.key: use 1 to 50 letters, numbers, - or _.`);
    } else if (seenKeys.has(m.key)) {
      fail(`${at}.key: "${m.key}" is used twice.`);
    } else {
      seenKeys.add(m.key);
    }

    if (!isText(m.title, 150)) fail(`${at}.title: required, up to 150 characters.`);

    if (m.order !== undefined && !(Number.isInteger(m.order) && m.order >= 1 && m.order <= 1000)) {
      fail(`${at}.order: must be a whole number of 1 or more.`);
    }
    if (m.duration_min !== undefined &&
        !(Number.isInteger(m.duration_min) && m.duration_min >= 1 && m.duration_min <= 240)) {
      fail(`${at}.duration_min: must be a whole number from 1 to 240.`);
    }

    checkFile(`${at}.body_file`, m.body_file);
    if (m.audio !== undefined && m.audio !== null) checkFile(`${at}.audio`, m.audio);

    if (m.assets !== undefined) {
      if (!Array.isArray(m.assets) || m.assets.length > MAX_ASSETS) {
        fail(`${at}.assets: must be a list of at most ${MAX_ASSETS} files.`);
      } else {
        m.assets.forEach((a, j) => checkFile(`${at}.assets[${j}].path`, isObject(a) ? a.path : undefined));
      }
    }

    let passMark = null;
    if (m.quiz !== undefined && m.quiz !== null) {
      const q = m.quiz;
      if (!isObject(q)) {
        fail(`${at}.quiz: must be an object.`);
      } else {
        passMark = 70;
        if (q.pass_mark !== undefined) {
          if (Number.isInteger(q.pass_mark) && q.pass_mark >= 0 && q.pass_mark <= 100) passMark = q.pass_mark;
          else fail(`${at}.quiz.pass_mark: must be a whole number from 0 to 100.`);
        }
        if (!Array.isArray(q.questions) || q.questions.length === 0 || q.questions.length > MAX_QUESTIONS) {
          fail(`${at}.quiz.questions: must be a list of 1 to ${MAX_QUESTIONS} questions.`);
        } else {
          const seenQ = new Set();
          q.questions.forEach((qu, k) => {
            const qa = `${at}.quiz.questions[${k}]`;
            if (!isObject(qu)) { fail(`${qa}: must be an object.`); return; }
            if (typeof qu.key !== 'string' || !KEY_RULE.test(qu.key)) fail(`${qa}.key: use 1 to 50 letters, numbers, - or _.`);
            else if (seenQ.has(qu.key)) fail(`${qa}.key: "${qu.key}" is used twice.`);
            else seenQ.add(qu.key);
            if (!isText(qu.prompt, 500)) fail(`${qa}.prompt: required, up to 500 characters.`);
            if (!Array.isArray(qu.options) || qu.options.length < 2 || qu.options.length > 6 ||
                !qu.options.every((o) => isText(o, 200))) {
              fail(`${qa}.options: 2 to 6 answers, each up to 200 characters.`);
            } else if (!(Number.isInteger(qu.correct_index) && qu.correct_index >= 0 && qu.correct_index < qu.options.length)) {
              fail(`${qa}.correct_index: must point at one of the options (0 is the first).`);
            }
            if (qu.explanation !== undefined && !(typeof qu.explanation === 'string' && qu.explanation.length <= 500)) {
              fail(`${qa}.explanation: text of up to 500 characters.`);
            }
          });
        }
      }
    }

    modules.push({
      key: m.key,
      title: typeof m.title === 'string' ? m.title.trim() : m.title,
      order: Number.isInteger(m.order) ? m.order : i + 1,
      duration_min: Number.isInteger(m.duration_min) ? m.duration_min : 10,
      audio: typeof m.audio === 'string' ? m.audio : null,
      pass_mark: passMark
    });
  });

  return errors.length > 0 ? { valid: false, errors } : { valid: true, modules };
}

module.exports = { readManifest, validateManifest };
