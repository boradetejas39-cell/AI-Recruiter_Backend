const express = require('express');
const router = express.Router();

const authController = require('../../controllers/authController');
const validate = require('../../middleware/validate');
const { auth: schemas } = require('../../utils/validators');
const { authLimiter } = require('../../middleware/rateLimiter');

/**
 * V2 Auth Routes
 * Prefix: /api/v2/auth
 */

// Public routes with rate limiting
router.post('/register', authLimiter, validate(schemas.register), authController.register);
router.post('/login', authLimiter, validate(schemas.login), authController.login);
router.post('/forgot-password', authLimiter, validate(schemas.forgotPassword), authController.forgotPassword);
router.put('/reset-password/:token', validate(schemas.resetPassword), authController.resetPassword);

// Protected routes
const { protect } = require('../../middleware/auth');
router.get('/me', protect, authController.getMe);
router.put('/change-password', protect, validate(schemas.changePassword), authController.changePassword);

module.exports = router;
