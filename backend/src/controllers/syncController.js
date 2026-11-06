const db = require('../config/database');
const { validateProgressItem, validateQuizAttemptItem } = require('../utils/syncChecks');
const { awardRewards, POINTS } = require('../utils/rewards');

const MAX_ITEMS = 100;
const UUID_RULE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// A database error that may go away by itself (busy, deadlock, connection
// trouble) is worth retrying. Anything else will fail the same way again.
function isTemporary(err) {
  const code = (err && err.code) || '';
  return code === '40001' || code === '40P01' || code === '55P03' ||
         code.startsWith('08') || code.startsWith('53') || code.startsWith('57P');
}

// Saves the learner's progress and quiz attempts sent by a phone.
// Every item gets its own answer, so one bad item never blocks the rest.
const syncProgress = async (req, res) => {
  const userId = req.user.user_id;
  const body = req.body || {};
  const progressItems = Array.isArray(body.progress_items) ? body.progress_items : null;
  const quizAttempts = Array.isArray(body.quiz_attempts) ? body.quiz_attempts : null;

  if (!progressItems && !quizAttempts) {
    return res.status(400).json({ error: 'Request body must contain progress_items and/or quiz_attempts arrays.' });
  }

  const total = (progressItems ? progressItems.length : 0) + (quizAttempts ? quizAttempts.length : 0);
  if (total > MAX_ITEMS) {
    return res.status(400).json({ error: `Batch size exceeds maximum limit of ${MAX_ITEMS} items.` });
  }

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const progressResults = [];
    const quizResults = [];
    const activityDates = []; // when the learner really studied, for the streak
    let points = 0;

    for (const item of progressItems || []) {
      const progressId = item && item.progress_id ? item.progress_id : null;

      const check = await validateProgressItem(client, userId, item);
      if (!check.valid) {
        progressResults.push({ progress_id: progressId, status: 'rejected', reason: check.reason });
        continue;
      }

      // A savepoint lets one failing item be undone without losing the others.
      await client.query('SAVEPOINT item');
      try {
        const before = await client.query(
          `SELECT status FROM user_progress WHERE user_id = $1 AND module_id = $2`,
          [userId, check.module_id]
        );
        const wasCompleted = before.rows.length > 0 && before.rows[0].status === 'completed';

        // Newest updated_at wins. If the saved row is newer, nothing changes
        // and no row comes back.
        const saved = await client.query(
          `INSERT INTO user_progress (progress_id, user_id, module_id, status, percent_complete, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6)

             status = CASE WHEN user_progress.status = 'completed'
                           THEN 'completed' ELSE EXCLUDED.status END,
             percent_complete = CASE WHEN user_progress.status = 'completed'
                           THEN user_progress.percent_complete ELSE EXCLUDED.percent_complete END,
             updated_at = EXCLUDED.updated_at
           WHERE EXCLUDED.updated_at >= user_progress.updated_at
           RETURNING status`,
          [item.progress_id, userId, check.module_id, check.status, check.percent_complete, check.updated_at]
        );
        await client.query('RELEASE SAVEPOINT item');

        if (saved.rows.length === 0) {
          progressResults.push({ progress_id: progressId, status: 'accepted', note: 'newer_version_kept' });
          continue;
        }

        activityDates.push(check.updated_at);
        if (check.status === 'completed' && !wasCompleted) points += POINTS.MODULE_COMPLETED;
        progressResults.push({ progress_id: progressId, status: 'accepted' });
      } catch (err) {
        await client.query('ROLLBACK TO SAVEPOINT item');
        console.error('Progress item failed:', err.message);
        progressResults.push({ progress_id: progressId, status: 'rejected', reason: 'Could not be saved. Try again later.', retryable: isTemporary(err) });
      }
    }

    for (const attempt of quizAttempts || []) {
      const attemptId = attempt && attempt.attempt_id ? attempt.attempt_id : null;

      const check = await validateQuizAttemptItem(client, userId, attempt);
      if (!check.valid) {
        quizResults.push({ attempt_id: attemptId, status: 'rejected', reason: check.reason });
        continue;
      }

      await client.query('SAVEPOINT item');
      try {
        // Has the learner passed this quiz before? Asked before saving, so
        // the new attempt does not count against itself.
        const prior = await client.query(
          `SELECT 1 FROM quiz_attempts WHERE user_id = $1 AND quiz_id = $2 AND score >= $3 LIMIT 1`,
          [userId, check.quiz_id, check.pass_mark]
        );

        // The same attempt sent twice is stored once. The conflict is on
        // attempt_id alone, because it is the primary key.
        const saved = await client.query(
          `INSERT INTO quiz_attempts (attempt_id, user_id, quiz_id, score, attempted_at)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (attempt_id) DO NOTHING
           RETURNING attempt_id`,
          [attempt.attempt_id, userId, check.quiz_id, check.score, check.attempted_at]
        );
        await client.query('RELEASE SAVEPOINT item');

        if (saved.rows.length === 0) {
          quizResults.push({ attempt_id: attemptId, status: 'accepted', note: 'already_recorded' });
          continue;
        }

        const passed = check.score >= check.pass_mark;
        activityDates.push(check.attempted_at);
        if (passed && prior.rows.length === 0) points += POINTS.QUIZ_PASSED;
        quizResults.push({ attempt_id: attemptId, status: 'accepted', passed });
      } catch (err) {
        await client.query('ROLLBACK TO SAVEPOINT item');
        console.error('Quiz attempt failed:', err.message);
        quizResults.push({ attempt_id: attemptId, status: 'rejected', reason: 'Could not be saved. Try again later.', retryable: isTemporary(err) });
      }
    }

    // Rewards only when something new was really stored.
    let rewards = { points_earned: 0, new_badges: [] };
    if (activityDates.length > 0) {
      rewards = await awardRewards(client, userId, { points, activityDates });
    }

    // Note which phone just synced, if it told us. The phone is not tied to
    // the learner, so only the time is updated.
    if (typeof body.device_id === 'string' && UUID_RULE.test(body.device_id)) {
      await client.query(`UPDATE devices SET last_seen_at = NOW() WHERE device_id = $1`, [body.device_id]);
    }

    await client.query('COMMIT');

    return res.status(200).json({
      message: 'Synchronization processed successfully.',
      progress_results: progressResults,
      quiz_results: quizResults,
      rewards
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Sync error:', err);
    return res.status(500).json({ error: 'Internal server error during synchronization.' });
  } finally {
    client.release();
  }
};

module.exports = { syncProgress };
