// mobile/src/sync.js
// Sends saved progress and quiz attempts to the server, oldest first, in
// batches. An item is marked as sent only when the server accepted it.
import { getUnsyncedData, markAsSynced, markAsRejected } from './db/index.js';
import { request } from './api.js';
import { getDeviceId } from './session';
import { retryPendingConfirms } from './downloader';

let running = false;

// A problem that may go away by itself. Those items stay queued and are NOT
// counted as finished. When the server sends retryable (true or false) we
// believe it. Only an older server without the flag falls back to the text.
const isTemporary = (res) =>
  typeof res.retryable === 'boolean'
    ? res.retryable
    : String(res.reason || '').startsWith('Could not be saved');

export async function syncNow() {
  if (running) return { status: 'already_running' };
  running = true;

  const total = { sent: 0, rejected: 0, retry_later: 0, points: 0, badges: [] };
  const summary = (status, extra = {}) => ({ status, ...total, ...extra });
  const MAX_ROUNDS = 20;

  try {
    const deviceId = await getDeviceId();

    for (let round = 0; round < MAX_ROUNDS; round++) {
      // getUnsyncedData returns { progress_items, quiz_attempts } (max 50 + 50).
      const { progress_items = [], quiz_attempts = [] } = (await getUnsyncedData()) || {};
      if (progress_items.length === 0 && quiz_attempts.length === 0) break;

      // The server's answers only carry ids, but markAsSynced needs updated_at,
      // so keep what we sent, by id.
      const sentProgress = new Map(progress_items.map((p) => [p.progress_id, p]));
      const sentQuiz = new Map(quiz_attempts.map((q) => [q.attempt_id, q]));

      let reply;
      try {
        reply = await request('POST', '/sync', { progress_items, quiz_attempts, device_id: deviceId });
      } catch (err) {
        if (err.offline) return summary('offline');
        if (err.status === 401) return summary('unauthorized');
        return summary('error', { message: err.message });
      }

      const acceptedProgress = [], rejectedProgress = [], acceptedQuiz = [], rejectedQuiz = [];
      let waiting = 0;

      for (const res of reply.progress_results || []) {
        const item = sentProgress.get(res.progress_id);
        if (!item) continue;
        if (res.status === 'accepted') acceptedProgress.push(item);
        else if (isTemporary(res)) waiting++;
        else rejectedProgress.push({ ...item, reason: res.reason || 'Rejected by server' });
      }
      for (const res of reply.quiz_results || []) {
        const item = sentQuiz.get(res.attempt_id);
        if (!item) continue;
        if (res.status === 'accepted') acceptedQuiz.push(item);
        else if (isTemporary(res)) waiting++;
        else rejectedQuiz.push({ ...item, reason: res.reason || 'Rejected by server' });
      }

      await markAsSynced(acceptedProgress, acceptedQuiz);
      await markAsRejected(rejectedProgress, rejectedQuiz);

      const finished = acceptedProgress.length + acceptedQuiz.length + rejectedProgress.length + rejectedQuiz.length;
      total.sent += acceptedProgress.length + acceptedQuiz.length;
      total.rejected += rejectedProgress.length + rejectedQuiz.length;
      total.retry_later = waiting;
      const rewards = reply.rewards || {};
      if (rewards.points_earned) total.points += rewards.points_earned;
      if (Array.isArray(rewards.new_badges)) total.badges.push(...rewards.new_badges);

      // Nothing finished this round (only temporary problems): stop, or we would loop forever.
      if (finished === 0) break;
    }

    // Re-send download confirmations that were queued while offline. Never let this break a sync.
    try { await retryPendingConfirms(); } catch (e) { console.warn('retryPendingConfirms failed:', e); }

    return summary('done');
  } finally {
    running = false;
  }
}
