const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const db = require('../config/database');

// Pre-computed dummy hash to mitigate timing attacks during invalid login attempts
const DUMMY_HASH = '$2b$10$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQoeG6Lruj3vjPGga31lW';

const registerUser = async (req, res) => {
  try {
    const { username, email, password, full_name, phone_number } = req.body;

    // Strict type and presence validations
    if (!username || typeof username !== 'string') {
      return res.status(400).json({ error: 'Username is required and must be a string.' });
    }
    if ((!email || typeof email !== 'string') && (!phone_number || typeof phone_number !== 'string')) {
      return res.status(400).json({ error: 'Either a valid email or phone number is required.' });
    }
    if (!password || typeof password !== 'string') {
      return res.status(400).json({ error: 'Password is required and must be a string.' });
    }

    if (password.length < 8 || password.length > 72) {
      return res.status(400).json({ error: 'Password must be between 8 and 72 characters.' });
    }

    const saltRounds = 10;
    const password_hash = await bcrypt.hash(password, saltRounds);

    const query = `
      INSERT INTO users (username, email, password_hash, full_name, phone_number)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING user_id, username, email, phone_number, full_name, role, created_at;
    `;

    const values = [
      username.trim(), 
      email ? email.trim().toLowerCase() : null, 
      password_hash, 
      full_name ? full_name.trim() : null, 
      phone_number ? phone_number.trim() : null
    ];
    
    const result = await db.query(query, values);

    return res.status(201).json({
      message: 'User registered successfully.',
      user: result.rows[0]
    });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Username, email, or phone number already exists.' });
    }
    console.error('Registration error:', err);
    return res.status(500).json({ error: 'Internal server error during registration.' });
  }
};

const loginUser = async (req, res) => {
  try {
    const { identifier, password } = req.body;

    if (!identifier || typeof identifier !== 'string' || !password || typeof password !== 'string') {
      return res.status(400).json({ error: 'Identifier and password are required and must be strings.' });
    }

    const trimmedIdentifier = identifier.trim();
    const lowerEmailIdentifier = trimmedIdentifier.toLowerCase();

    const query = `
      SELECT user_id, username, role, password_hash 
      FROM users 
      WHERE username = $1 OR email = $2 OR phone_number = $1
      LIMIT 1
    `;

    const userResult = await db.query(query, [trimmedIdentifier, lowerEmailIdentifier]);

    if (userResult.rows.length === 0) {
      // Burn equal time to prevent timing-based user enumeration attacks
      await bcrypt.compare(password, DUMMY_HASH);
      return res.status(401).json({ error: 'Invalid credentials.' });
    }

    const user = userResult.rows[0];

    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }

    const token = jwt.sign(
      { user_id: user.user_id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '7d', algorithm: 'HS256' }
    );

    return res.status(200).json({
      message: 'Login successful.',
      token,
      user: {
        user_id: user.user_id,
        username: user.username,
        role: user.role
      }
    });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ error: 'Internal server error during login.' });
  }
};

const getMe = async (req, res) => {
  try {
    const userId = req.user.user_id;

    const query = `
      SELECT user_id, username, email, phone_number, full_name, role, points, streak_days 
      FROM users 
      WHERE user_id = $1
    `;

    const result = await db.query(query, [userId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User account not found.' });
    }

    return res.status(200).json({ user: result.rows[0] });
  } catch (err) {
    console.error('Get me error:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
};

module.exports = {
  registerUser,
  loginUser,
  getMe
};
