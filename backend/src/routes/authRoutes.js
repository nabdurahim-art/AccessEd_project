const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const authController = require('../controllers/authController');
const { authenticateToken, requireAdmin } = require('../middleware/authMiddleware');

// Counts only failed logins. Many learners can share one network at the centre.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many failed login attempts. Try again in 15 minutes.' },
});

// Each registration runs argon2id, which uses CPU, so keep it limited.
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many sign-ups from this network. Try again later.' },
});

// Wrong codes count here, so a code cannot be guessed from one network.
const resetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many tries. Try again in 15 minutes.' },
});

// Anyone on the login screen can ask for a code, so keep it small per network.
const requestLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests from this network. Try again later.' },
});

router.post('/register', registerLimiter, authController.registerUser);
router.post('/login', loginLimiter, authController.loginUser);
router.post('/reset-password', resetLimiter, authController.resetPassword);
router.post('/reset-request', requestLimiter, authController.requestReset);
router.get('/support', authController.getSupport);
router.get('/reset-requests', authenticateToken, requireAdmin, authController.listResetRequests);
router.post('/reset-requests/:id/code', authenticateToken, requireAdmin, authController.codeForRequest);
router.post('/reset-requests/:id/dismiss', authenticateToken, requireAdmin, authController.dismissRequest);
router.post('/reset-code', authenticateToken, requireAdmin, authController.createResetCode);
router.get('/me', authenticateToken, authController.getMe);

module.exports = router;
