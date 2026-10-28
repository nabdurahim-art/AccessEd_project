const jwt = require('jsonwebtoken');

/**
 * Middleware to verify JWT token from the Authorization header.
 * Expected format: "Authorization: Bearer <token>"
 */
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const [scheme, token] = (authHeader || '').split(' ');

  // Enforce strict Bearer scheme and token presence
  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Access token missing or malformed.' });
  }

  // Pin algorithm to HS256 and return 401 on expiration/tampering
  jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] }, (err, user) => {
    if (err) {
      return res.status(401).json({ error: 'Invalid or expired token.' });
    }

    // Attach decoded payload (user_id, role) to the request object
    req.user = user;
    next();
  });
};

/**
 * Middleware to restrict route access to admin users only.
 * Must be used AFTER authenticateToken.
 */
const requireAdmin = (req, res, next) => {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Access denied. Admin privileges required.' });
  }
  next();
};

module.exports = {
  authenticateToken,
  requireAdmin
};
