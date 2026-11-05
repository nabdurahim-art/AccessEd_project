import * as Crypto from 'expo-crypto';
import { getDB } from './connection.js';

/* ------------------------------------------------------------------ *
 *  Progress and quiz attempts (what the learner does)
 * ------------------------------------------------------------------ */

// A whole number from 0 to 100. Anything else becomes 0.
function cleanPercent(value) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, n));
}

/**
 * Saves the learner's progress on one lesson. One row per lesson: the first
 * progress_id stays for the life of the lesson. A completed lesson is never
 * downgraded, so a learner cannot earn the completion points twice.
 * progress_id and updated_at are created here when not given.
 */
export async function saveLocalProgress({ progress_id, pack_id, module_key, percent_complete, status, updated_at }) {
  const db = await getDB();
  const id = progress_id || Crypto.randomUUID();
  const time = updated_at || new Date().toISOString();
  const finalStatus = status === 'completed' ? 'completed' : 'in_progress';
  const percent = finalStatus === 'completed' ? 100 : cleanPercent(percent_complete);

  await db.runAsync(
    `INSERT INTO local_progress
       (progress_id, pack_id, module_key, percent_complete, status, updated_at, synced, reject_reason)
     VALUES (?, ?, ?, ?, ?, ?, 0, NULL)
     ON CONFLICT(pack_id, module_key) DO UPDATE SET
       percent_complete = excluded.percent_complete,
       status = excluded.status,
       updated_at = excluded.updated_at,
       synced = 0,
       reject_reason = NULL
     WHERE local_progress.status != 'completed' OR excluded.status = 'completed';`,
    [id, pack_id, module_key, percent, finalStatus, time]
  );
}

/**
 * Saves one quiz attempt. Every attempt is a new row; the same attempt_id sent
 * twice is stored once. attempt_id and attempted_at are created when not given.
 * "passed" is only for the results screen; the server decides it again.
 */
export async function saveLocalQuizAttempt({ attempt_id, pack_id, module_key, score, passed, attempted_at }) {
  const db = await getDB();
  const id = attempt_id || Crypto.randomUUID();
  const time = attempted_at || new Date().toISOString();

  await db.runAsync(
    `INSERT OR IGNORE INTO local_quiz_attempts
       (attempt_id, pack_id, module_key, score, passed, attempted_at, synced, reject_reason)
     VALUES (?, ?, ?, ?, ?, ?, 0, NULL);`,
    [id, pack_id, module_key, cleanPercent(score), passed ? 1 : 0, time]
  );
}

/** The progress row for one lesson, or null. */
export async function getLocalProgress(packId, moduleKey) {
  const db = await getDB();
  return db.getFirstAsync(
    'SELECT * FROM local_progress WHERE pack_id = ? AND module_key = ?;',
    [packId, moduleKey]
  );
}

/** All progress rows of one pack, as a list. */
export async function getProgressForPack(packId) {
  const db = await getDB();
  return db.getAllAsync('SELECT * FROM local_progress WHERE pack_id = ?;', [packId]);
}

/** How many records are waiting to be sent. Drives the "Waiting to sync" banner. */
export async function getUnsyncedCount() {
  const db = await getDB();
  const a = await db.getFirstAsync('SELECT COUNT(*) AS n FROM local_progress WHERE synced = 0;');
  const b = await db.getFirstAsync('SELECT COUNT(*) AS n FROM local_quiz_attempts WHERE synced = 0;');
  return (a ? a.n : 0) + (b ? b.n : 0);
}

/**
 * The next batch to send, oldest first. At most 50 + 50, so never more than
 * the server's limit of 100 items. Only the fields the server reads.
 */
export async function getUnsyncedData() {
  const db = await getDB();

  const progress_items = await db.getAllAsync(
    `SELECT progress_id, pack_id, module_key, status, percent_complete, updated_at
     FROM local_progress WHERE synced = 0
     ORDER BY updated_at ASC LIMIT 50;`
  );

  const quiz_attempts = await db.getAllAsync(
    `SELECT attempt_id, pack_id, module_key, score, attempted_at
     FROM local_quiz_attempts WHERE synced = 0
     ORDER BY attempted_at ASC LIMIT 50;`
  );

  return { progress_items, quiz_attempts };
}

/**
 * Marks accepted items as sent. A progress row is only marked if its
 * updated_at is still the value that was sent, so an edit made while the
 * request was in flight stays queued.
 */
export async function markAsSynced(syncedProgress = [], syncedAttempts = []) {
  const db = await getDB();

  await db.withTransactionAsync(async () => {
    for (const item of syncedProgress) {
      await db.runAsync(
        `UPDATE local_progress SET synced = 1, reject_reason = NULL
         WHERE progress_id = ? AND updated_at = ?;`,
        [item.progress_id, item.updated_at]
      );
    }
    for (const item of syncedAttempts) {
      await db.runAsync(
        `UPDATE local_quiz_attempts SET synced = 1, reject_reason = NULL
         WHERE attempt_id = ?;`,
        [item.attempt_id]
      );
    }
  });
}

/**
 * Marks items the server refused as state 2, with the reason. Temporary
 * server problems ("Could not be saved...") stay at 0 so they are retried.
 */
export async function markAsRejected(rejectedProgress = [], rejectedAttempts = []) {
  const db = await getDB();
  const isTemporary = (reason) => reason.startsWith('Could not be saved');

  await db.withTransactionAsync(async () => {
    for (const item of rejectedProgress) {
      const reason = item.reason || 'Rejected by server';
      if (isTemporary(reason)) continue;
      await db.runAsync(
        `UPDATE local_progress SET synced = 2, reject_reason = ?
         WHERE progress_id = ? AND updated_at = ?;`,
        [reason, item.progress_id, item.updated_at]
      );
    }
    for (const item of rejectedAttempts) {
      const reason = item.reason || 'Rejected by server';
      if (isTemporary(reason)) continue;
      await db.runAsync(
        `UPDATE local_quiz_attempts SET synced = 2, reject_reason = ?
         WHERE attempt_id = ?;`,
        [reason, item.attempt_id]
      );
    }
  });
}
