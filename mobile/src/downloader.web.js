// Browser version of downloader.js (Expo picks this file on the web).
// Same steps as the phone: download, check the SHA-256, open the zip in
// memory, check the manifest, install. The difference is where the lesson
// files are kept: in IndexedDB, not in the phone's file system.
//
// Every version of a pack is stored under its own prefix:
//   <packId>/<version>/<file>            for example  7/2/m1/lesson.md
// The new version is written first, and the old one is removed only after
// the database says the new one is installed, so a crash never leaves a
// learner with no lessons.
import * as Crypto from 'expo-crypto';

import { API_URL } from './api';
import { getToken, clearToken } from './session';
import { installPack, getDownloadedPacks, resetPackDownload } from './db';
import { fail, toHex, unpackAndCheck, confirmOrQueue, retryPendingConfirms } from './packShared';

export { retryPendingConfirms };

const IDB_NAME = 'accessed_pack_files';
const STORE = 'files';
const LOCAL_PREFIX = 'idb:'; // what local_path starts with for a browser pack

const folderOf = (packId, version) => `${packId}/${version}/`;
const localPathOf = (packId, version) => `${LOCAL_PREFIX}${folderOf(packId, version)}`;
const keyPrefixOf = (localPath) => localPath.slice(LOCAL_PREFIX.length);

/* ------------------------------------------------------------------ *
 *  A very small IndexedDB helper
 * ------------------------------------------------------------------ */

let dbPromise = null;

function openFilesDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const open = indexedDB.open(IDB_NAME, 1);
      open.onupgradeneeded = () => open.result.createObjectStore(STORE);
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => {
        dbPromise = null;
        reject(open.error);
      };
    });
  }
  return dbPromise;
}

// Runs fn(store) in one transaction. The whole transaction succeeds or none
// of it is kept. fn may return a request; its result is returned.
async function inTransaction(mode, fn) {
  const db = await openFilesDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    let request;
    try {
      request = fn(tx.objectStore(STORE));
    } catch (err) {
      tx.abort();
      reject(err);
      return;
    }
    tx.oncomplete = () => resolve(request ? request.result : undefined);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Storage transaction aborted.'));
  });
}

const prefixRange = (prefix) => IDBKeyRange.bound(prefix, `${prefix}￿`);

const deleteFolder = (prefix) => inTransaction('readwrite', (store) => store.delete(prefixRange(prefix)));
const allKeys = () => inTransaction('readonly', (store) => store.getAllKeys());
const getFile = (key) => inTransaction('readonly', (store) => store.get(key));

/* ------------------------------------------------------------------ *
 *  Same exports as the phone version
 * ------------------------------------------------------------------ */

/** Only for display on the browser: where a pack file is kept. */
export function packFileUri(pack, relativeFile) {
  return `${pack.local_path}${relativeFile}`;
}

/** The text of a file inside a downloaded pack (a lesson, for example). */
export async function readPackText(pack, relativeFile) {
  const bytes = await getFile(`${keyPrefixOf(pack.local_path)}${relativeFile}`);
  if (!bytes) throw fail('missing_file', 'This lesson file is not on this device.');
  return new TextDecoder().decode(bytes);
}

/**
 * Removes files that no installed pack points to (a download that was cut
 * short). Call once at start-up, after initDatabase.
 */
export async function cleanupLeftovers() {
  try {
    const live = new Set((await getDownloadedPacks()).map((p) => p.local_path).filter(Boolean));
    const folders = new Set();
    for (const key of await allKeys()) {
      const [packId, version] = String(key).split('/');
      folders.add(folderOf(packId, version));
    }
    for (const folder of folders) {
      if (!live.has(`${LOCAL_PREFIX}${folder}`)) await deleteFolder(folder);
    }
  } catch (err) {
    console.error('Error cleaning up pack leftovers:', err);
  }
}

/**
 * Checks that every pack the database calls "downloaded" really has its
 * files (a learner may clear the site's data). A pack with no files goes
 * back to "Download".
 */
export async function verifyInstalledPacks() {
  for (const pack of await getDownloadedPacks()) {
    let exists = false;
    if (pack.local_path && pack.local_path.startsWith(LOCAL_PREFIX)) {
      try {
        exists = Boolean(await getFile(`${keyPrefixOf(pack.local_path)}manifest.json`));
      } catch (err) {
        exists = false;
      }
    }
    if (!exists) await resetPackDownload(pack.pack_id);
  }
}

/* ------------------------------------------------------------------ *
 *  Download
 * ------------------------------------------------------------------ */

const active = new Map();

