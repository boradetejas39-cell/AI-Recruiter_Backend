const rateLimit = require('express-rate-limit');

/**
 * Granular Rate Limiters
 * Different endpoints need different throttling thresholds.
 *
 * Usage:
 *   const { authLimiter, uploadLimiter } = require('../middleware/rateLimiter');
 *   router.post('/login', authLimiter, controller.login);
 */

// ── Auth endpoints (brute-force protection) ─────────────────────────
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,   // 15 minutes
    max: process.env.NODE_ENV === 'production' ? 15 : 100,  // generous in dev
    message: { success: false, message: 'Too many login attempts. Please try again after 15 minutes.' },
    standardHeaders: true,
    legacyHeaders: false
});

// ── File upload endpoints ───────────────────────────────────────────
const uploadLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,   // 1 hour
    max: 30,                      // 30 uploads per hour
    message: { success: false, message: 'Upload limit reached. Try again later.' },
    standardHeaders: true,
    legacyHeaders: false
});

// ── General API endpoints ───────────────────────────────────────────
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 200,
    message: { success: false, message: 'Too many requests. Please slow down.' },
    standardHeaders: true,
    legacyHeaders: false
});

// ── AI-heavy endpoints (interview, screening) ──────────────────────
const aiLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,   // 1 hour
    max: 50,                      // 50 AI calls per hour
    message: { success: false, message: 'AI processing limit reached. Try again later.' },
    standardHeaders: true,
    legacyHeaders: false
});

module.exports = { authLimiter, uploadLimiter, apiLimiter, aiLimiter };
