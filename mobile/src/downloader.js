import * as FileSystem from 'expo-file-system/legacy';
import * as Crypto from 'expo-crypto';
import { unzipSync, strFromU8 } from 'fflate';
import base64 from 'base64-js';
import { Platform } from 'react-native';

import { API_URL, request } from './api';
import { getToken, clearToken, getDeviceId } from './session';
import {
  installPack,
  getDownloadedPacks,
  resetPackDownload,
  getMeta,
  setMeta,
} from './db';

// Limits that protect the phone from a pack that unpacks into something huge.
const MAX_UNPACKED_BYTES = 100 * 1024 * 1024;
const MAX_FILES = 500;

const packsRoot = () => `${FileSystem.documentDirectory}packs/`;

// local_path is saved RELATIVE ('packs/7/'), because the full path of the
// app's folder can change when the app is updated.
const relativeFolder = (packId) => `packs/${packId}/`;

/**
 * The full file address of a file inside a downloaded pack, for the lesson
 * screens: packFileUri(pack, 'm1/lesson.md').
 */
export function packFileUri(pack, relativeFile) {
  return `${FileSystem.documentDirectory}${pack.local_path}${relativeFile}`;
}

function fail(code, message, extra = {}) {
  const err = new Error(message);
  err.code = code;
  return Object.assign(err, extra);
}

const remove = (path) => FileSystem.deleteAsync(path, { idempotent: true }).catch(() => {});

// A path inside a zip is safe only if it stays inside the pack folder.
function isSafePath(path) {
  if (!path || path.startsWith('/') || path.includes('\\') || path.includes(':') || path.includes('\0')) {
    return false;
  }
  return path.split('/').every((part) => part !== '' && part !== '.' && part !== '..');
}

