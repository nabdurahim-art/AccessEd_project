// Pack logic that is the same on the phone and in the browser: opening a zip
// safely, checking its manifest, and telling the server what was downloaded.
// Only the place where the files are kept differs (downloader.js for the
// phone, downloader.web.js for the browser).
import { unzipSync, strFromU8 } from 'fflate';
import { Platform } from 'react-native';

import { request } from './api';
import { getDeviceId } from './session';
import { getMeta, setMeta } from './db';

// Limits that protect the device from a pack that unpacks into something huge.
const MAX_UNPACKED_BYTES = 100 * 1024 * 1024;
const MAX_FILES = 500;

export function fail(code, message, extra = {}) {
  const err = new Error(message);
  err.code = code;
  return Object.assign(err, extra);
}

// A path inside a zip is safe only if it stays inside the pack folder.
export function isSafePath(path) {
  if (!path || path.startsWith('/') || path.includes('\\') || path.includes(':') || path.includes('\0')) {
    return false;
  }
  return path.split('/').every((part) => part !== '' && part !== '.' && part !== '..');
}

export function toHex(buffer) {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Opens the zip in memory, with limits, and checks it BEFORE anything is
 * written. Returns { files, names, manifest } or throws a bad_pack error.
 */
export function unpackAndCheck(bytes) {
  let files;
  try {
    let total = 0;
    let count = 0;
    files = unzipSync(bytes, {
      filter: (f) => {
        count += 1;
        total += f.originalSize;
        if (count > MAX_FILES || total > MAX_UNPACKED_BYTES) throw fail('bad_pack', 'bad');
        return true;
      },
    });
  } catch (err) {
    throw fail('bad_pack', 'This pack could not be opened.');
  }

  const names = Object.keys(files).filter((n) => !n.endsWith('/'));
  if (!names.every(isSafePath)) throw fail('bad_pack', 'This pack could not be opened.');

  let manifest;
  try {
    manifest = JSON.parse(strFromU8(files['manifest.json']));
  } catch (err) {
    throw fail('bad_pack', 'This pack could not be opened.');
  }
  if (!manifest || !Array.isArray(manifest.modules) || manifest.modules.length === 0) {
    throw fail('bad_pack', 'This pack could not be opened.');
  }
  for (const m of manifest.modules) {
    const needed = [m.body_file, m.audio, ...(Array.isArray(m.assets) ? m.assets.map((a) => a && a.path) : [])];
    const missing = needed.some((p) => p && !(p in files));
    if (typeof m.key !== 'string' || missing) throw fail('bad_pack', 'This pack could not be opened.');
  }

  return { files, names, manifest };
}

/* ------------------------------------------------------------------ *
 *  Telling the server what is downloaded
 * ------------------------------------------------------------------ */

async function postConfirm(packId, version) {
  await request('POST', `/content/packs/${packId}/confirm`, {
    device_id: await getDeviceId(),
    platform: Platform.OS,
    version,
  });
}

export async function confirmOrQueue(packId, version) {
  try {
    await postConfirm(packId, version);
  } catch (err) {
    try {
      const queue = (await getMeta('pending_confirms')) || [];
      const rest = queue.filter((c) => c.pack_id !== packId);
      rest.push({ pack_id: packId, version });
      await setMeta('pending_confirms', rest);
    } catch (metaErr) {
      console.error('Could not queue the download confirmation:', metaErr);
    }
  }
}

/**
 * Sends the confirmations that could not be sent while offline. Call this at
 * the start of every sync. A confirmation is dropped when the server says the
 * pack is gone (404) or the version is wrong (400); it stays for any other
 * failure, such as being offline.
 */
export async function retryPendingConfirms() {
  const queue = (await getMeta('pending_confirms')) || [];
  const left = [];
  for (const item of queue) {
    try {
      await postConfirm(item.pack_id, item.version);
    } catch (err) {
      const permanent = err.status === 404 || err.status === 400;
      if (!permanent) left.push(item);
    }
  }
  await setMeta('pending_confirms', left);
}
