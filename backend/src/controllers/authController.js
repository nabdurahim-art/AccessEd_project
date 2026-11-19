const argon2 = require('argon2');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const db = require('../config/database');
const { USERNAME_RULE, EMAIL_RULE, isBlank, normalizePhone, conflictMessage } = require('../utils/identity');

// Argon2id settings. These are OWASP's recommended minimum: 19 MiB of memory,
// 2 passes, 1 thread. Raising them makes guessing harder but uses more memory.
const HASH_OPTIONS = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 };

// Made once at startup, so a failed login for an unknown user still spends
// real hashing time (this stops timing-based user enumeration).
const DUMMY_HASH = argon2.hash('not-a-real-password', HASH_OPTIONS);

const registerUser = async (req, res) => {
  try {
    const { username, email, password, full_name, phone_number } = req.body || {};

    // Strict type and presence validations
    if (typeof username !== 'string' || !USERNAME_RULE.test(username.trim())) {
      return res.status(400).json({ error: 'Username must be 3 to 30 characters: letters, numbers or underscore.' });
    }
    if (isBlank(email) && isBlank(phone_number)) {
      return res.status(400).json({ error: 'Give an email or a phone number.' });
    }
    let cleanEmail = null;
    if (!isBlank(email)) {
      cleanEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
      if (!EMAIL_RULE.test(cleanEmail) || cleanEmail.length > 255) {
        return res.status(400).json({ error: 'Email does not look right.' });
      }
    }
    let cleanPhone = null;
    if (!isBlank(phone_number)) {
      cleanPhone = normalizePhone(phone_number);
      if (!cleanPhone) {
        return res.status(400).json({ error: 'Phone number does not look right. Example: 0788123456.' });
      }
    }
    if (!password || typeof password !== 'string') {
      return res.status(400).json({ error: 'Password is required and must be a string.' });
    }
    // The database needs a full name, so say so clearly instead of failing with a 500.
    if (!full_name || typeof full_name !== 'string' || full_name.trim() === '' || full_name.length > 100) {
      return res.status(400).json({ error: 'Full name is required (up to 100 characters).' });
    }

    // Argon2id has no 72-byte limit in some older hashing methods, but a cap stops huge inputs
    // from wasting server memory and time.
    if (password.length < 8 || password.length > 100) {
      return res.status(400).json({ error: 'Password must be between 8 and 100 characters.' });
    }

    const password_hash = await argon2.hash(password, HASH_OPTIONS);

    const query = `
      INSERT INTO users (username, email, password_hash, full_name, phone_number)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING user_id, username, email, phone_number, full_name, role, created_at;
    `;

    const values = [
      username.trim(),
      cleanEmail,
      password_hash,
      full_name.trim(),
      cleanPhone
    ];

    const result = await db.query(query, values);

    return res.status(201).json({
      message: 'User registered successfully.',
      user: result.rows[0]
    });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: conflictMessage(err.constraint) });
    }
    console.error('Registration error:', err);
    return res.status(500).json({ error: 'Internal server error during registration.' });
  }
};

