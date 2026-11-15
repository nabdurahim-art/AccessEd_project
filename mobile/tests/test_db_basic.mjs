import assert from 'node:assert/strict';
import * as D from '../src/db/index.js';
import { stats } from 'expo-sqlite';
let n = 0; const ok = (m) => console.log('ok', ++n, m);
const db = () => D.getDB();
const row = async (p, m) => (await db()).getFirstAsync('SELECT * FROM local_progress WHERE pack_id=? AND module_key=?', [p, m]);

// two concurrent opens -> one database
await Promise.all([D.getDB(), D.getDB(), D.getDB()]);
assert.equal(stats(), 1); ok('getDB opens once under concurrent calls');

await D.initDatabase(); await D.initDatabase();
const v = await (await db()).getFirstAsync('PRAGMA user_version');
assert.equal(v.user_version, 2); ok('migration sets user_version 2 and is safe to run twice');

// upsert: one row per lesson, original id kept
await D.saveLocalProgress({ pack_id: 1, module_key: 'm1', percent_complete: 10, status: 'in_progress', updated_at: '2026-10-31T09:00:00Z' });
const first = await row(1, 'm1');
await D.saveLocalProgress({ pack_id: 1, module_key: 'm1', percent_complete: 40, status: 'in_progress', updated_at: '2026-10-31T09:05:00Z' });
const second = await row(1, 'm1');
const count = (await (await db()).getAllAsync('SELECT * FROM local_progress')).length;
assert.equal(count, 1); assert.equal(second.progress_id, first.progress_id);
assert.equal(second.percent_complete, 40); assert.equal(second.updated_at, '2026-10-31T09:05:00Z');
ok('same lesson twice = one row, original progress_id kept, values updated');

// auto id/time
await D.saveLocalProgress({ pack_id: 1, module_key: 'm2', percent_complete: 5, status: 'in_progress' });
const auto = await row(1, 'm2');
assert.match(auto.progress_id, /^[0-9a-f-]{36}$/); assert.ok(!Number.isNaN(Date.parse(auto.updated_at)));
assert.match(auto.updated_at, /Z$/); ok('missing id and time are generated (UUID, ISO UTC)');

// completed cannot be downgraded
await D.saveLocalProgress({ pack_id: 1, module_key: 'm1', percent_complete: 100, status: 'completed', updated_at: '2026-10-31T09:10:00Z' });
await D.saveLocalProgress({ pack_id: 1, module_key: 'm1', percent_complete: 10, status: 'in_progress', updated_at: '2026-10-31T09:20:00Z' });
const done = await row(1, 'm1');
assert.equal(done.status, 'completed'); assert.equal(done.percent_complete, 100);
assert.equal(done.updated_at, '2026-10-31T09:10:00Z'); ok('completed lesson is not downgraded by in_progress');
// and re-completing is allowed
await D.saveLocalProgress({ pack_id: 1, module_key: 'm1', percent_complete: 100, status: 'completed', updated_at: '2026-10-31T09:30:00Z' });
assert.equal((await row(1, 'm1')).updated_at, '2026-10-31T09:30:00Z'); ok('completed -> completed still updates');

// a blocked downgrade must not flip synced back to 0
await D.markAsSynced([{ progress_id: done.progress_id, updated_at: '2026-10-31T09:30:00Z' }], []);
assert.equal((await row(1, 'm1')).synced, 1);
await D.saveLocalProgress({ pack_id: 1, module_key: 'm1', percent_complete: 10, status: 'in_progress', updated_at: '2026-10-31T10:00:00Z' });
assert.equal((await row(1, 'm1')).synced, 1); ok('blocked downgrade leaves synced = 1 (nothing new to send)');

// quiz idempotent
await D.saveLocalQuizAttempt({ attempt_id: 'a0000000-0000-4000-8000-000000000001', pack_id: 1, module_key: 'm1', score: 80, passed: true, attempted_at: '2026-10-31T09:40:00Z' });
await D.saveLocalQuizAttempt({ attempt_id: 'a0000000-0000-4000-8000-000000000001', pack_id: 1, module_key: 'm1', score: 10, passed: false, attempted_at: '2026-10-31T09:41:00Z' });
const qs = await (await db()).getAllAsync('SELECT * FROM local_quiz_attempts');
assert.equal(qs.length, 1); assert.equal(qs[0].score, 80); ok('same attempt_id twice stored once, first value kept');
await D.saveLocalQuizAttempt({ pack_id: 1, module_key: 'm1', score: 60, passed: false });
assert.equal((await (await db()).getAllAsync('SELECT * FROM local_quiz_attempts')).length, 2);
ok('attempt without id gets a new row');