/**
 * Downloads, checks, unpacks and installs a pack. Same contract as the phone
 * version: onProgress({ stage, fraction }) and errors with a .code of offline,
 * unauthorized, not_found, server, checksum_mismatch, bad_pack, save_failed.
 * One extra code only the browser can give: insecure_context.
 */
export function downloadPack(pack, onProgress = () => {}) {
  if (active.has(pack.pack_id)) return active.get(pack.pack_id);
  const job = runDownload(pack, onProgress).finally(() => active.delete(pack.pack_id));
  active.set(pack.pack_id, job);
  return job;
}

// Reads the response body, reporting progress when the size is known.
async function readBody(response, onProgress) {
  const total = parseInt(response.headers.get('content-length'), 10) || 0;
  if (!response.body || !response.body.getReader) {
    return new Uint8Array(await response.arrayBuffer());
  }
  const reader = response.body.getReader();
  const chunks = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    onProgress({ stage: 'downloading', fraction: total > 0 ? Math.min(received / total, 1) : -1 });
  }
  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

async function runDownload(pack, onProgress) {
  const packId = pack.pack_id;

  // 1. Download
  onProgress({ stage: 'downloading', fraction: 0 });
  const token = await getToken();
  const headers = token ? { Authorization: `Bearer ${token}` } : {};

  let response;
  try {
    response = await fetch(`${API_URL}/content/packs/${packId}/download`, { headers });
  } catch (err) {
    throw fail('offline', 'No connection. Try again when online.', { offline: true });
  }

  if (response.status === 401) {
    await clearToken();
    throw fail('unauthorized', 'Please log in again.', { status: 401 });
  }
  if (response.status === 404) throw fail('not_found', 'This pack is no longer available.', { status: 404 });
  if (response.status !== 200) {
    throw fail('server', `Server error (${response.status}). Try again later.`, { status: response.status });
  }

  // 2. The checksum and version that came with THIS file
  const serverChecksum = response.headers.get('x-checksum-sha256');
  if (!serverChecksum) throw fail('bad_pack', 'This pack could not be checked. Try again later.');
  const headerVersion = parseInt(response.headers.get('x-pack-version'), 10);
  const version = Number.isInteger(headerVersion) && headerVersion > 0 ? headerVersion : pack.version;

  let bytes;
  try {
    bytes = await readBody(response, onProgress);
  } catch (err) {
    throw fail('offline', 'The connection dropped. Try again when online.', { offline: true });
  }

  // 3. Verify SHA-256 before opening anything. Browsers only allow hashing on
  //    HTTPS pages (and localhost), so say so clearly if it is not available.
  onProgress({ stage: 'verifying', fraction: 1 });
  if (!(globalThis.crypto && globalThis.crypto.subtle)) {
    throw fail('insecure_context', 'Open this site over HTTPS to download lessons.');
  }
  const computed = toHex(await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes));
  if (computed !== serverChecksum.trim().toLowerCase()) {
    throw fail('checksum_mismatch', 'The download was damaged. Try again.');
  }

  // 4. Open the zip in memory and check it BEFORE writing anything
  onProgress({ stage: 'unpacking', fraction: 0 });
  const { files, names, manifest } = unpackAndCheck(bytes);

  // 5. Write the new version in one all-or-nothing step
  onProgress({ stage: 'installing', fraction: 0 });
  const folder = folderOf(packId, version);
  try {
    await inTransaction('readwrite', (store) => {
      store.delete(prefixRange(folder));
      for (const name of names) store.put(files[name], `${folder}${name}`);
    });
  } catch (err) {
    await deleteFolder(folder).catch(() => {});
    throw fail('save_failed', 'Could not save the pack on this device.');
  }

  // 6. Save lessons and mark downloaded, in one database step
  try {
    await installPack(packId, version, localPathOf(packId, version), manifest.modules);
  } catch (err) {
    await deleteFolder(folder).catch(() => {});
    throw fail('save_failed', 'Could not save the pack on this device.');
  }

  // 7. Only now remove older versions of this pack
  try {
    for (const key of await allKeys()) {
      const text = String(key);
      if (text.startsWith(`${packId}/`) && !text.startsWith(folder)) {
        const [, oldVersion] = text.split('/');
        await deleteFolder(folderOf(packId, oldVersion));
      }
    }
  } catch (err) {
    console.error('Could not remove the old pack version:', err);
  }

  // 8. Tell the server. If offline, remember it for later.
  await confirmOrQueue(packId, version);

  onProgress({ stage: 'completed', fraction: 1 });
  return { pack_id: packId, version, local_path: localPathOf(packId, version) };
}
