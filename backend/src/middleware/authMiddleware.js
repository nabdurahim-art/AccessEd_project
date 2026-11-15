const jwt = require('jsonwebtoken');

// 1. Startup safety check: Fail loudly if JWT_SECRET is missing or insufficient
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  console.error('FATAL: JWT_SECRET must be set and at least 32 characters long.');
  process.exit(1);
}

/**
 * Middleware to verify JWT token from the Authorization header.
 * Enforces strict Bearer scheme, algorithm pinning to HS256, and 
 * distinguishes expired tokens for offline sync flows.
 */
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const [scheme, token] = (authHeader || '').split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ 
      error: 'Access token missing or malformed.', 
      code: 'TOKEN_MISSING' 
    });
  }

  jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] }, (err, user) => {
    if (err) {
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({ 
          error: 'Token expired.', 
          code: 'TOKEN_EXPIRED' 
        });
      }
      return res.status(401).json({ 
        error: 'Invalid token.', 
        code: 'TOKEN_INVALID' 
      });
    }

    // Attach decoded payload ({ user_id, role }) to the request object
    req.user = user;
    next();
  });
};

/**
 * Middleware to restrict route access to admin users only. 
 * Must be used strictly AFTER authenticateToken.
 */
const requireAdmin = (req, res, next) => {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ 
      error: 'Access denied. Admin privileges required.' 
    });
  }
  next();
};

module.exports = {
  authenticateToken,
  requireAdmin
};
