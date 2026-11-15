const db = require('../config/database');

const percent = (done, total) => (total > 0 ? Math.round((100 * done) / total) : 0);

// One answer for the home screen: points, streak, progress per course,
// badges and the next lesson to continue.
const getSummary = async (req, res) => {
  try {
    const userId = req.user.user_id;

    const userRes = await db.query(
      `SELECT points, streak_days FROM users WHERE user_id = $1`,
      [userId]
    );
    if (userRes.rows.length === 0) {
      return res.status(404).json({ error: 'User not found.' });
    }

    // Every module counts in the total. Only the ones this learner has
    // completed are joined in, so COUNT(up.module_id) is the completed number.
    const coursesRes = await db.query(
      `SELECT c.course_id, c.title,
              COUNT(m.module_id)::int AS modules_total,
              COUNT(up.module_id)::int AS modules_completed
       FROM courses c
       JOIN content_packs p ON p.course_id = c.course_id
       JOIN modules m ON m.pack_id = p.pack_id
       LEFT JOIN user_progress up
         ON up.module_id = m.module_id AND up.user_id = $1 AND up.status = 'completed'
       GROUP BY c.course_id, c.title
       ORDER BY c.course_id`,
      [userId]
    );

    const badgesRes = await db.query(
      `SELECT b.badge_id, b.name, ub.earned_at
       FROM user_badges ub
       JOIN badges b ON b.badge_id = ub.badge_id
       WHERE ub.user_id = $1
       ORDER BY ub.earned_at`,
      [userId]
    );

    // The first lesson, in course, week and lesson order, that is not completed.
    const nextRes = await db.query(
      `SELECT p.pack_id, m.module_key, m.title, up.status
       FROM modules m
       JOIN content_packs p ON p.pack_id = m.pack_id
       LEFT JOIN user_progress up ON up.module_id = m.module_id AND up.user_id = $1
       WHERE up.status IS DISTINCT FROM 'completed'
       ORDER BY p.course_id, p.week_number, m.sort_order
       LIMIT 1`,
      [userId]
    );

    const courses = coursesRes.rows.map((c) => ({ ...c, percent: percent(c.modules_completed, c.modules_total) }));
    const modulesTotal = courses.reduce((sum, c) => sum + c.modules_total, 0);
    const modulesCompleted = courses.reduce((sum, c) => sum + c.modules_completed, 0);
    const next = nextRes.rows[0];

    return res.status(200).json({
      points: userRes.rows[0].points,
      streak_days: userRes.rows[0].streak_days,
      overall: {
        modules_completed: modulesCompleted,
        modules_total: modulesTotal,
        percent: percent(modulesCompleted, modulesTotal)
      },
      courses,
      badges: badgesRes.rows,
      next_lesson: next
        ? { pack_id: next.pack_id, module_key: next.module_key, title: next.title, status: next.status || 'not_started' }
        : null
    });
  } catch (err) {
    console.error('Progress summary error:', err);
    return res.status(500).json({ error: 'Internal server error while building the summary.' });
  }
};

module.exports = { getSummary };
