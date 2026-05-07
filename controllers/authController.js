const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const ActivityLog = require('../models/ActivityLog');
const emailService = require('../services/emailService');
const logger = require('../utils/logger');
const { ok, created, badRequest, unauthorized, notFound, serverError } = require('../utils/apiResponse');
const { OAuth2Client } = require('google-auth-library');

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

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
    const startTime = Date.now();
    try {
        const { name, email, password, role, company } = req.body;
        logger.info(`[Auth] Registration attempt started for: ${email}`, { role });

        // Check existing user
        const existing = await User.findOne({ email });
        if (existing) {
            logger.warn(`[Auth] Registration failed: Email ${email} already exists`);
            return badRequest(res, 'Email already registered');
        }
        logger.info(`[Auth] Email check passed for ${email} in ${Date.now() - startTime}ms`);
        const user = await User.create({ name, email, password, role, company });
        logger.info(`[Auth] User created in DB for ${email} in ${Date.now() - startTime}ms`);
        
        const token = signToken(user._id);
        logger.info(`[Auth] Token generated for ${email} in ${Date.now() - startTime}ms`);

        // Activity log
        ActivityLog.record({
            userId: user._id, action: 'user_register',
            description: `New user registered: ${email}`,
            targetModel: 'User', targetId: user._id,
            ip: req.ip
        }).catch(() => { });

        logger.info('User registered', { email, role: user.role });

        // Send welcome email (Non-blocking)
        logger.info('Queueing registration welcome email', { to: user.email });
        emailService.sendEmail(user.email, 'registration_welcome', { name: user.name })
            .then(result => {
                if (result.success) {
                    logger.info('✅ Registration welcome email sent successfully', { to: user.email, messageId: result.messageId });
                } else {
                    logger.error('❌ Registration email failed', { to: user.email, error: result.error });
                }
            })
            .catch(err => {
                logger.error('❌ Registration email exception', { to: user.email, error: err.message });
            });

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

// ── POST /api/v2/auth/google ────────────────────────────────────
exports.googleLogin = async (req, res) => {
    try {
        const { credential, access_token, role } = req.body;

        if (!credential && !access_token) {
            return badRequest(res, 'Google credential or access_token is required');
        }

        let email, name, picture, googleId;

        if (credential) {
            // Verify ID token
            try {
                const ticket = await googleClient.verifyIdToken({
                    idToken: credential,
                    audience: process.env.GOOGLE_CLIENT_ID
                });
                const payload = ticket.getPayload();
                ({ email, name, picture, sub: googleId } = payload);
            } catch (err) {
                logger.error('Google ID token verification failed', { error: err.message });
                return unauthorized(res, 'Invalid Google token');
            }
        } else {
            // Verify access token via Google API
            try {
                const axios = require('axios');
                const response = await axios.get('https://www.googleapis.com/oauth2/v3/userinfo', {
                    headers: { Authorization: `Bearer ${access_token}` }
                });
                ({ email, name, picture, sub: googleId } = response.data);
            } catch (err) {
                logger.error('Google access_token verification failed', { error: err.message });
                return unauthorized(res, 'Invalid Google access token');
            }
        }

        if (!email) return badRequest(res, 'Could not retrieve email from Google');

        // Check if user exists
        let user = await User.findOne({ email });

        if (user) {
            // Existing user — link Google ID if not set
            if (!user.googleId) {
                user.googleId = googleId;
                if (!user.avatar) user.avatar = picture;
                await user.save({ validateBeforeSave: false });
            }
            logger.info('User logged in via Google', { email });
        } else {
            // New user — create account
            const randomPassword = crypto.randomBytes(16).toString('hex');
            user = await User.create({
                name,
                email,
                password: randomPassword,
                role: role || 'user',
                googleId,
                avatar: picture,
                isActive: true
            });
            logger.info('New user registered via Google', { email, role: user.role });

            // Send welcome email (Non-blocking)
            logger.info('Queueing Google welcome email', { to: user.email });
            emailService.sendEmail(user.email, 'registration_welcome', { name: user.name })
                .then(result => {
                    if (result.success) {
                        logger.info('✅ Google welcome email sent successfully', { to: user.email });
                    } else {
                        logger.error('❌ Google welcome email failed', { to: user.email, error: result.error });
                    }
                })
                .catch(err => {
                    logger.error('❌ Google welcome email exception', { to: user.email, error: err.message });
                });
        }

        // Check if blocked
        if (user.isBlocked) return unauthorized(res, 'Account blocked');

        // Update last login
        user.lastLogin = new Date();
        await user.save({ validateBeforeSave: false });

        const token = signToken(user._id);

        ActivityLog.record({
            userId: user._id, action: 'user_google_login',
            description: `User logged in via Google: ${email}`,
            ip: req.ip
        }).catch(() => { });

        return ok(res, 'Google authentication successful', {
            token,
            user: { id: user._id, name: user.name, email: user.email, role: user.role, avatar: user.avatar }
        });
    } catch (error) {
        logger.error('Google auth error', { error: error.message });
        return serverError(res, 'Google authentication failed', error);
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
