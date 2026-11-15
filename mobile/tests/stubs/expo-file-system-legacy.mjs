// In-memory phone file system + real HTTP download, same behaviour as the Expo functions used.
export const documentDirectory = 'file:///data/user/0/app/files/';
export const EncodingType = { Base64: 'base64', UTF8: 'utf8' };
export const fs = new Map();      // path -> Buffer (files)
export const dirs = new Set();    // directory paths (no trailing slash)
export const hooks = { failWriteMatching: null };
const norm = (p) => p.replace(/\/+$/, '');
const under = (p) => [...fs.keys(), ...dirs].filter((k) => k === norm(p) || k.startsWith(norm(p) + '/'));
export async function makeDirectoryAsync(p, o = {}) { const n = norm(p); if (!o.intermediates && !dirs.has(norm(n.substring(0, n.lastIndexOf('/'))))) { /* real expo needs parent */ } let cur = ''; for (const part of n.replace('file://', '').split('/').filter(Boolean)) { cur += '/' + part; dirs.add('file://' + cur); } }
export async function getInfoAsync(p) { const n = norm(p); if (fs.has(n)) return { exists: true, isDirectory: false, size: fs.get(n).length, uri: p }; if (dirs.has(n)) return { exists: true, isDirectory: true, uri: p }; return { exists: false, isDirectory: false, uri: p }; }
export async function deleteAsync(p, o = {}) { const all = under(p); if (!all.length && !o.idempotent) throw new Error('nothing to delete'); all.forEach((k) => { fs.delete(k); dirs.delete(k); }); }
export async function moveAsync({ from, to }) { const f = norm(from), t = norm(to); const all = under(f); if (!all.length) throw new Error('move: missing source'); if (under(t).length) throw new Error('move: destination exists'); for (const k of all) { const nk = t + k.slice(f.length); if (fs.has(k)) { fs.set(nk, fs.get(k)); fs.delete(k); } else { dirs.delete(k); dirs.add(nk); } } }
export async function readDirectoryAsync(p) { const n = norm(p) + '/'; const names = new Set(); for (const k of [...fs.keys(), ...dirs]) if (k.startsWith(n)) names.add(k.slice(n.length).split('/')[0]); return [...names]; }
export async function readAsStringAsync(p, o = {}) { const b = fs.get(norm(p)); if (!b) throw new Error('no such file ' + p); return o.encoding === 'base64' ? b.toString('base64') : b.toString('utf8'); }
export async function writeAsStringAsync(p, c, o = {}) { if (hooks.failWriteMatching && p.includes(hooks.failWriteMatching)) throw new Error('disk full'); if (!dirs.has(norm(p.substring(0, p.lastIndexOf('/'))))) throw new Error('parent folder missing: ' + p); fs.set(norm(p), o.encoding === 'base64' ? Buffer.from(c, 'base64') : Buffer.from(c, 'utf8')); }
export function createDownloadResumable(url, dest, opts = {}, cb) {
  return { async downloadAsync() {
    const res = await fetch(url, { headers: opts.headers || {} });     // network failure throws, like Expo
    const buf = Buffer.from(await res.arrayBuffer());
    const total = Number(res.headers.get('content-length') ?? -1);
    if (cb) { cb({ totalBytesWritten: Math.floor(buf.length / 2), totalBytesExpectedToWrite: total }); cb({ totalBytesWritten: buf.length, totalBytesExpectedToWrite: total }); }
    fs.set(norm(dest), buf);                                           // Expo also writes error bodies to the file
    const headers = {}; res.headers.forEach((v, k) => { headers[k] = v; });
    return { uri: dest, status: res.status, headers, mimeType: null };
  } };
}
