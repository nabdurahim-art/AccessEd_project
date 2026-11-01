const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const authController = require('../controllers/authController');
const { authenticateToken } = require('../middleware/authMiddleware');

// Counts only failed logins. Many learners can share one network at the centre.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many failed login attempts. Try again in 15 minutes.' },
});

// Each registration runs bcrypt, which uses CPU, so keep it limited.
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many sign-ups from this network. Try again later.' },
});

router.post('/register', registerLimiter, authController.registerUser);
router.post('/login', loginLimiter, authController.loginUser);
router.get('/me', authenticateToken, authController.getMe);

module.exports = router;
