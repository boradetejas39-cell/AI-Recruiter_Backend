/**
 * Standardized API Response Helper
 * Ensures every API response follows a consistent format:
 *   { success: Boolean, message: String, data?: Any, meta?: Object }
 *
 * Usage in controllers:
 *   const { ok, created, badRequest, notFound, forbidden, serverError } = require('../utils/apiResponse');
 *   return ok(res, 'Users fetched', users, { page: 1, total: 50 });
 */

// ── Success responses ──────────────────────────────────────────────

/** 200 OK */
const ok = (res, message = 'Success', data = null, meta = null) =>
    res.status(200).json({ success: true, message, data, ...(meta && { meta }) });

/** 201 Created */
const created = (res, message = 'Resource created', data = null) =>
    res.status(201).json({ success: true, message, data });

/** 204 No Content (used for deletes) */
const noContent = (res) => res.status(204).send();

// ── Client-error responses ─────────────────────────────────────────

/** 400 Bad Request */
const badRequest = (res, message = 'Bad request', errors = null) =>
    res.status(400).json({ success: false, message, ...(errors && { errors }) });

/** 401 Unauthorized */
const unauthorized = (res, message = 'Authentication required') =>
    res.status(401).json({ success: false, message });

/** 403 Forbidden */
const forbidden = (res, message = 'Access denied') =>
    res.status(403).json({ success: false, message });

/** 404 Not Found */
const notFound = (res, message = 'Resource not found') =>
    res.status(404).json({ success: false, message });

/** 409 Conflict */
const conflict = (res, message = 'Resource already exists') =>
    res.status(409).json({ success: false, message });

/** 422 Unprocessable Entity (validation) */
const validationError = (res, errors) =>
    res.status(422).json({ success: false, message: 'Validation failed', errors });

/** 429 Too Many Requests */
const tooMany = (res, message = 'Too many requests. Please try again later.') =>
    res.status(429).json({ success: false, message });

// ── Server-error responses ─────────────────────────────────────────

/** 500 Internal Server Error */
const serverError = (res, message = 'Internal server error', error = null) =>
    res.status(500).json({
        success: false,
        message,
        ...(process.env.NODE_ENV === 'development' && error && { error: error.message, stack: error.stack })
    });

module.exports = {
    ok,
    created,
    noContent,
    badRequest,
    unauthorized,
    forbidden,
    notFound,
    conflict,
    validationError,
    tooMany,
    serverError
};
