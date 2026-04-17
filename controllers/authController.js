const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const ActivityLog = require('../models/ActivityLog');
const emailService = require('../services/emailService');
const logger = require('../utils/logger');
const { ok, created, badRequest, unauthorized, notFound, serverError } = require('../utils/apiResponse');

/**
 * Auth Controller — Registration, Login, Forgot/Reset Password, Profile
 */

// Helper: generate JWT
const signToken = (userId) => {
    return jwt.sign({ id: userId }, process.env.JWT_SECRET || 'demo-secret-key', {
        expiresIn: process.env.JWT_EXPIRES_IN || '7d'
    });
};

// ── POST /api/v2/auth/register ──────────────────────────────────
exports.register = async (req, res) => {
    try {
        const { name, email, password, role, company } = req.body;

        // Check existing user
        const existing = await User.findOne({ email });
        if (existing) return badRequest(res, 'Email already registered');

        const user = await User.create({ name, email, password, role, company });
        const token = signToken(user._id);

        // Activity log
        ActivityLog.record({
            userId: user._id, action: 'user_register',
            description: `New user registered: ${email}`,
            targetModel: 'User', targetId: user._id,
            ip: req.ip
        }).catch(() => { });

        logger.info('User registered', { email, role: user.role });

        // Send welcome email
        logger.info('Attempting to send registration welcome email', { to: user.email });
        try {
            const emailResult = await emailService.sendEmail(user.email, 'registration_welcome', { name: user.name });
            if (emailResult.success) {
                logger.info('✅ Registration welcome email sent successfully', { to: user.email, messageId: emailResult.messageId });
            } else {
                logger.error('❌ Registration email failed', { to: user.email, error: emailResult.error });
            }
        } catch (emailErr) {
            logger.error('❌ Registration email threw exception', { to: user.email, error: emailErr.message });
        }

        return created(res, 'Registration successful', {
            token,
            user: { id: user._id, name: user.name, email: user.email, role: user.role, company: user.company }
        });
    } catch (error) {
        logger.error('Register error', { error: error.message });
        return serverError(res, 'Registration failed', error);
    }
};

// ── POST /api/v2/auth/login ─────────────────────────────────────
exports.login = async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await User.findOne({ email }).select('+password');

        if (!user) return unauthorized(res, 'Invalid email or password');
        if (user.isBlocked) return unauthorized(res, 'Account blocked. ' + (user.blockedReason || 'Contact admin.'));
        if (!user.isActive) return unauthorized(res, 'Account deactivated');

        const isMatch = await user.comparePassword(password);
        if (!isMatch) return unauthorized(res, 'Invalid email or password');

        // Update last login
        user.lastLogin = new Date();
        await user.save({ validateBeforeSave: false });

        const token = signToken(user._id);

        ActivityLog.record({
            userId: user._id, action: 'user_login',
            description: `User logged in: ${email}`,
            targetModel: 'User', targetId: user._id,
            ip: req.ip
        }).catch(() => { });

        return ok(res, 'Login successful', {
            token,
            user: { id: user._id, name: user.name, email: user.email, role: user.role, company: user.company, createdAt: user.createdAt }
        });
    } catch (error) {
        logger.error('Login error', { error: error.message });
        return serverError(res, 'Login failed', error);
    }
};

// ── GET /api/v2/auth/me ─────────────────────────────────────────
exports.getMe = async (req, res) => {
    try {
        const user = await User.findById(req.user._id);
        if (!user) return notFound(res, 'User not found');
        return ok(res, 'Profile fetched', { user });
    } catch (error) {
        return serverError(res, 'Failed to fetch profile', error);
    }
};

// ── POST /api/v2/auth/forgot-password ───────────────────────────
exports.forgotPassword = async (req, res) => {
    try {
        const user = await User.findOne({ email: req.body.email });
        if (!user) return notFound(res, 'No account with that email');

        const rawToken = user.createResetToken();
        await user.save({ validateBeforeSave: false });

        // Build reset URL (frontend route)
        const resetUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/reset-password/${rawToken}`;

        await emailService.sendEmail(user.email, 'password_reset', { resetUrl });

        ActivityLog.record({
            userId: user._id, action: 'password_reset_request',
            description: `Password reset requested for ${user.email}`,
            ip: req.ip
        }).catch(() => { });

        return ok(res, 'Password reset link sent to your email');
    } catch (error) {
        logger.error('Forgot password error', { error: error.message });
        return serverError(res, 'Failed to send reset email', error);
    }
};

// ── POST /api/v2/auth/reset-password ────────────────────────────
exports.resetPassword = async (req, res) => {
    try {
        const { token, password } = req.body;
        const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

        const user = await User.findOne({
            resetPasswordToken: hashedToken,
            resetPasswordExpires: { $gt: Date.now() }
        }).select('+resetPasswordToken +resetPasswordExpires');

        if (!user) return badRequest(res, 'Token is invalid or has expired');

        user.password = password;
        user.resetPasswordToken = undefined;
        user.resetPasswordExpires = undefined;
        await user.save();

        const newToken = signToken(user._id);

        ActivityLog.record({
            userId: user._id, action: 'password_reset_complete',
            description: `Password reset completed for ${user.email}`,
            ip: req.ip
        }).catch(() => { });

        return ok(res, 'Password has been reset', { token: newToken });
    } catch (error) {
        logger.error('Reset password error', { error: error.message });
        return serverError(res, 'Failed to reset password', error);
    }
};

// ── PUT /api/v2/auth/change-password ────────────────────────────
exports.changePassword = async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;
        const user = await User.findById(req.user._id).select('+password');

        const isMatch = await user.comparePassword(currentPassword);
        if (!isMatch) return badRequest(res, 'Current password is incorrect');

        user.password = newPassword;
        await user.save();

        const token = signToken(user._id);
        return ok(res, 'Password changed successfully', { token });
    } catch (error) {
        return serverError(res, 'Failed to change password', error);
    }
};
