const jwt = require('jsonwebtoken');
const memoryStore = require('../utils/memoryStore');
const User = require('../models/User');

// ─────────────────────────────────────────────────────────────────────────────
// Role constants  (single source of truth — import these in routes if needed)
// ─────────────────────────────────────────────────────────────────────────────
const ROLES = {
  ADMIN: 'admin',
  HR: 'hr',
  RECRUITER: 'recruiter',
  USER: 'user'
};

// ─────────────────────────────────────────────────────────────────────────────
// Helper: load the user record from whichever store is active
// ─────────────────────────────────────────────────────────────────────────────
async function getUserById(id) {
  let mongoUser = null;
  try {
    // Try MongoDB first (Primary database)
    mongoUser = await User.findById(id);
  } catch (error) {
    console.warn('MongoDB query timed out or failed, falling back to local memory storage...');
  }
  
  if (mongoUser) return mongoUser;

  try {
    // Try memory store next (Legacy/Dev fallback)
    const user = await memoryStore.findById(id);
    if (user) return user;

    // Fall back to file-based database
    const users = global.fileDB ? global.fileDB.read('users') : (global.users || []);
    return users.find(u => u._id.toString() === id) || null;
  } catch (error) {
    console.error('Error getting user by ID:', error);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// protect  — verify JWT and attach req.user
// ─────────────────────────────────────────────────────────────────────────────
const protect = async (req, res, next) => {
  try {
    let token;

    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Access denied. No token provided.'
      });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET || 'demo-secret-key');
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({ success: false, message: 'Token expired. Please log in again.' });
      }
      return res.status(401).json({ success: false, message: 'Invalid token.' });
    }

    const user = await getUserById(decoded.id);

    if (!user) {
      return res.status(401).json({ success: false, message: 'User associated with this token no longer exists.' });
    }

    if (user.isActive === false) {
      return res.status(401).json({ success: false, message: 'Your account has been deactivated. Please contact the administrator.' });
    }

    // Check if user is blocked
    if (user.isBlocked) {
      return res.status(403).json({ success: false, message: 'Your account has been blocked. Reason: ' + (user.blockedReason || 'Contact administrator.') });
    }

    req.user = user;
    next();
  } catch (error) {
    console.error('[Auth] protect middleware error:', error);
    res.status(500).json({ success: false, message: 'Server error during authentication.' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// authorize(...roles)  — generic role-gate factory
//
//   Usage in routes:
//     router.delete('/users/:id', protect, authorize('admin'), handler)
//     router.post('/jobs',        protect, authorize('hr', 'admin'), handler)
// ─────────────────────────────────────────────────────────────────────────────
const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Authentication required.' });
    }

    const userRole = (req.user.role || '').toLowerCase();
    const allowedRoles = roles.map(r => r.toLowerCase());

    if (!allowedRoles.includes(userRole)) {
      console.warn(
        `[RBAC] DENIED  user=${req.user.email}  role=${req.user.role}  ` +
        `required=${roles.join('|')}  route=${req.method} ${req.originalUrl}`
      );
      return res.status(403).json({
        success: false,
        message: `Access denied. This resource requires one of the following roles: ${roles.join(', ')}.`
      });
    }

    console.info(
      `[RBAC] GRANTED user=${req.user.email}  role=${req.user.role}  ` +
      `route=${req.method} ${req.originalUrl}`
    );
    next();
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// Convenience role guards  (pre-built, use directly in routes)
// ─────────────────────────────────────────────────────────────────────────────

/** Only Administrators — system configuration, user management */
const adminOnly = authorize(ROLES.ADMIN);

/** Only HR — daily recruitment operations */
const hrOnly = authorize(ROLES.HR);

/** Only Recruiter */
const recruiterOnly = authorize(ROLES.RECRUITER);

/** HR, Recruiter, or Admin — shared operational features */
const hrOrAdmin = authorize(ROLES.HR, ROLES.ADMIN, ROLES.RECRUITER);

// ─────────────────────────────────────────────────────────────────────────────
// checkOwnership  — user must own the resource OR be an admin
//
//   Usage:
//     router.put('/resumes/:id', protect, checkOwnership('resume'), handler)
//   Requires `req.resource` to be set before this middleware runs.
// ─────────────────────────────────────────────────────────────────────────────
const checkOwnership = (resourceField = 'resource') => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Authentication required.' });
    }

    // Admins bypass ownership checks
    if (req.user.role === ROLES.ADMIN) return next();

    const resource = req[resourceField];
    if (!resource) {
      return res.status(400).json({ success: false, message: 'Resource not found in request context.' });
    }

    const ownerId = (resource.uploadedBy || resource.createdBy || resource).toString();
    if (ownerId !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: 'Access denied. You can only modify your own resources.' });
    }

    next();
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// optionalAuth  — attach user if a valid token is present, but never block
// ─────────────────────────────────────────────────────────────────────────────
const optionalAuth = async (req, res, next) => {
  try {
    const header = req.headers.authorization;
    if (header && header.startsWith('Bearer')) {
      const token = header.split(' ')[1];
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'demo-secret-key');
        const user = await getUserById(decoded.id);
        if (user && user.isActive) req.user = user;
      } catch {
        // Silently ignore invalid / expired tokens for optional auth
      }
    }
    next();
  } catch (error) {
    console.error('[Auth] optionalAuth error:', error);
    next();
  }
};

module.exports = {
  ROLES,
  protect,
  authorize,
  adminOnly,
  hrOnly,
  recruiterOnly,
  hrOrAdmin,
  checkOwnership,
  optionalAuth
};
