const db = require('../config/database');

const VALID_LANGUAGES = ['en', 'fr', 'rw'];
const VALID_LEVELS = ['primary', 'secondary'];

const createCourse = async (req, res) => {
  try {
    const { title, subject, language, description } = req.body;
    const level = req.body.level === undefined ? 'secondary' : req.body.level;

    if (!title || typeof title !== 'string' || title.trim() === '' || title.length > 150) {
      return res.status(400).json({ error: 'Title is required (up to 150 characters).' });
    }
    if (!subject || typeof subject !== 'string' || subject.trim() === '' || subject.length > 80) {
      return res.status(400).json({ error: 'Subject is required (up to 80 characters).' });
    }
    if (!language || !VALID_LANGUAGES.includes(language)) {
      return res.status(400).json({ error: 'Language must be one of: en, fr, rw.' });
    }
    if (!VALID_LEVELS.includes(level)) {
      return res.status(400).json({ error: 'Level must be one of: primary, secondary.' });
    }
    if (description !== undefined && description !== null && typeof description !== 'string') {
      return res.status(400).json({ error: 'Description must be text.' });
    }

    const query = `
      INSERT INTO courses (title, subject, language, level, description)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *;
    `;

    const values = [
      title.trim(),
      subject.trim(),
      language,
      level,
      description && description.trim() ? description.trim() : null
    ];

    const result = await db.query(query, values);

    return res.status(201).json({
      message: 'Course created successfully.',
      course: result.rows[0]
    });
  } catch (err) {
    console.error('Create course error:', err);
    return res.status(500).json({ error: 'Internal server error while creating course.' });
  }
};

const getCourses = async (req, res) => {
  try {
    const { language, level } = req.query;

    if (language && !VALID_LANGUAGES.includes(language)) {
      return res.status(400).json({ error: 'Invalid language filter. Must be en, fr, or rw.' });
    }

    if (level && !VALID_LEVELS.includes(level)) {
      return res.status(400).json({ error: 'Invalid level filter. Must be primary or secondary.' });
    }

    let query = 'SELECT * FROM courses';
    const values = [];
    const where = [];

    if (language) {
      values.push(language);
      where.push(`language = $${values.length}`);
    }
    if (level) {
      values.push(level);
      where.push(`level = $${values.length}`);
    }
    if (where.length) query += ' WHERE ' + where.join(' AND ');

    query += ' ORDER BY created_at DESC';

    const result = await db.query(query, values);

    return res.status(200).json({
      count: result.rows.length,
      courses: result.rows
    });
  } catch (err) {
    console.error('Get courses error:', err);
    return res.status(500).json({ error: 'Internal server error while fetching courses.' });
  }
};

module.exports = { createCourse, getCourses };
