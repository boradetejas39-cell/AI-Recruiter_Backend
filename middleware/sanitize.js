/**
 * Input Sanitization Middleware
 * Prevents XSS by stripping HTML tags, script injections, and dangerous
 * characters from all string values in req.body, req.query, and req.params.
 *
 * Uses the lightweight `xss` library for HTML entity encoding.
 * Mount globally in server.js:
 *   app.use(sanitize);
 */

let xss;
try {
    xss = require('xss');
} catch {
    // Fallback: basic sanitiser when xss package is not installed
    xss = (str) => str.replace(/<[^>]*>/g, '').replace(/[<>"'&]/g, '');
}

/**
 * Recursively sanitise every string value in an object or array.
 */
function deepSanitize(value) {
    if (typeof value === 'string') {
        return xss(value);
    }
    if (Array.isArray(value)) {
        return value.map(deepSanitize);
    }
    if (value !== null && typeof value === 'object') {
        const clean = {};
        for (const [k, v] of Object.entries(value)) {
            clean[k] = deepSanitize(v);
        }
        return clean;
    }
    return value; // numbers, booleans, dates, null — pass through
}

/**
 * Express middleware — sanitise body, query, and params
 */
function sanitize(req, _res, next) {
    if (req.body) req.body = deepSanitize(req.body);
    if (req.query) req.query = deepSanitize(req.query);
    if (req.params) req.params = deepSanitize(req.params);
    next();
}

module.exports = sanitize;
