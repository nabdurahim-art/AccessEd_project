import http from 'node:http';

import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { zipSync, strToU8 } from 'fflate';
import { makeWeek1Zip } from './helpers/week1.mjs';

const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const good = makeWeek1Zip();
const packs = { 1: { buf: good, version: 5, sum: sha(good) } };
const hits = { confirm: [], download: 0 };
let serverMode = 'normal'; let confirmStatus = 200;

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const auth = req.headers.authorization;
  if (url.pathname.endsWith('/download')) {
    hits.download++;
    if (auth !== 'Bearer GOODTOKEN') { res.writeHead(401, { 'content-type': 'application/json' }); return res.end('{"error":"Invalid token."}'); }
    const id = url.pathname.split('/')[5]; const p = packs[id];
    if (!p) { res.writeHead(404, { 'content-type': 'application/json' }); return res.end('{"error":"Content pack not found."}'); }
    if (serverMode === 'crash') { res.writeHead(500, { 'content-type': 'text/html' }); return res.end('<html>boom</html>'); }
    const body = serverMode === 'corrupt' ? Buffer.concat([p.buf.subarray(0, 40), Buffer.from('XX'), p.buf.subarray(42)]) : p.buf;
    res.writeHead(200, { 'content-type': 'application/zip', 'content-length': body.length, 'X-Checksum-SHA256': p.sum, 'X-Pack-Version': String(p.version) });
    return res.end(body);
  }
  if (url.pathname.endsWith('/confirm')) {
    let d = ''; req.on('data', (c) => (d += c)); req.on('end', () => {
      hits.confirm.push({ path: url.pathname, body: JSON.parse(d), auth });
      res.writeHead(confirmStatus, { 'content-type': 'application/json' }); res.end(confirmStatus === 200 ? '{"message":"Download recorded."}' : '{"error":"nope"}');
    }); return;
  }
  res.writeHead(404); res.end();
});
await new Promise((r) => server.listen(0, r));
process.env.EXPO_PUBLIC_API_URL = `http://127.0.0.1:${server.address().port}/api/v1`.replace('/api/v1', '/api/v1');
// the mock matches paths by position: /api/v1/content/packs/<id>/download -> index 5 after split ['', 'api','v1','content','packs','<id>']
const FS = await import('expo-file-system/legacy');
const S = await import('../src/session.js');
const D = await import('../src/db/index.js');
const L = await import('../src/downloader.js');
let n = 0; const ok = (m) => console.log('ok', ++n, m);
const reason = async (p) => { try { await p; return null; } catch (e) { return e; } };
const filesOf = (prefix) => [...FS.fs.keys()].filter((k) => k.includes(prefix));

await D.initDatabase();
await D.saveCourses([{ course_id: 1, title: 'Everyday Maths', language: 'en' }]);
await D.saveCoursePacks(1, [{ pack_id: 1, week_number: 1, title: 'Week 1', version: 4, file_size_kb: 2, checksum: 'old' }]);
// fix mock path index: /api/v1/content/packs/1/download => split gives ['', 'api','v1','content','packs','1','download']
const origCreate = http.createServer;
await S.saveToken('GOODTOKEN');
const pack = () => D.getPack(1);

// 1. happy path
const stages = [];
const res = await L.downloadPack(await pack(), (p) => stages.push(p.stage));
const p1 = await pack();
assert.equal(p1.state, 'downloaded'); assert.equal(p1.downloaded_version, 5); assert.equal(p1.local_path, 'packs/1/');
ok('download works: state downloaded, version 5 taken from X-Pack-Version (list said 4), local_path is relative');
assert.deepEqual([...new Set(stages)], ['downloading', 'verifying', 'unpacking', 'installing', 'completed']); ok('progress stages in order: ' + [...new Set(stages)].join(' > '));
const mods = await D.getModules(1);
assert.deepEqual(mods.map((m) => m.module_key), ['m1', 'm2']); assert.equal(mods[0].quiz.pass_mark, 70); assert.equal(mods[0].quiz.questions[0].correct_index, 0); ok('lessons and quiz saved from the manifest');
assert.equal(FS.fs.get(FS.documentDirectory + 'packs/1/m1/lesson.md').toString(), '# The alphabet\n\nA, B, C are letters.\n');
assert.ok(FS.fs.has(FS.documentDirectory + 'packs/1/manifest.json')); ok('lesson files written byte-for-byte; packFileUri: ' + L.packFileUri(p1, 'm1/lesson.md').replace(FS.documentDirectory, '<docs>/'));
assert.deepEqual(filesOf('.part').concat(filesOf('_tmp'), filesOf('_old')), []); ok('no .part / _tmp / _old left behind');
assert.equal(hits.confirm.length, 1); assert.deepEqual(hits.confirm[0].body, { device_id: hits.confirm[0].body.device_id, platform: 'android', version: 5 });
assert.match(hits.confirm[0].body.device_id, /^[0-9a-f-]{36}$/); assert.equal(hits.confirm[0].auth, 'Bearer GOODTOKEN'); ok('confirm sent with device UUID, platform and version 5');
assert.equal(await D.getMeta('pending_confirms'), null); ok('nothing queued when confirm succeeds');