const loginUser = async (req, res) => {
  try {
    const { identifier, password } = req.body || {};

    if (!identifier || typeof identifier !== 'string' || !password || typeof password !== 'string') {
      return res.status(400).json({ error: 'Identifier and password are required and must be strings.' });
    }

    const trimmedIdentifier = identifier.trim();
    const lowerEmailIdentifier = trimmedIdentifier.toLowerCase();

    const query = `
      SELECT user_id, username, role, password_hash 
      FROM users 
      WHERE username = $1 OR email = $2 OR phone_number = $1 OR phone_number = $3
      LIMIT 1
    `;

    const userResult = await db.query(query, [trimmedIdentifier, lowerEmailIdentifier, normalizePhone(trimmedIdentifier)]);

    if (userResult.rows.length === 0) {
      // Burn equal time to prevent timing-based user enumeration attacks
      await argon2.verify(await DUMMY_HASH, password).catch(() => false);
      return res.status(401).json({ error: 'Invalid credentials.' });
    }

    const user = userResult.rows[0];

    // argon2.verify takes the stored hash FIRST, then the password.
    // It throws if the stored hash is not an argon2 hash (for example an old
    // different one), which we treat as a wrong password, not a server error.
    let isMatch = false;
    try {
      isMatch = await argon2.verify(user.password_hash, password);
    } catch {
      isMatch = false;
    }
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

// ---- Forgotten password ----
// There is no email or SMS service, so an admin (facilitator) makes a one-time
// code for the learner. The learner types it with a new password.
const RESET_HOURS = 24;
const RESET_MAX_ATTEMPTS = 5;
// No 0/O or 1/I/L, so a code read out loud or copied by hand is not mixed up.
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

const makeCode = () => {
  let code = '';
  for (let i = 0; i < 8; i++) code += CODE_CHARS[crypto.randomInt(CODE_CHARS.length)];
  return code;
};
const normalizeCode = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const hashCode = (c) => crypto.createHash('sha256').update(normalizeCode(c)).digest('hex');

const findByIdentifier = async (identifier) => {
  const id = String(identifier).trim();
  const r = await db.query(
    `SELECT user_id, username FROM users
     WHERE username = $1 OR email = $2 OR phone_number = $1 OR phone_number = $3 LIMIT 1`,
    [id, id.toLowerCase(), normalizePhone(id)]
  );
  return r.rows[0] || null;
};

// Admin only. Makes a new code (and cancels any older unused ones).
const createResetCode = async (req, res) => {
  try {
    const { identifier } = req.body || {};
    if (!identifier || typeof identifier !== 'string' || identifier.trim() === '') {
      return res.status(400).json({ error: 'Give the learner\'s username, email or phone number.' });
    }
    const user = await findByIdentifier(identifier);
    if (!user) return res.status(404).json({ error: 'No account found with that username, email or phone number.' });

    const code = makeCode();
    await db.query('UPDATE password_resets SET used_at = NOW() WHERE user_id = $1 AND used_at IS NULL', [user.user_id]);
    const ins = await db.query(
      `INSERT INTO password_resets (user_id, code_hash, expires_at, created_by)
       VALUES ($1, $2, NOW() + ($3 || ' hours')::interval, $4) RETURNING expires_at`,
      [user.user_id, hashCode(code), String(RESET_HOURS), req.user.user_id]
    );
    return res.status(201).json({ username: user.username, code, expires_at: ins.rows[0].expires_at });
  } catch (err) {
    console.error('Reset code error:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
};

// Public. One answer for every failure, so nobody can use it to find out which usernames exist.
const BAD_CODE = { error: 'The code is wrong or has expired. Ask your facilitator for a new one.' };

const resetPassword = async (req, res) => {
  try {
    const { identifier, code, new_password } = req.body || {};
    if (!identifier || typeof identifier !== 'string' || !code || typeof code !== 'string') {
      return res.status(400).json({ error: 'Username and code are required.' });
    }
    if (typeof new_password !== 'string' || new_password.length < 8 || new_password.length > 100) {
      return res.status(400).json({ error: 'Password must be between 8 and 100 characters.' });
    }

    const user = await findByIdentifier(identifier);
    if (!user) return res.status(400).json(BAD_CODE);

    const r = await db.query(
      `SELECT reset_id, code_hash, attempts FROM password_resets
       WHERE user_id = $1 AND used_at IS NULL AND expires_at > NOW()
       ORDER BY created_at DESC LIMIT 1`,
      [user.user_id]
    );
    const row = r.rows[0];
    if (!row) return res.status(400).json(BAD_CODE);

    const given = Buffer.from(hashCode(code));
    const real = Buffer.from(row.code_hash);
    if (!crypto.timingSafeEqual(given, real)) {
      // After a few wrong guesses the code is cancelled, so it cannot be guessed.
      await db.query(
        `UPDATE password_resets SET attempts = attempts + 1,
           used_at = CASE WHEN attempts + 1 >= $2 THEN NOW() ELSE used_at END
         WHERE reset_id = $1`,
        [row.reset_id, RESET_MAX_ATTEMPTS]
      );
      return res.status(400).json(BAD_CODE);
    }

    const password_hash = await argon2.hash(new_password, HASH_OPTIONS);
    await db.query('UPDATE users SET password_hash = $1 WHERE user_id = $2', [password_hash, user.user_id]);
    await db.query('UPDATE password_resets SET used_at = NOW() WHERE user_id = $1 AND used_at IS NULL', [user.user_id]);
    return res.status(200).json({ message: 'Password changed. You can log in now.' });
  } catch (err) {
    console.error('Reset password error:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
};

module.exports = {
  registerUser,
  loginUser,
  getMe,
  createResetCode,
  resetPassword
};
