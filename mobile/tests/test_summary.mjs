import http from 'node:http';
import assert from 'node:assert/strict';

// A fake server: answers GET /progress/summary and POST /sync.
let mode = 'ok', hits = [];
const SUMMARY = {
  points: 30, streak_days: 1,
  overall: { modules_completed: 1, modules_total: 2, percent: 50 },
  courses: [{ course_id: 1, title: 'Literacy Basics', modules_total: 2, modules_completed: 1, percent: 50 }],
  badges: [{ badge_id: 1, name: 'First Step', earned_at: '2026-11-06T16:21:14.969Z' }],
  next_lesson: { pack_id: 1, module_key: 'm2', title: 'Reading short words', status: 'not_started' },
};
const server = http.createServer((req, res) => {
  let d = '';
  req.on('data', (c) => (d += c));
  req.on('end', () => {
    hits.push({ method: req.method, url: req.url, auth: req.headers.authorization });
    const send = (c, j) => { res.writeHead(c, { 'content-type': 'application/json' }); res.end(JSON.stringify(j)); };
    if (mode === '401') return send(401, { error: 'Invalid token.' });
    if (mode === '500') return send(500, { error: 'Internal server error.' });
    if (req.url.endsWith('/progress/summary')) return send(200, SUMMARY);
    if (req.url.endsWith('/sync')) return send(200, { message: 'ok', progress_results: [], quiz_results: [], rewards: { points_earned: 0, new_badges: [] } });
    send(404, { error: 'Not found.' });
  });
});
await new Promise((r) => server.listen(0, r));
const port = server.address().port;
process.env.EXPO_PUBLIC_API_URL = `http://127.0.0.1:${port}/api/v1`;

const D = await import('../src/db/index.js');
const { saveToken, clearToken, getToken } = await import('../src/session.js');
const { refreshSummary, getSavedSummary, syncAndRefresh, describeSummary } = await import('../src/summary.js');
await D.initDatabase();

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const tokenFor = (id) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ user_id: id, role: 'learner' })}.sig`;
let n = 0; const ok = (m) => console.log('ok', ++n, m);

// 1. nobody logged in
await clearToken();
let r = await refreshSummary();
assert.equal(r.status, 'unauthorized'); assert.equal(r.summary, null); assert.equal(hits.length, 0);
assert.equal(await getSavedSummary(), null);
assert.match(describeSummary(r), /log in first/);
ok('not logged in: nothing asked from the server, nothing shown');

// 2. learner u1 logs in and refreshes
await saveToken(tokenFor('u1'));
r = await refreshSummary();
assert.equal(r.status, 'updated'); assert.equal(r.summary.points, 30);
assert.equal(hits.length, 1); assert.equal(hits[0].method, 'GET'); assert.match(hits[0].url, /\/api\/v1\/progress\/summary$/);
assert.equal(hits[0].auth, 'Bearer ' + tokenFor('u1'));
const saved = await getSavedSummary();
assert.equal(saved.summary.overall.percent, 50); assert.ok(saved.saved_at);
ok('fresh summary: asked with the login, saved on the device');

// 3. text for the screen
const text = describeSummary(r);
for (const part of ['just updated', 'Points: 30', 'Streak: 1 day', '1 of 2 lessons (50%)', 'Literacy Basics: 1/2 (50%)', 'First Step', 'Reading short words (m2, pack 1)']) {
  assert.ok(text.includes(part), 'missing in text: ' + part);
}
ok('the summary reads as plain text: points, streak, lessons, course, badge, next lesson');

// 4. server problem: the saved copy stays, and is not overwritten
mode = '500';
r = await refreshSummary();
assert.equal(r.status, 'error'); assert.equal(r.summary.points, 30);
assert.equal((await getSavedSummary()).summary.points, 30);
assert.match(describeSummary(r), /saved copy/);
ok('server error: status error, the saved copy is kept and shown');

// 5. another learner on the same device never sees u1's copy
await saveToken(tokenFor('u2'));
assert.equal(await getSavedSummary(), null);
mode = '500';
r = await refreshSummary();
assert.equal(r.summary, null);
ok('a different learner on the same device does not see the saved copy');

// 6. back to u1: the copy is there again. The 401 case: token cleared, copy hidden.
await saveToken(tokenFor('u1'));
assert.equal((await getSavedSummary()).user_id, 'u1');
mode = '401';
r = await refreshSummary();
assert.equal(r.status, 'unauthorized'); assert.equal(r.summary, null); assert.equal(await getToken(), null);
ok('401: login cleared, status unauthorized, nothing shown');

// 7. sync + refresh: a successful sync with nothing waiting still refreshes the summary
mode = 'ok'; await saveToken(tokenFor('u1')); hits = [];
const s1 = await syncAndRefresh();
assert.equal(s1.status, 'done'); assert.equal(s1.summary_status, 'updated');
assert.equal(hits.length, 1); assert.match(hits[0].url, /progress\/summary$/);
ok('sync then refresh: after a successful sync the summary is refreshed');

// 8. server unreachable: sync says offline and does NOT try the summary; refresh falls back to the copy
server.close(); server.closeAllConnections?.(); await new Promise((r) => setTimeout(r, 100));
await D.saveLocalProgress({ pack_id: 1, module_key: 'm1', percent_complete: 100, status: 'completed' });
const s2 = await syncAndRefresh();
assert.equal(s2.status, 'offline'); assert.equal(s2.summary_status, 'skipped');
r = await refreshSummary();
assert.equal(r.status, 'offline'); assert.equal(r.summary.points, 30); assert.ok(r.saved_at);
assert.match(describeSummary(r), /saved copy from .*no signal/);
ok('no signal: sync says offline, the summary falls back to the saved copy');

console.log('ALL SUMMARY CHECKS PASSED'); process.exit(0);
