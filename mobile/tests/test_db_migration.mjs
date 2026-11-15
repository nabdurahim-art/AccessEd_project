import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
let n = 0; const ok = (m) => console.log('ok', ++n, m);

// --- phone that already has schema v1 with data ---
const file = '/tmp/v1phone.db'; try { fs.unlinkSync(file); } catch {}
const old = new DatabaseSync(file);
old.exec(`CREATE TABLE local_progress (progress_id TEXT PRIMARY KEY, pack_id INTEGER NOT NULL, module_key TEXT NOT NULL, percent_complete INTEGER NOT NULL, status TEXT NOT NULL, updated_at TEXT NOT NULL, synced INTEGER DEFAULT 0, reject_reason TEXT, UNIQUE(pack_id, module_key));
CREATE TABLE local_quiz_attempts (attempt_id TEXT PRIMARY KEY, pack_id INTEGER NOT NULL, module_key TEXT NOT NULL, score INTEGER NOT NULL, passed INTEGER NOT NULL, attempted_at TEXT NOT NULL, synced INTEGER DEFAULT 0, reject_reason TEXT);
CREATE TABLE downloaded_packs (pack_id INTEGER PRIMARY KEY, version INTEGER NOT NULL, downloaded_at TEXT NOT NULL);
INSERT INTO local_progress VALUES ('p1',1,'m1',50,'in_progress','2026-10-31T09:00:00Z',0,NULL);
PRAGMA user_version = 1;`);
old.close();
globalThis.__DBFILE__ = file;
const D = await import('../src/db/index.js');
await D.initDatabase();
const db = await D.getDB();
assert.equal((await db.getFirstAsync('PRAGMA user_version')).user_version, 2);
const tables = (await db.getAllAsync("SELECT name FROM sqlite_master WHERE type='table'")).map(t => t.name);
for (const t of ['courses', 'packs', 'modules', 'meta', 'local_progress']) assert.ok(tables.includes(t), t);
assert.equal((await db.getFirstAsync("SELECT percent_complete FROM local_progress WHERE progress_id='p1'")).percent_complete, 50);
ok('phone on v1 upgrades to v2, new tables exist, old progress kept');
await D.initDatabase(); assert.equal((await db.getFirstAsync('PRAGMA user_version')).user_version, 2);
ok('running init again changes nothing');

// --- catalogue ---
await D.saveCourses([{ course_id: 1, title: 'Everyday Maths', subject: 'Maths', language: 'en', description: 'x' }, { course_id: 2, title: 'Literacy' }]);
await D.saveCourses([{ course_id: 1, title: 'Everyday Maths 2', subject: 'Maths', language: 'en' }]);
const cs = await db.getAllAsync('SELECT * FROM courses ORDER BY course_id');
assert.equal(cs.length, 2); assert.equal(cs[0].title, 'Everyday Maths 2'); assert.equal(cs[0].description, null);
ok('courses upsert: no duplicates, title updated');

const P = (id, wk, v, kb = 2400) => ({ pack_id: id, week_number: wk, title: 'Week ' + wk, version: v, file_size_kb: kb, checksum: 'c' + id + v });
await D.saveCoursePacks(1, [P(10, 1, 1), P(11, 2, 1), P(12, 3, 1)]);
let ps = await D.getPacksForCourse(1);
assert.deepEqual(ps.map(p => p.state), ['not_downloaded', 'not_downloaded', 'not_downloaded']);
assert.deepEqual(ps.map(p => p.week_number), [1, 2, 3]); ok('new packs: sorted by week, state not_downloaded');

await db.runAsync("UPDATE packs SET downloaded_version=1, local_path='/p/10' WHERE pack_id=10");
await db.runAsync("UPDATE packs SET downloaded_version=1, local_path='/p/11' WHERE pack_id=11");
await D.saveCoursePacks(1, [P(10, 1, 1), P(11, 2, 2), P(12, 3, 1)]);
ps = await D.getPacksForCourse(1);
assert.deepEqual(ps.map(p => p.state), ['downloaded', 'update_available', 'not_downloaded']);
assert.equal(ps[0].local_path, '/p/10'); assert.equal(ps[1].downloaded_version, 1); assert.equal(ps[1].local_path, '/p/11');
assert.equal(ps[1].checksum, 'c112'); ok('refresh keeps download state, flags update_available, takes new checksum');

await D.saveCoursePacks(1, [P(10, 1, 1)]);
assert.equal((await D.getPacksForCourse(1)).length, 3); ok('a shorter server list does not delete local packs (documented behaviour)');

// --- robustness ---
await assert.rejects(D.saveCoursePacks(99, [P(50, 1, 1)]));
ok('PACKS BEFORE COURSE: saving packs for a course not saved yet throws (FOREIGN KEY enforced here)');
await D.saveCoursePacks(1, [P(60, 4, 1), {...P(61, 5, 1), file_size_kb: null, checksum: null}]);
const odd = await db.getFirstAsync('SELECT * FROM packs WHERE pack_id=61');
assert.equal(odd.file_size_kb, 0); assert.equal(odd.checksum, ''); assert.ok(await db.getFirstAsync('SELECT 1 FROM packs WHERE pack_id=60'));
ok('a pack with no size or checksum is saved (0 and empty) and does not block the others');


console.log('V2 CHECKS DONE');