// 2. same pack twice at once -> one download
hits.download = 0;
const [a, b] = await Promise.all([L.downloadPack(await pack()), L.downloadPack(await pack())]);
assert.equal(hits.download, 1); ok('two taps at once share one download');

// 3. progress progress is kept while republishing
await D.saveLocalProgress({ pack_id: 1, module_key: 'm1', percent_complete: 100, status: 'completed' });

// 4. corrupted download
serverMode = 'corrupt';
let e = await reason(L.downloadPack(await pack()));
assert.equal(e.code, 'checksum_mismatch'); assert.deepEqual(filesOf('.part').concat(filesOf('_tmp')), []);
assert.equal((await pack()).downloaded_version, 5); assert.ok(FS.fs.has(FS.documentDirectory + 'packs/1/m1/lesson.md')); ok('damaged file: checksum_mismatch, old version still installed and usable, no leftovers');

// 5. server crash page
serverMode = 'crash';
e = await reason(L.downloadPack(await pack()));
assert.equal(e.code, 'server'); assert.equal(e.status, 500); assert.match(e.message, /Server error \(500\)/); assert.ok(!e.message.includes('boom')); ok('HTML 500 page: short message, page text not shown, leftovers removed');
serverMode = 'normal';

// 6. unauthorised
await S.saveToken('BADTOKEN');
e = await reason(L.downloadPack(await pack()));
assert.equal(e.code, 'unauthorized'); assert.equal(await S.getToken(), null); ok('401: unauthorized error and the saved token is cleared');
await S.saveToken('GOODTOKEN');

// 7. not found
e = await reason(L.downloadPack({ pack_id: 99, version: 1 }));
assert.equal(e.code, 'not_found'); ok('missing pack on the server: not_found');

// 8. offline
const realFetch = globalThis.fetch; globalThis.fetch = async () => { throw new TypeError('Network request failed'); };
e = await reason(L.downloadPack(await pack())); globalThis.fetch = realFetch;
assert.equal(e.code, 'offline'); assert.equal(e.offline, true); ok('no connection: offline error');

// 9. malicious / broken zips, served through the same mock
const serve = async (zipBytes, expectCode, label) => {
  packs[7] = { buf: Buffer.from(zipBytes), version: 1, sum: sha(Buffer.from(zipBytes)) };
  await D.saveCoursePacks(1, [{ pack_id: 7, week_number: 7, title: 'W7', version: 1, file_size_kb: 1, checksum: 'x' }]);
  const err = await reason(L.downloadPack(await D.getPack(7)));
  assert.equal(err && err.code, expectCode, label);
  if (expectCode === null) { assert.equal((await D.getPack(7)).state, 'downloaded', label); return ok(label); }
  assert.equal((await D.getPack(7)).state, 'not_downloaded', label);
  assert.deepEqual(filesOf('packs/7').filter((k) => !k.endsWith('/packs/7')), [], label + ' (files)');
  assert.ok(![...FS.fs.keys()].some((k) => k.includes('evil')), label + ' (no escape)');
  ok(label);
};
const man = (mods) => strToU8(JSON.stringify({ manifest_version: 1, modules: mods }));
await serve(zipSync({ 'manifest.json': man([{ key: 'm1', body_file: 'm1/l.md' }]), 'm1/l.md': strToU8('x'), '../evil.txt': strToU8('x') }), 'bad_pack', 'zip-slip "../evil.txt" rejects the WHOLE pack, writes nothing');
await serve(zipSync({ 'manifest.json': man([{ key: 'm1', body_file: 'm1/l.md' }]), 'm1/l.md': strToU8('x'), '/abs/evil.txt': strToU8('x') }), 'bad_pack', 'absolute path rejected');
await serve(zipSync({ 'manifest.json': man([{ key: 'm1', body_file: 'm1/l.md' }]), 'm1/l.md': strToU8('x'), 'a\\evil.txt': strToU8('x') }), 'bad_pack', 'backslash path rejected');
await serve(zipSync({ 'm1/l.md': strToU8('x') }), 'bad_pack', 'zip with no manifest.json rejected');
await serve(zipSync({ 'manifest.json': strToU8('{not json') }), 'bad_pack', 'manifest that is not JSON rejected');
await serve(zipSync({ 'manifest.json': man([]) }), 'bad_pack', 'manifest with no modules rejected');
await serve(zipSync({ 'manifest.json': man([{ key: 'm1', body_file: 'm1/missing.md' }]) }), 'bad_pack', 'lesson file listed but missing from the zip rejected');
await serve(Buffer.from('this is not a zip at all'), 'bad_pack', 'file that is not a zip rejected');
const big = {}; for (let i = 0; i < 501; i++) big['f' + i + '.txt'] = strToU8('x'); big['manifest.json'] = man([{ key: 'm1', body_file: 'f1.txt' }]);
await serve(zipSync(big), 'bad_pack', '501 files rejected (limit 500)');
const huge = zipSync({ 'manifest.json': man([{ key: 'm1', body_file: 'big.bin' }]), 'big.bin': new Uint8Array(101 * 1024 * 1024) });
await serve(huge, 'bad_pack', 'zip that unpacks to over 100 MB rejected (limit checked while unpacking)');
await serve(zipSync({ 'manifest.json': man([{ key: 'm1', body_file: 'lesson..v2.md' }]), 'lesson..v2.md': strToU8('ok') }), null, 'a name containing ".." inside (lesson..v2.md) is accepted');

