// Saves progress and quiz attempts on the phone first, then sends them when online.
import * as api from './api.js';
import * as db from './db.js';
import { uuid, deviceId } from './packs.js';

export async function saveProgress(userId, packId, moduleKey, status, percent = 0) {
  const key = `${userId}:${packId}:${moduleKey}`;
  const old = await db.get('progress', key);
  if (old && old.status === 'completed' && status !== 'completed') return old; // never go backwards
  if (old && old.status === status && (status === 'completed' || old.percent_complete === percent)) return old; // nothing new
  const row = {
    key, user_id: userId, pack_id: Number(packId), module_key: moduleKey,
    progress_id: old ? old.progress_id : uuid(), // same id every time, so a retry never duplicates
    status, percent_complete: status === 'completed' ? 100 : percent,
    updated_at: new Date().toISOString(), synced: 0,
  };
  await db.put('progress', row);
  return row;
}

export async function saveAttempt(userId, packId, moduleKey, score) {
  const row = { attempt_id: uuid(), user_id: userId, pack_id: Number(packId), module_key: moduleKey,
    score, attempted_at: new Date().toISOString(), synced: 0 };
  await db.put('attempts', row);
  return row;
}

export async function progressOfPack(userId, packId) {
  const all = await db.getAll('progress');
  return all.filter((r) => r.user_id === userId && r.pack_id === Number(packId));
}

const waiting = async (userId) => ({
  progress: (await db.getAll('progress')).filter((r) => r.user_id === userId && !r.synced),
  attempts: (await db.getAll('attempts')).filter((r) => r.user_id === userId && !r.synced),
});

export async function pendingCount(userId) {
  const w = await waiting(userId);
  return w.progress.length + w.attempts.length;
}

let running = false;

// Sends everything waiting, up to 100 items per request. Returns the rewards, or null.
export async function syncNow(userId) {
  if (running || !navigator.onLine) return null;
  running = true;
  let rewards = { points_earned: 0, new_badges: [] };
  try {
    for (let round = 0; round < 5; round++) {
      const w = await waiting(userId);
      const progress = w.progress.slice(0, 100);
      const attempts = w.attempts.slice(0, 100 - progress.length);
      if (!progress.length && !attempts.length) break;

      const res = await api.syncBatch({
        device_id: await deviceId(),
        progress_items: progress.map(({ progress_id, pack_id, module_key, status, percent_complete, updated_at }) =>
          ({ progress_id, pack_id, module_key, status, percent_complete, updated_at })),
        quiz_attempts: attempts.map(({ attempt_id, pack_id, module_key, score, attempted_at }) =>
          ({ attempt_id, pack_id, module_key, score, attempted_at })),
      });

      // Accepted items are done. Rejected ones that cannot succeed later are marked done too,
      // so they are not sent forever. Temporary failures stay in the queue.
      const done = (r) => r.status === 'accepted' || (r.status === 'rejected' && !r.retryable);
      const okProgress = new Set((res.progress_results || []).filter(done).map((r) => r.progress_id));
      const okAttempts = new Set((res.quiz_results || []).filter(done).map((r) => r.attempt_id));
      await db.putMany('progress', progress.filter((p) => okProgress.has(p.progress_id)).map((p) => ({ ...p, synced: 1 })));
      await db.putMany('attempts', attempts.filter((a) => okAttempts.has(a.attempt_id)).map((a) => ({ ...a, synced: 1 })));

      if (res.rewards) {
        rewards.points_earned += res.rewards.points_earned || 0;
        rewards.new_badges.push(...(res.rewards.new_badges || []));
      }
      if (okProgress.size + okAttempts.size === 0) break; // nothing moved, try again later
    }
    return rewards;
  } catch {
    return null; // offline or server trouble: everything stays queued
  } finally {
    running = false;
  }
}
