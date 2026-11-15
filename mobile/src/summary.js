// The learner's progress summary for the home screen: points, streak,
// lessons finished per course, badges and the next lesson.
//
// The server builds it (GET /progress/summary). The last answer is kept in
// the local database, so the numbers still show with no signal. The saved
// copy belongs to ONE learner: it is shown only while that same learner is
// logged in, so a shared phone never shows someone else's progress.
import base64 from 'base64-js';

import { request } from './api';
import { getToken } from './session';
import { getMeta, setMeta } from './db';
import { syncNow } from './sync';

const KEY = 'progress_summary';

// The learner's id is inside the login token (its middle part). Reading it
// needs no signal. This only READS the token, the server is the one that
// checks it is genuine.
async function currentUserId() {
  const token = await getToken();
  if (!token) return null;
  try {
    const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = part + '='.repeat((4 - (part.length % 4)) % 4);
    // bytes -> text without TextDecoder, which not every phone runtime has
    const bytes = base64.toByteArray(padded);
    const text = decodeURIComponent(Array.from(bytes, (b) => '%' + b.toString(16).padStart(2, '0')).join(''));
    const payload = JSON.parse(text);
    return typeof payload.user_id === 'string' ? payload.user_id : null;
  } catch (err) {
    return null;
  }
}

/** The saved summary of the learner who is logged in, or null. */
export async function getSavedSummary() {
  const userId = await currentUserId();
  if (!userId) return null;
  const saved = await getMeta(KEY);
  return saved && saved.user_id === userId ? saved : null;
}

/**
 * Asks the server for the latest summary and saves it. Always answers, never
 * throws. status is one of:
 *   updated       fresh from the server and saved
 *   offline       no signal: summary is the saved copy (or null)
 *   unauthorized  not logged in, or the login is no longer valid
 *   error         the server had a problem: summary is the saved copy (or null)
 */
export async function refreshSummary() {
  const userId = await currentUserId();
  if (!userId) return { status: 'unauthorized', summary: null, saved_at: null };

  try {
    const summary = await request('GET', '/progress/summary');
    const saved = { user_id: userId, saved_at: new Date().toISOString(), summary };
    await setMeta(KEY, saved);
    return { status: 'updated', summary, saved_at: saved.saved_at };
  } catch (err) {
    const saved = await getSavedSummary(); // null after a 401, the token is gone
    const base = { summary: saved ? saved.summary : null, saved_at: saved ? saved.saved_at : null };
    if (err.status === 401) return { status: 'unauthorized', ...base };
    if (err.offline) return { status: 'offline', ...base };
    return { status: 'error', message: err.message, ...base };
  }
}

/**
 * Sends what is waiting, and when that worked, refreshes the summary so the
 * points and badges just earned show up straight away. The sync result is
 * returned as it is, plus summary_status.
 */
export async function syncAndRefresh() {
  const result = await syncNow();
  if (result.status !== 'done') return { ...result, summary_status: 'skipped' };
  const refreshed = await refreshSummary();
  return { ...result, summary_status: refreshed.status };
}

/** The summary as plain text, for the test screen and for the logs. */
export function describeSummary(result) {
  const { status, summary, saved_at: savedAt } = result;
  if (status === 'unauthorized' && !summary) return 'Please log in first (button 2).';
  if (!summary) {
    return status === 'offline'
      ? 'No signal, and no progress saved on this device yet. Open this once with signal.'
      : `Could not load your progress${result.message ? ': ' + result.message : '.'}`;
  }

  const lines = [];
  lines.push(
    status === 'updated'
      ? 'Progress (just updated from the server)'
      : `Progress (saved copy from ${savedAt}, ${status === 'offline' ? 'no signal' : 'server problem'})`
  );
  lines.push(`Points: ${summary.points}   Streak: ${summary.streak_days} day(s)`);
  lines.push(`Overall: ${summary.overall.modules_completed} of ${summary.overall.modules_total} lessons (${summary.overall.percent}%)`);
  for (const c of summary.courses) {
    lines.push(`  ${c.title}: ${c.modules_completed}/${c.modules_total} (${c.percent}%)`);
  }
  lines.push(`Badges: ${summary.badges.length ? summary.badges.map((b) => b.name).join(', ') : 'none yet'}`);
  lines.push(
    summary.next_lesson
      ? `Next lesson: ${summary.next_lesson.title} (${summary.next_lesson.module_key}, pack ${summary.next_lesson.pack_id})`
      : 'Next lesson: none, everything is finished'
  );
  return lines.join('\n');
}