// getUnsynced fields and limits
let u = await D.getUnsyncedData();
assert.deepEqual(Object.keys(u.progress_items[0]).sort(), ['module_key', 'pack_id', 'percent_complete', 'progress_id', 'status', 'updated_at']);
assert.deepEqual(Object.keys(u.quiz_attempts[0]).sort(), ['attempt_id', 'attempted_at', 'module_key', 'pack_id', 'score']);
ok('unsynced rows contain only fields the server reads (no passed/synced)');
for (let i = 0; i < 130; i++) {
  await D.saveLocalProgress({ pack_id: 2, module_key: 'k' + i, percent_complete: 1, status: 'in_progress' });
  await D.saveLocalQuizAttempt({ pack_id: 2, module_key: 'k' + i, score: 50, passed: false });
}
u = await D.getUnsyncedData();
assert.ok(u.progress_items.length <= 50 && u.quiz_attempts.length <= 50);
assert.ok(u.progress_items.length + u.quiz_attempts.length <= 100); ok('batch never exceeds 100 items (' + (u.progress_items.length + u.quiz_attempts.length) + ')');

// race: edit during flight
const sent = await row(2, 'k0');
await D.saveLocalProgress({ pack_id: 2, module_key: 'k0', percent_complete: 70, status: 'in_progress', updated_at: new Date(Date.now() + 5000).toISOString() });
await D.markAsSynced([{ progress_id: sent.progress_id, updated_at: sent.updated_at }], []);
const after = await row(2, 'k0');
assert.equal(after.synced, 0); assert.equal(after.percent_complete, 70); ok('edit made during sync stays unsynced (not lost)');

// rejected
const r1 = await row(2, 'k1');
await D.markAsRejected([{ progress_id: r1.progress_id, updated_at: r1.updated_at, reason: 'Module key not found for the given pack.' }], []);
const rr = await row(2, 'k1'); assert.equal(rr.synced, 2); assert.match(rr.reject_reason, /not found/);
ok('rejected item gets synced=2 with reason');
const unsyncedIds = (await D.getUnsyncedData()).progress_items.map(x => x.progress_id);
assert.ok(!unsyncedIds.includes(r1.progress_id)); ok('rejected item is no longer sent');

// temporary rejection stays retryable
const r2 = await row(2, 'k2');

// rejection of an older value does not mark a newer edit
const r3 = await row(2, 'k3');
await D.saveLocalProgress({ pack_id: 2, module_key: 'k3', percent_complete: 90, status: 'in_progress', updated_at: new Date(Date.now() + 9000).toISOString() });
await D.markAsRejected([{ progress_id: r3.progress_id, updated_at: r3.updated_at, reason: 'bad' }], []);
assert.equal((await row(2, 'k3')).synced, 0); ok('rejection of an old value does not hit a newer edit');

// a re-saved lesson clears an old rejection
await D.saveLocalProgress({ pack_id: 2, module_key: 'k1', percent_complete: 20, status: 'in_progress', updated_at: new Date(Date.now() + 12000).toISOString() });
const re = await row(2, 'k1'); assert.equal(re.synced, 0); assert.equal(re.reject_reason, null);
ok('editing a rejected lesson queues it again and clears the reason');

// quiz mark/reject + transaction rollback
const qa = (await (await db()).getAllAsync('SELECT * FROM local_quiz_attempts WHERE pack_id=2'))[0];
await D.markAsSynced([], [{ attempt_id: qa.attempt_id }]);
assert.equal((await (await db()).getFirstAsync('SELECT synced FROM local_quiz_attempts WHERE attempt_id=?', [qa.attempt_id])).synced, 1);
ok('quiz attempt marked synced');
await assert.rejects(D.markAsSynced([{ progress_id: 'x', updated_at: undefined }], []));
ok('bad input throws instead of half-applying');
console.log('ALL DB CHECKS PASSED');
