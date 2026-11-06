import http from 'node:http';
import assert from 'node:assert/strict';
let mode='ok', hits=[], serverUp=true;
const server = http.createServer((req,res)=>{ let d=''; req.on('data',c=>d+=c); req.on('end',()=>{
  const body = d?JSON.parse(d):null; hits.push({auth:req.headers.authorization, body});
  const send=(c,j)=>{res.writeHead(c,{'content-type':'application/json'});res.end(JSON.stringify(j));};
  if(mode==='401') return send(401,{error:'Invalid token.'});
  const pr=(body.progress_items||[]).map(p=>{
    if(mode==='temp') return {progress_id:p.progress_id,status:'rejected',reason:'Could not be saved. Try again later.',retryable:true};
    if(mode==='perm') return {progress_id:p.progress_id,status:'rejected',reason:'Unknown lesson.'};
    return {progress_id:p.progress_id,status:'accepted'};});
  const qr=(body.quiz_attempts||[]).map(q=>({attempt_id:q.attempt_id,status:'accepted',passed:true}));
  send(200,{message:'ok',progress_results:pr,quiz_results:qr,rewards:{points_earned:mode==='ok'?30:0,new_badges:mode==='ok'?[{name:'First Step'}]:[]}});
});});
await new Promise(r=>server.listen(0,r)); const port=server.address().port;
process.env.EXPO_PUBLIC_API_URL=`http://127.0.0.1:${port}/api/v1`;
const D = await import('../src/db/index.js'); const { saveToken } = await import('../src/session.js'); const { syncNow } = await import('../src/sync.js');
await D.initDatabase(); await saveToken('GOODTOKEN');
let n=0; const ok=m=>console.log('ok',++n,m);
const db = await D.getDB();
const reset=async()=>{await db.runAsync('DELETE FROM local_progress');await db.runAsync('DELETE FROM local_quiz_attempts');hits=[];};
const addItems=async(k)=>{for(let i=0;i<k;i++) await D.saveLocalProgress({pack_id:1,module_key:'m'+i,percent_complete:100,status:'completed'}); };

await reset(); await addItems(2); await D.saveLocalQuizAttempt({pack_id:1,module_key:'m0',score:85,passed:true});
assert.equal(await D.getUnsyncedCount(),3);
let r=await syncNow(); assert.equal(r.status,'done'); assert.equal(r.sent,3); assert.equal(r.points,30); assert.equal(r.badges.length,1); assert.equal(await D.getUnsyncedCount(),0);
assert.equal(hits.length,1); assert.equal(hits[0].auth,'Bearer GOODTOKEN'); assert.match(hits[0].body.device_id,/^[0-9a-f-]{36}$/); ok('3 items sent in one request, all marked synced, points and badge reported, token and device id sent');
r=await syncNow(); assert.equal(r.status,'done'); assert.equal(r.sent,0); assert.equal(hits.length,1); ok('nothing queued: no request made');

await reset(); await addItems(60); r=await syncNow(); assert.equal(r.sent,60); assert.equal(await D.getUnsyncedCount(),0);
assert.ok(hits.every(h=>h.body.progress_items.length+h.body.quiz_attempts.length<=100)); assert.equal(hits.length,2); ok('60 items go in 2 batches, each under the 100 limit');

await reset(); await addItems(2); mode='temp'; r=await syncNow(); assert.equal(r.status,'done'); assert.equal(r.sent,0); assert.equal(r.rejected,0); assert.equal(r.retry_later,2); assert.equal(hits.length,1); assert.equal(await D.getUnsyncedCount(),2); ok('temporary server problem: stays queued, one request only (no endless loop), reported as retry_later');
mode='ok'; r=await syncNow(); assert.equal(r.sent,2); assert.equal(await D.getUnsyncedCount(),0); ok('retried later and delivered');

await reset(); await addItems(2); mode='perm'; r=await syncNow(); assert.equal(r.rejected,2); assert.equal(await D.getUnsyncedCount(),0);
const rows=await db.getAllAsync('SELECT synced,reject_reason FROM local_progress'); assert.ok(rows.every(x=>x.synced===2&&x.reject_reason==='Unknown lesson.')); ok('permanent refusal: marked 2 with the reason, not retried');

await reset(); await addItems(2); mode='401'; r=await syncNow(); assert.equal(r.status,'unauthorized'); assert.equal(await D.getUnsyncedCount(),2); ok('401: status unauthorized, data kept');

mode='ok'; await saveToken('GOODTOKEN'); await reset(); await addItems(2);
const [a,b]=await Promise.all([syncNow(),syncNow()]); assert.ok([a.status,b.status].includes('already_running')); assert.equal(hits.length,1); ok('two simultaneous calls: one runs, one is told already_running');

server.close(); server.closeAllConnections?.(); await new Promise(r=>setTimeout(r,100));
await reset(); await addItems(2); r=await syncNow(); assert.equal(r.status,'offline'); assert.equal(await D.getUnsyncedCount(),2); ok('server unreachable: status offline, data kept');
console.log('ALL SYNC CLIENT CHECKS PASSED'); process.exit(0);
