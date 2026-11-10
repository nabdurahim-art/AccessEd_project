// Catalog, pack download (with checksum), and reading downloaded packs.
import * as api from './api.js';
import * as db from './db.js';

export function uuid() {
  const b = crypto.getRandomValues(new Uint8Array(16)); // works on plain http too
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0'));
  return `${h.slice(0, 4).join('')}-${h.slice(4, 6).join('')}-${h.slice(6, 8).join('')}-${h.slice(8, 10).join('')}-${h.slice(10).join('')}`;
}

export async function deviceId() {
  let row = await db.get('meta', 'device_id');
  if (!row) { row = { key: 'device_id', value: uuid() }; await db.put('meta', row); }
  return row.value;
}

// crypto.subtle only exists on HTTPS or localhost, so fall back to the bundled library.
async function sha256hex(buffer) {
  if (globalThis.crypto && crypto.subtle) {
    const hash = await crypto.subtle.digest('SHA-256', buffer);
    return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  return window.sha256(buffer);
}

/* ---- catalog: network first, saved copy when offline ---- */
async function cached(key, fetcher, pick) {
  try {
    const data = await fetcher();
    const value = pick(data);
    await db.put('meta', { key, value });
    return { value, offline: false };
  } catch (e) {
    if (e.status !== 0) throw e;
    const row = await db.get('meta', key);
    return { value: row ? row.value : [], offline: true };
  }
}
export const loadCourses = () => cached('courses', api.getCourses, (d) => d.courses);
export const loadPacks = (courseId) => cached(`packs:${courseId}`, () => api.getPacks(courseId), (d) => d.packs);

export const localPack = (packId) => db.get('packs', Number(packId));
export const localPacks = () => db.getAll('packs');

/* ---- download ---- */
export async function downloadPack(pack, courseId, onProgress = () => {}) {
  const res = await api.fetchPack(pack.pack_id);
  const total = Number(res.headers.get('Content-Length')) || pack.file_size_kb * 1024;
  const expected = String(res.headers.get('X-Checksum-SHA256') || pack.checksum || '').toLowerCase();
  const version = Number(res.headers.get('X-Pack-Version')) || pack.version;

  let bytes;
  if (res.body && res.body.getReader) {
    const reader = res.body.getReader();
    const chunks = [];
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      got += value.length;
      onProgress(Math.min(got / total, 1), got, total);
    }
    bytes = new Uint8Array(got);
    let at = 0;
    for (const c of chunks) { bytes.set(c, at); at += c.length; }
  } else {
    bytes = new Uint8Array(await res.arrayBuffer());
  }
  onProgress(1, bytes.length, bytes.length);

  // Never keep a pack whose checksum does not match: the file is damaged.
  const actual = await sha256hex(bytes.buffer);
  if (expected && actual !== expected) throw new Error('CHECKSUM');

  let zip;
  try { zip = await JSZip.loadAsync(bytes); } catch { throw new Error('BAD_PACK'); }
  const manifestFile = zip.file('manifest.json');
  if (!manifestFile) throw new Error('BAD_PACK');
  let manifest;
  try { manifest = JSON.parse(await manifestFile.async('string')); } catch { throw new Error('BAD_PACK'); }

  const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir && n !== 'manifest.json'
    && !n.includes('..') && !n.startsWith('/') && !n.includes('\\'));
  if (names.length > 500) throw new Error('BAD_PACK');

  const files = [];
  for (const path of names) {
    files.push({ key: `${pack.pack_id}/${path}`, pack_id: pack.pack_id, path, data: await zip.file(path).async('arraybuffer') });
  }
  await db.removeFilesOfPack(pack.pack_id);
  await db.putMany('files', files);
  await db.put('packs', {
    pack_id: pack.pack_id, course_id: Number(courseId), title: pack.title, week_number: pack.week_number,
    version, checksum: expected, manifest, downloaded_at: new Date().toISOString(),
  });

  // Tell the server only after the checksum matched. Not fatal if it fails.
  try {
    await api.confirmDownload(pack.pack_id, { device_id: await deviceId(), platform: 'web', version });
  } catch {}
}

/* ---- reading a downloaded pack ---- */
const MIME = { mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav', webp: 'image/webp', png: 'image/png',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', svg: 'image/svg+xml', gif: 'image/gif' };

export async function fileText(packId, path) {
  const f = await db.get('files', `${packId}/${path}`);
  return f ? new TextDecoder().decode(f.data) : null;
}
export async function fileUrl(packId, path) {
  const f = await db.get('files', `${packId}/${path}`);
  if (!f) return null;
  const type = MIME[path.split('.').pop().toLowerCase()] || 'application/octet-stream';
  return URL.createObjectURL(new Blob([f.data], { type }));
}