function toHex(buffer) {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/* ------------------------------------------------------------------ *
 *  Start-up housekeeping
 * ------------------------------------------------------------------ */

/**
 * Cleans up after a crash. Removes half-downloaded files and half-unpacked
 * folders. If a crash happened while swapping in a new version, the old
 * version is put back. Call once when the app starts, after initDatabase.
 */
export async function cleanupLeftovers() {
  try {
    const root = packsRoot();
    const info = await FileSystem.getInfoAsync(root);
    if (!info.exists) return;

    for (const name of await FileSystem.readDirectoryAsync(root)) {
      if (name.endsWith('.zip.part') || name.endsWith('_tmp')) {
        await remove(`${root}${name}`);
      } else if (name.endsWith('_old')) {
        const live = `${root}${name.slice(0, -4)}`;
        const liveInfo = await FileSystem.getInfoAsync(live);
        if (liveInfo.exists) {
          await remove(`${root}${name}`);
        } else {
          await FileSystem.moveAsync({ from: `${root}${name}`, to: live }).catch(() => {});
        }
      }
    }
  } catch (err) {
    console.error('Error cleaning up pack leftovers:', err);
  }
}

/**
 * Checks that every pack the database calls "downloaded" really has its
 * files (a learner may clear the app's storage). A pack with no files goes
 * back to "Download". Call at app start, after cleanupLeftovers.
 */
export async function verifyInstalledPacks() {
  for (const pack of await getDownloadedPacks()) {
    const folder = pack.local_path ? `${FileSystem.documentDirectory}${pack.local_path}` : null;
    const info = folder ? await FileSystem.getInfoAsync(folder) : { exists: false };
    if (!info.exists) await resetPackDownload(pack.pack_id);
  }
}

/* ------------------------------------------------------------------ *
 *  Download
 * ------------------------------------------------------------------ */

const active = new Map(); // packId -> running download

/**
 * Downloads, checks, unpacks and installs a pack.
 * onProgress({ stage, fraction }) with stage one of: downloading, verifying,
 * unpacking, installing, completed. fraction is 0..1, or -1 when unknown.
 * If the same pack is already downloading, the same download is returned.
 * Errors carry a .code: offline, unauthorized, not_found, server,
 * checksum_mismatch, bad_pack, save_failed.
 */
export function downloadPack(pack, onProgress = () => {}) {
  if (active.has(pack.pack_id)) return active.get(pack.pack_id);
  const job = runDownload(pack, onProgress).finally(() => active.delete(pack.pack_id));
  active.set(pack.pack_id, job);
  return job;
}

async function runDownload(pack, onProgress) {
  const packId = pack.pack_id;
  const root = packsRoot();
  const partPath = `${root}${packId}.zip.part`;
  const tmpFolder = `${root}${packId}_tmp/`;
  const oldFolder = `${root}${packId}_old/`;
  const liveFolder = `${root}${packId}/`;

  try {
    await FileSystem.makeDirectoryAsync(root, { intermediates: true });

    // 1. Download to a temporary file
    onProgress({ stage: 'downloading', fraction: 0 });
    const token = await getToken();
    const headers = token ? { Authorization: `Bearer ${token}` } : {};

    const download = FileSystem.createDownloadResumable(
      `${API_URL}/content/packs/${packId}/download`,
      partPath,
      { headers },
      (data) => {
        const total = data.totalBytesExpectedToWrite;
        const fraction = total > 0 ? Math.min(data.totalBytesWritten / total, 1) : -1;
        onProgress({ stage: 'downloading', fraction });
      }
    );

    let result;
    try {
      result = await download.downloadAsync();
    } catch (err) {
      throw fail('offline', 'No connection. Try again when online.', { offline: true });
    }

    if (!result) throw fail('cancelled', 'The download was cancelled.');
    if (result.status === 401) {
      await clearToken();
      throw fail('unauthorized', 'Please log in again.', { status: 401 });
    }
    if (result.status === 404) throw fail('not_found', 'This pack is no longer available.', { status: 404 });
    if (result.status !== 200) {
      throw fail('server', `Server error (${result.status}). Try again later.`, { status: result.status });
    }

    // 2. The checksum and version that came with THIS file
    const headerOf = (name) => {
      const wanted = name.toLowerCase();
      const key = Object.keys(result.headers || {}).find((k) => k.toLowerCase() === wanted);
      return key ? result.headers[key] : null;
    };
    const serverChecksum = headerOf('x-checksum-sha256');
    if (!serverChecksum) throw fail('bad_pack', 'This pack could not be checked. Try again later.');
    const headerVersion = parseInt(headerOf('x-pack-version'), 10);
    const version = Number.isInteger(headerVersion) && headerVersion > 0 ? headerVersion : pack.version;

    // 3. Verify SHA-256 before opening anything
    onProgress({ stage: 'verifying', fraction: 1 });
    const text = await FileSystem.readAsStringAsync(partPath, { encoding: FileSystem.EncodingType.Base64 });
    const bytes = base64.toByteArray(text);
    const computed = toHex(await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes));
    if (computed !== serverChecksum.trim().toLowerCase()) {
      throw fail('checksum_mismatch', 'The download was damaged. Try again.');
    }

    // 4. Open the zip in memory, with limits, and check it BEFORE writing anything
    onProgress({ stage: 'unpacking', fraction: 0 });
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

    // 5. Write into a temporary folder
    await remove(tmpFolder);
    await FileSystem.makeDirectoryAsync(tmpFolder, { intermediates: true });
    let written = 0;
    for (const name of names) {
      const target = `${tmpFolder}${name}`;
      const slash = target.lastIndexOf('/');
      await FileSystem.makeDirectoryAsync(target.substring(0, slash), { intermediates: true });
      await FileSystem.writeAsStringAsync(target, base64.fromByteArray(files[name]), {
        encoding: FileSystem.EncodingType.Base64,
      });
      written += 1;
      onProgress({ stage: 'unpacking', fraction: written / names.length });
    }

    // 6. Swap in. The old version is kept aside until the database is saved.
    onProgress({ stage: 'installing', fraction: 1 });
    await remove(oldFolder);
    const hadLive = (await FileSystem.getInfoAsync(liveFolder)).exists;
    if (hadLive) await FileSystem.moveAsync({ from: liveFolder, to: oldFolder });
    try {
      await FileSystem.moveAsync({ from: tmpFolder, to: liveFolder });
    } catch (err) {
      if (hadLive) await FileSystem.moveAsync({ from: oldFolder, to: liveFolder }).catch(() => {});
      throw err;
    }

    // 7. Save lessons and mark downloaded, in one database step
    try {
      await installPack(packId, version, relativeFolder(packId), manifest.modules);
    } catch (err) {
      await remove(liveFolder);
      if (hadLive) await FileSystem.moveAsync({ from: oldFolder, to: liveFolder }).catch(() => {});
      throw fail('save_failed', 'Could not save the pack on this phone.');
    }
    await remove(oldFolder);

    // 8. Tell the server. If offline, remember it for later.
    await confirmOrQueue(packId, version);

    onProgress({ stage: 'completed', fraction: 1 });
    return { pack_id: packId, version, local_path: relativeFolder(packId) };
  } finally {
    await remove(partPath);
    await remove(tmpFolder);
  }
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

async function confirmOrQueue(packId, version) {
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
