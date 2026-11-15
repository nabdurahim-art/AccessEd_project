import assert from 'node:assert/strict';
import * as D from '../src/db/index.js';
let n = 0; const ok = (m) => console.log('ok', ++n, m);
await Promise.all([D.initDatabase(), D.initDatabase(), D.initDatabase()]);
const db = await D.getDB();
assert.equal((await db.getFirstAsync('PRAGMA foreign_keys')).foreign_keys, 1); ok('foreign keys on; three simultaneous init calls fine');

// meta round trips
await D.setMeta('points', 140); assert.strictEqual(await D.getMeta('points'), 140);
await D.setMeta('points', 150); assert.strictEqual(await D.getMeta('points'), 150);
await D.setMeta('name', 'Aline'); assert.strictEqual(await D.getMeta('name'), 'Aline');
await D.setMeta('user', { id: 3, streak: 3 }); assert.deepEqual(await D.getMeta('user'), { id: 3, streak: 3 });
await D.setMeta('flag', false); assert.strictEqual(await D.getMeta('flag'), false);
assert.strictEqual(await D.getMeta('missing'), null); ok('meta: numbers, text, objects and false round-trip with their own type');

// progress cleaning
await D.saveLocalProgress({ pack_id: 1, module_key: 'a', percent_complete: 250, status: 'weird' });
let r = await D.getLocalProgress(1, 'a'); assert.equal(r.percent_complete, 100); assert.equal(r.status, 'in_progress');
await D.saveLocalProgress({ pack_id: 1, module_key: 'b', percent_complete: -5, status: 'in_progress' });
assert.equal((await D.getLocalProgress(1, 'b')).percent_complete, 0);
await D.saveLocalProgress({ pack_id: 1, module_key: 'c', percent_complete: 30, status: 'completed' });
assert.equal((await D.getLocalProgress(1, 'c')).percent_complete, 100);
await D.saveLocalProgress({ pack_id: 1, module_key: 'd', percent_complete: 'abc', status: 'in_progress' });
assert.equal((await D.getLocalProgress(1, 'd')).percent_complete, 0); ok('percent clamped to 0..100; completed forces 100; junk -> 0; odd status -> in_progress');
await D.saveLocalQuizAttempt({ pack_id: 1, module_key: 'a', score: 180, passed: true });
assert.equal((await db.getFirstAsync('SELECT score FROM local_quiz_attempts')).score, 100); ok('quiz score clamped to 100');

// counts and ordering
assert.equal(await D.getUnsyncedCount(), 5); ok('unsynced count = 4 progress + 1 attempt');
await db.runAsync("UPDATE local_progress SET updated_at='2026-01-01T00:00:00.000Z' WHERE module_key='d'");
const u = await D.getUnsyncedData(); assert.equal(u.progress_items[0].module_key, 'd'); ok('oldest record is sent first');
const toSend = u.progress_items;
await D.markAsSynced(toSend.map(x => ({ progress_id: x.progress_id, updated_at: x.updated_at })), u.quiz_attempts);
assert.equal(await D.getUnsyncedCount(), 0); ok('after marking everything synced, count is 0');

// catalogue + download flow
await D.saveCourses([{ course_id: 1, title: 'Everyday Maths', language: 'en' }, { course_id: 2, title: 'Literacy', language: 'rw' }]);
assert.equal((await D.getCourses()).length, 2); assert.equal((await D.getCourses('rw'))[0].title, 'Literacy'); ok('courses list and language filter');
await D.saveCoursePacks(1, [{ pack_id: 7, week_number: 1, title: 'Week 1', version: 3, file_size_kb: 2400, checksum: 'abc' }]);
assert.equal((await D.getPack(7)).state, 'not_downloaded'); assert.equal(await D.getPack(999), null);
const mods = [
  { key: 'm1', title: 'The alphabet', order: 1, duration_min: 10, body_file: 'm1/lesson.md', audio: 'm1/a.mp3', quiz: { pass_mark: 80, questions: [{ key: 'q1', prompt: 'x?', options: ['a', 'b'], correct_index: 1 }] } },
  { key: 'm2', title: 'Short words', order: 2, duration_min: 15, body_file: 'm2/lesson.md' },
];
await D.saveModules(7, mods);
await D.markPackDownloaded(7, 3, '/data/packs/7');
let p = await D.getPack(7); assert.equal(p.state, 'downloaded'); assert.equal(p.local_path, '/data/packs/7'); ok('markPackDownloaded flips state to downloaded');
const got = await D.getModules(7);
assert.deepEqual(got.map(m => m.module_key), ['m1', 'm2']);
assert.equal(got[0].quiz.pass_mark, 80); assert.equal(got[0].quiz.questions[0].correct_index, 1);
assert.equal(got[1].quiz, null); assert.equal('quiz_json' in got[0], false); assert.equal(got[0].audio, 'm1/a.mp3'); ok('modules saved in order; quiz comes back as an object; quiz-less lesson gives null');
assert.equal((await D.getModule(7, 'm2')).title, 'Short words'); assert.equal(await D.getModule(7, 'zz'), null); ok('getModule works');

// republish: manifest replaces modules, progress survives
await D.saveLocalProgress({ pack_id: 7, module_key: 'm1', percent_complete: 100, status: 'completed' });
await D.saveModules(7, [mods[0], { key: 'm3', title: 'New', body_file: 'm3/l.md' }]);
assert.deepEqual((await D.getModules(7)).map(m => m.module_key), ['m1', 'm3']); assert.equal((await D.getModules(7))[1].sort_order, 2);
assert.equal((await D.getLocalProgress(7, 'm1')).status, 'completed'); ok('new manifest replaces lessons, missing order falls back to position, progress untouched');
await D.saveCoursePacks(1, [{ pack_id: 7, week_number: 1, title: 'Week 1', version: 4, file_size_kb: 2500, checksum: 'def' }]);
assert.equal((await D.getPack(7)).state, 'update_available'); ok('newer server version -> update_available');
assert.equal((await D.getProgressForPack(7)).length, 1); ok('getProgressForPack');

// FK safety
await assert.rejects(D.saveModules(555, [{ key: 'x', title: 'x' }])); ok('modules for an unknown pack are refused');
await assert.rejects(D.saveCoursePacks(404, [{ pack_id: 70, week_number: 1, title: 'w', version: 1 }])); ok('packs for an unsaved course are refused (save courses first)');
const left = await db.getAllAsync('SELECT * FROM modules WHERE pack_id=555'); assert.equal(left.length, 0); ok('failed modules save leaves nothing behind');
console.log('FINAL DB CHECKS PASSED');
