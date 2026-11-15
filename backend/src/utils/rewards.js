// Points, daily streaks and badges.
//
// Call awardRewards from inside the sync transaction, after the progress and
// quiz rows are saved, and only when something real was accepted.

const TIME_ZONE = 'Africa/Kigali';

// How many points each achievement is worth. The sync code decides when
// something counts as new, so a repeated sync never pays twice.
const POINTS = {
  MODULE_COMPLETED: 10,
  QUIZ_PASSED: 20
};

// The rule for each badge, matched by the badge's name in the badges table.
// A badge row with no rule here is simply never awarded automatically.
// "s" holds the learner's numbers, worked out by the database below.
const BADGE_RULES = {
  'First Step':   (s) => s.modules_completed >= 1,
  'Quiz Starter': (s) => s.quizzes_passed >= 1,
  'Fast Learner': (s) => s.best_day_completions >= 5,
  'Week Streak':  (s) => s.streak_days >= 7
};

// A date as "2026-10-31", in Rwanda time. A learner who studies at 00:30 in
// Kigali has studied on the new day, not the old one.
const dayFormat = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE });

function dayOf(date) {
  return dayFormat.format(new Date(date));
}

// Whole days from one "YYYY-MM-DD" to another.
function daysBetween(from, to) {
  return Math.round((Date.parse(to) - Date.parse(from)) / 86400000);
}

/**
 * client         a database client inside a transaction
 * userId         the learner
 * points         points earned in this sync (0 if none)
 * activityDates  when the learner really studied, as sent by the phone.
 *                A learner may sync several days at once, so this is a list.
 */
const awardRewards = async (client, userId, { points = 0, activityDates = [] } = {}) => {
  // Lock the learner's row so two phones syncing at once take turns.
  const userRes = await client.query(
    `SELECT streak_days, to_char(last_activity_date, 'YYYY-MM-DD') AS last_day
     FROM users WHERE user_id = $1 FOR UPDATE`,
    [userId]
  );
  if (userRes.rows.length === 0) {
    throw new Error('User not found while awarding rewards.');
  }

  let streak = userRes.rows[0].streak_days;
  let lastDay = userRes.rows[0].last_day; // text, or null if never active

  // 1. Streak: look at each day of activity once, oldest first.
  const today = dayOf(new Date());
  const days = [...new Set(
    activityDates
      .filter((d) => !Number.isNaN(new Date(d).getTime()))
      .map(dayOf)
  )].sort();

  for (const day of days) {
    if (day > today) continue;                    // a wrong phone clock
    if (lastDay !== null && day <= lastDay) continue; // already counted, or older

    streak = lastDay !== null && daysBetween(lastDay, day) === 1 ? streak + 1 : 1;
    lastDay = day;
  }

  // 2. Save the points and the streak together.
  const saved = await client.query(
    `UPDATE users
     SET points = points + $1, streak_days = $2, last_activity_date = $3
     WHERE user_id = $4
     RETURNING points`,
    [points, streak, lastDay, userId]
  );

  // 3. Badges: work out the learner's numbers, then test each rule.
  const statsRes = await client.query(
    `SELECT
       (SELECT COUNT(*) FROM user_progress
         WHERE user_id = $1 AND status = 'completed')::int AS modules_completed,
       (SELECT COUNT(DISTINCT qa.quiz_id)
          FROM quiz_attempts qa JOIN quizzes q ON q.quiz_id = qa.quiz_id
         WHERE qa.user_id = $1 AND qa.score >= q.pass_mark)::int AS quizzes_passed,
       (SELECT COALESCE(MAX(per_day), 0) FROM (
          SELECT COUNT(*) AS per_day FROM user_progress
           WHERE user_id = $1 AND status = 'completed'
           GROUP BY (updated_at AT TIME ZONE '${TIME_ZONE}')::date
        ) d)::int AS best_day_completions`,
    [userId]
  );
  const stats = { ...statsRes.rows[0], streak_days: streak };

  const badgesRes = await client.query(
    `SELECT b.badge_id, b.name
     FROM badges b
     WHERE NOT EXISTS (
       SELECT 1 FROM user_badges ub WHERE ub.badge_id = b.badge_id AND ub.user_id = $1
     )`,
    [userId]
  );

  const newBadges = badgesRes.rows.filter((b) => BADGE_RULES[b.name] && BADGE_RULES[b.name](stats));

  if (newBadges.length > 0) {
    await client.query(
      `INSERT INTO user_badges (user_id, badge_id)
       SELECT $1, UNNEST($2::int[])
       ON CONFLICT DO NOTHING`,
      [userId, newBadges.map((b) => b.badge_id)]
    );
  }

  return {
    points: saved.rows[0].points,
    points_earned: points,
    streak_days: streak,
    new_badges: newBadges.map((b) => ({ badge_id: b.badge_id, name: b.name }))
  };
};

module.exports = { awardRewards, POINTS };
