import * as FileSystem from 'expo-file-system/legacy';
import * as Crypto from 'expo-crypto';
import base64 from 'base64-js';

import { API_URL } from './api';
import { getToken, clearToken } from './session';
import { installPack, getDownloadedPacks, resetPackDownload } from './db';
import { fail, toHex, unpackAndCheck, confirmOrQueue, retryPendingConfirms } from './packShared';

// Same name on the phone and in the browser, so sync.js does not care which.
export { retryPendingConfirms };

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

/**
 * The text of a file inside a downloaded pack (a lesson, for example).
 * The browser version of this app has the same function, so screens can call
 * it without knowing where the files are kept.
 */
export async function readPackText(pack, relativeFile) {
  return FileSystem.readAsStringAsync(packFileUri(pack, relativeFile));
}

const remove = (path) => FileSystem.deleteAsync(path, { idempotent: true }).catch(() => {});

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
    const { files, names, manifest } = unpackAndCheck(bytes);

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
