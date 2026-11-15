// Helpers for pack files (the zips that learners download).

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Folder where published pack files are kept. Pack file paths in the
// database are file names inside this folder, never paths anywhere else.
const PACKS_DIR = path.resolve(process.env.PACKS_DIR || 'storage/packs');

// Returns the full path of a pack file only if it is inside PACKS_DIR and
// really exists. This stops a request from pointing at files like /etc/passwd.
function resolvePackFile(fileName) {
  if (typeof fileName !== 'string' || fileName === '') return null;
  const full = path.resolve(PACKS_DIR, fileName);
  if (!full.startsWith(PACKS_DIR + path.sep)) return null;
  try {
    return fs.statSync(full).isFile() ? full : null;
  } catch (err) {
    return null;
  }
}

// Works out the SHA-256 checksum of a file by reading it in pieces,
// so a big pack does not use much memory or block the server.
function hashFile(fullPath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    fs.createReadStream(fullPath)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('hex')))
      .on('error', reject);
  });
}

// File size in kilobytes, rounded, and never less than 1.
function sizeInKb(fullPath) {
  return Math.max(1, Math.round(fs.statSync(fullPath).size / 1024));
}

module.exports = { PACKS_DIR, resolvePackFile, hashFile, sizeInKb };
