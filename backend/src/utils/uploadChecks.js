// Checks for the "upload a pack" screen (admin side).
//
// A pack made with tools/build_packs.py carries its own course details in
// manifest.json, in a "course" block and a "pack" block. These helpers read
// and check those two blocks. The lessons and quizzes are checked separately
// by validateManifest in manifest.js.

const AdmZip = require('adm-zip');

const LANGUAGES = ['en', 'fr', 'rw'];
const LEVELS = ['primary', 'secondary'];

const MAX_ZIP_ENTRIES = 1000;                    // files inside one pack
const MAX_UNPACKED_BYTES = 100 * 1024 * 1024;    // everything inside one pack

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isText = (v, max) => typeof v === 'string' && v.trim() !== '' && v.length <= max;

// A real zip file starts with these four bytes.
function looksLikeZip(buffer) {
  return Buffer.isBuffer(buffer) && buffer.length > 22 &&
    buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04;
}

// Refuses a zip with far too many files or a huge unpacked size, before
// anything is read from it. Nothing is unpacked by the server; this is only a
// guard against a damaged or hostile file.
function checkZipSize(buffer) {
  let entries;
  try {
    entries = new AdmZip(buffer).getEntries();
  } catch (err) {
    return 'The file is not a valid zip.';
  }
  if (entries.length > MAX_ZIP_ENTRIES) {
    return `The zip has too many files (more than ${MAX_ZIP_ENTRIES}).`;
  }
  const total = entries.reduce((sum, e) => sum + e.header.size, 0);
  if (total > MAX_UNPACKED_BYTES) {
    return 'The zip is too large when unpacked.';
  }
  return null;
}

/**
 * Reads the course and pack details from a manifest.
 * Returns { valid: true, course, pack } or { valid: false, errors: [text, ...] }.
 */
function readIdentity(manifest) {
  const errors = [];
  const { course, pack } = manifest || {};

  if (!isObject(course) || !isObject(pack)) {
    return {
      valid: false,
      errors: [
        'This pack has no course details inside it. Build it again with the newest tools/build_packs.py, then upload the new zip.'
      ]
    };
  }

  if (!isText(course.title, 150)) errors.push('course.title: required, up to 150 characters.');
  if (!isText(course.subject, 80)) errors.push('course.subject: required, up to 80 characters.');
  if (!LANGUAGES.includes(course.language)) errors.push('course.language: must be en, fr or rw.');
  if (!LEVELS.includes(course.level)) errors.push('course.level: must be primary or secondary.');
  if (course.description !== undefined && course.description !== null &&
      !(typeof course.description === 'string' && course.description.length <= 2000)) {
    errors.push('course.description: text of up to 2000 characters.');
  }
  if (!isText(pack.title, 150)) errors.push('pack.title: required, up to 150 characters.');
  if (!(Number.isInteger(pack.week_number) && pack.week_number >= 1 && pack.week_number <= 1000)) {
    errors.push('pack.week_number: must be a whole number of 1 or more.');
  }
  if (manifest.language !== undefined && course.language !== manifest.language) {
    errors.push('course.language must match the language of the manifest.');
  }

  if (errors.length > 0) return { valid: false, errors };

  return {
    valid: true,
    course: {
      title: course.title.trim(),
      subject: course.subject.trim(),
      language: course.language,
      level: course.level,
      description: typeof course.description === 'string' && course.description.trim() !== ''
        ? course.description.trim()
        : null
    },
    pack: { title: pack.title.trim(), week_number: pack.week_number }
  };
}

// The name the server gives the file. It is made only from numbers and fixed
// words, so a pack can never choose where its file is saved, and two packs can
// never share a file.
function storedFileName(level, courseId, weekNumber) {
  return `${level}-course${courseId}-week${weekNumber}.zip`;
}

module.exports = { looksLikeZip, checkZipSize, readIdentity, storedFileName, LANGUAGES, LEVELS };