// 10. disk full while writing: old version must survive, DB unchanged
FS.hooks.failWriteMatching = '1_tmp/m2';
e = await reason(L.downloadPack(await pack()));
FS.hooks.failWriteMatching = null;
assert.ok(e); assert.equal((await pack()).downloaded_version, 5); assert.ok(FS.fs.has(FS.documentDirectory + 'packs/1/m2/lesson.md')); assert.deepEqual(filesOf('_tmp'), []);
ok('disk full while unpacking: old version still installed, temp folder removed');

// 11. confirm offline -> queued, then retried
const pending = async () => (await D.getMeta('pending_confirms'));
globalThis.fetch = async (u, o) => { if (String(u).includes('/confirm')) throw new TypeError('Network request failed'); return realFetch(u, o); };
packs[1].version = 6; // republished
await L.downloadPack(await pack());
globalThis.fetch = realFetch;
assert.equal((await pack()).downloaded_version, 6);
assert.deepEqual(await pending(), [{ pack_id: 1, version: 6 }]); ok('offline at the end: download still succeeds, confirmation queued as a real array');
hits.confirm.length = 0; await L.retryPendingConfirms();
assert.equal(hits.confirm.length, 1); assert.deepEqual(await pending(), []); ok('retryPendingConfirms sends it and empties the queue');
await D.setMeta('pending_confirms', [{ pack_id: 1, version: 6 }]); confirmStatus = 400; await L.retryPendingConfirms();
assert.deepEqual(await pending(), []); ok('a 400 answer drops the queued confirmation (permanent)');
await D.setMeta('pending_confirms', [{ pack_id: 1, version: 6 }]); globalThis.fetch = async () => { throw new TypeError('x'); }; await L.retryPendingConfirms(); globalThis.fetch = realFetch;
assert.equal((await pending()).length, 1); ok('still offline: confirmation stays queued');
confirmStatus = 200;

// 12. progress survives a republish
assert.equal((await D.getLocalProgress(1, 'm1')).status, 'completed'); ok('learner progress untouched by re-downloads');

// 13. start-up housekeeping
const R = FS.documentDirectory + 'packs/';
FS.fs.set(R + '1.zip.part', Buffer.from('half')); await FS.makeDirectoryAsync(R + '1_tmp/'); FS.fs.set(R + '1_tmp/x', Buffer.from('x'));
await L.cleanupLeftovers();
assert.deepEqual(filesOf('.part').concat(filesOf('_tmp')), []); ok('cleanupLeftovers removes .part and _tmp');
// crash in the middle of a swap: live missing, _old present
await FS.moveAsync({ from: R + '1/', to: R + '1_old/' });
await L.cleanupLeftovers();
assert.ok(FS.fs.has(R + '1/m1/lesson.md')); assert.deepEqual(filesOf('1_old'), []); ok('crash mid-swap: cleanupLeftovers puts the old version back');
// _old with live present -> removed
await FS.makeDirectoryAsync(R + '1_old/'); FS.fs.set(R + '1_old/z', Buffer.from('z'));
await L.cleanupLeftovers(); assert.deepEqual(filesOf('1_old'), []); ok('stale _old removed when the live folder exists');

// 14. verifyInstalledPacks
await L.verifyInstalledPacks(); assert.equal((await pack()).state, 'downloaded'); ok('verifyInstalledPacks keeps a pack whose files exist');
await FS.deleteAsync(R + '1/', { idempotent: true });
await L.verifyInstalledPacks();
const gone = await pack(); assert.equal(gone.state, 'not_downloaded'); assert.equal(gone.local_path, null); ok('files cleared (storage wiped): pack goes back to "Download"');

// 15. installPack is all-or-nothing
await D.saveCoursePacks(1, [{ pack_id: 1, week_number: 1, title: 'Week 1', version: 6, file_size_kb: 2, checksum: 'z' }]);
await assert.rejects(D.installPack(1, 6, 'packs/1/', [{ key: 'ok', title: 't' }, { title: 'no key' }]));
const after = await pack(); assert.equal(after.state, 'not_downloaded'); assert.deepEqual((await D.getModules(1)).map((m) => m.module_key), ['m1', 'm2']);
ok('installPack: a bad module rolls back everything (lessons keep their old values, pack not marked downloaded)');

console.log('ALL DOWNLOADER CHECKS PASSED'); server.close();
