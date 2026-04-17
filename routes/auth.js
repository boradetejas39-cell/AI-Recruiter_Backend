const express = require('express');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const { protect } = require('../middleware/auth');
const memoryStore = require('../utils/memoryStore');
const bcrypt = require('bcryptjs');
const { OAuth2Client } = require('google-auth-library');

const router = express.Router();

// Google OAuth client
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// Router-level logger for debugging
router.use((req, res, next) => {
  console.log('[AUTH ROUTER]', req.method, req.originalUrl);
  next();
});

/**
 * @route   POST /api/auth/register
 * @desc    Register a new user
 * @access  Public
 */
router.post('/register', [
  body('name')
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('Name must be between 2 and 100 characters'),
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Please provide a valid email'),
  body('password')
    .isLength({ min: 6 })
    .withMessage('Password must be at least 6 characters long'),
  body('role')
    .optional()
    .isIn(['hr', 'user'])
    .withMessage('Role must be hr or user')
], async (req, res) => {
  try {
    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { name, email, password, role = 'user', company } = req.body;

    // Check if user already exists (using the same store that login uses)
    const existingUser = await memoryStore.findOne({ email });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'User with this email already exists'
      });
    }

    // Create new user via memoryStore (hashes password with bcrypt automatically)
    const user = await memoryStore.create({
      name,
      email,
      password,
      role,
      company: company || ''
    });

    // Send welcome email
    try {
      const emailService = require('../services/emailService');
      const logger = require('../utils/logger');
      
      logger.info('Attempting to send registration welcome email', { to: user.email });
      const emailResult = await emailService.sendEmail(user.email, 'registration_welcome', { name: user.name });
      
      if (emailResult.success) {
        logger.info('✅ Registration welcome email sent successfully', { to: user.email, messageId: emailResult.messageId });
      } else {
        logger.error('❌ Registration email failed', { to: user.email, error: emailResult.error });
      }
    } catch (emailErr) {
      console.error('❌ Registration email exception:', emailErr.message);
    }

    // Generate JWT token
    const token = jwt.sign(
      { id: user._id },
      process.env.JWT_SECRET || 'demo-secret-key',
      { expiresIn: process.env.JWT_EXPIRE || '7d' }
    );

    res.status(201).json({
      success: true,
      message: 'User registered successfully',
      data: {
        token,
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
          company: user.company,
          createdAt: user.createdAt
        }
      }
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during registration'
    });
  }
});

/**
 * @route   POST /api/auth/google
 * @desc    Authenticate with Google (sign in or sign up)
 * @access  Public
 */
router.post('/google', async (req, res) => {
  try {
    const { credential, access_token, role } = req.body;

    if (!credential && !access_token) {
      return res.status(400).json({
        success: false,
        message: 'Google credential or access_token is required'
      });
    }

    let email, name, picture, googleId;

    if (credential) {
      // Verify ID token (from GoogleLogin component)
      let payload;
      try {
        const ticket = await googleClient.verifyIdToken({
          idToken: credential,
          audience: process.env.GOOGLE_CLIENT_ID
        });
        payload = ticket.getPayload();
      } catch (verifyError) {
        console.error('Google token verification failed:', verifyError.message);
        return res.status(401).json({
          success: false,
          message: 'Invalid Google token'
        });
      }
      ({ email, name, picture, sub: googleId } = payload);
    } else {
      // Verify access token (from useGoogleLogin hook — custom styled button)
      try {
        const https = require('https');
        const userInfo = await new Promise((resolve, reject) => {
          const req = https.get(
            'https://www.googleapis.com/oauth2/v3/userinfo',
            { headers: { Authorization: `Bearer ${access_token}` } },
            (resp) => {
              let data = '';
              resp.on('data', chunk => data += chunk);
              resp.on('end', () => {
                try { resolve(JSON.parse(data)); }
                catch (e) { reject(new Error('Invalid JSON from Google')); }
              });
            }
          );
          req.on('error', reject);
        });
        if (!userInfo || !userInfo.email) {
          return res.status(401).json({ success: false, message: 'Invalid Google access token' });
        }
        email = userInfo.email;
        name = userInfo.name;
        picture = userInfo.picture;
        googleId = userInfo.sub;
      } catch (err) {
        console.error('Google access_token verification failed:', err.message);
        return res.status(401).json({ success: false, message: 'Invalid Google access token' });
      }
    }
    console.log('🔍 Google auth for:', email, name);

    // Check if user already exists
    let user = await memoryStore.findOne({ email });

    if (user) {
      // Existing user — update Google ID if not set
      if (!user.googleId) {
        user.googleId = googleId;
        user.avatar = user.avatar || picture;
        await memoryStore.update(user._id, { googleId, avatar: user.avatar });
      }
      console.log('✅ Existing user logged in via Google:', email);
    } else {
      // New user — create account
      const salt = await bcrypt.genSalt(10);
      const randomPassword = await bcrypt.hash(Math.random().toString(36) + Date.now(), salt);

      user = await memoryStore.create({
        name,
        email,
        password: randomPassword,
        role: role || 'user',
        company: '',
        googleId,
        avatar: picture,
        isActive: true
      });
      console.log('✅ New user registered via Google:', email);

      // Send welcome email
      try {
        const emailService = require('../services/emailService');
        await emailService.sendEmail(user.email, 'registration_welcome', { name: user.name });
      } catch (err) {
        console.error('❌ Google registration email failed:', err.message);
      }
    }

    // Generate JWT token
    const token = jwt.sign(
      { id: user._id },
      process.env.JWT_SECRET || 'demo-secret-key',
      { expiresIn: process.env.JWT_EXPIRE || '7d' }
    );

    res.json({
      success: true,
      message: user ? 'Google login successful' : 'Google registration successful',
      data: {
        token,
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
          company: user.company || '',
          avatar: user.avatar || picture,
          createdAt: user.createdAt
        }
      }
    });
  } catch (error) {
    console.error('Google auth error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during Google authentication'
    });
  }
});

/**
 * @route   POST /api/auth/login
 * @desc    Login user
 * @access  Public
 */
router.post('/login', [
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Please provide a valid email'),
  body('password')
    .notEmpty()
    .withMessage('Password is required')
], async (req, res) => {
  try {
    console.log('🔍 Login request received:', req.body);

    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      console.log('❌ Validation errors:', errors.array());
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { email, password } = req.body;
    console.log('📧 Email:', email);
    console.log('🔑 Password length:', password.length);

    // Use memory store
    const user = await memoryStore.findOne({ email });
    console.log('🔍 Found user:', user ? user.email : 'Not found');

    if (!user) {
      console.log('❌ User not found');
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Check if user is active
    if (!user.isActive) {
      console.log('❌ User is not active');
      return res.status(401).json({
        success: false,
        message: 'Account is deactivated. Please contact administrator.'
      });
    }

    // Check password using bcrypt
    console.log('🔐 Checking password...');
    const isPasswordValid = await bcrypt.compare(password, user.password);
    console.log('✅ Password match:', isPasswordValid);

    if (!isPasswordValid) {
      console.log('❌ Password mismatch');
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    console.log('✅ Authentication successful');

    // Update last login
    user.lastLogin = new Date();

    // Generate JWT token
    const token = jwt.sign(
      { id: user._id },
      process.env.JWT_SECRET || 'demo-secret-key',
      { expiresIn: process.env.JWT_EXPIRE || '7d' }
    );

    console.log('🎫 Token generated successfully');

    const responseData = {
      success: true,
      message: 'Login successful',
      data: {
        token,
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
          company: user.company,
          createdAt: user.createdAt
        }
      }
    };

    console.log('📤 Sending response:', responseData);
    res.json(responseData);
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during login'
    });
  }
});

/**
 * @route   GET /api/auth/me
 * @desc    Get current user profile
 * @access  Private
 */
router.get('/me', protect, async (req, res) => {
  try {
    const user = req.user;

    res.json({
      success: true,
      data: {
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
          company: user.company,
          createdAt: user.createdAt,
          lastLogin: user.lastLogin,
          isActive: user.isActive
        }
      }
    });
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error fetching profile'
    });
  }
});

/**
 * @route   PUT /api/auth/profile
 * @desc    Update user profile
 * @access  Private
 */
router.put('/profile', protect, [
  body('name')
    .optional()
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('Name must be between 2 and 100 characters'),
  body('email')
    .optional()
    .isEmail()
    .normalizeEmail()
    .withMessage('Please provide a valid email')
], async (req, res) => {
  try {
    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { name, email, company } = req.body;

    // Check if email is already taken by another user
    if (email) {
      const existingUser = await memoryStore.findOne({ email });
      if (existingUser && existingUser._id.toString() !== req.user._id.toString()) {
        return res.status(400).json({
          success: false,
          message: 'Email is already taken by another user'
        });
      }
    }

    const updateData = {};
    if (name) updateData.name = name;
    if (email) updateData.email = email;
    if (company !== undefined) updateData.company = company;
    updateData.updatedAt = new Date();

    const updatedUser = await memoryStore.findByIdAndUpdate(req.user._id, updateData, { new: true });

    if (!updatedUser) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.json({
      success: true,
      message: 'Profile updated successfully',
      data: {
        user: {
          id: updatedUser._id,
          name: updatedUser.name,
          email: updatedUser.email,
          role: updatedUser.role,
          company: updatedUser.company,
          updatedAt: updatedUser.updatedAt
        }
      }
    });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error updating profile'
    });
  }
});

/**
 * @route   POST /api/auth/change-password
 * @desc    Change user password
 * @access  Private
 */
router.post('/change-password', protect, [
  body('currentPassword')
    .notEmpty()
    .withMessage('Current password is required'),
  body('newPassword')
    .isLength({ min: 6 })
    .withMessage('New password must be at least 6 characters long')
], async (req, res) => {
  try {
    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { currentPassword, newPassword } = req.body;

    // Get user with password from store
    const user = await memoryStore.findById(req.user._id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Verify current password using bcrypt
    const isPasswordValid = await bcrypt.compare(currentPassword, user.password);
    if (!isPasswordValid) {
      return res.status(400).json({
        success: false,
        message: 'Current password is incorrect'
      });
    }

    // Hash new password and update
    const hashedPassword = await bcrypt.hash(newPassword, 12);
    await memoryStore.findByIdAndUpdate(req.user._id, {
      password: hashedPassword,
      updatedAt: new Date()
    });

    res.json({
      success: true,
      message: 'Password changed successfully'
    });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error changing password'
    });
  }
});

/**
 * @route   POST /api/auth/logout
 * @desc    Logout user (client-side token removal)
 * @access  Private
 */
router.post('/logout', protect, async (req, res) => {
  // In a stateless JWT implementation, logout is handled client-side
  // by removing the token from storage
  res.json({
    success: true,
    message: 'Logout successful'
  });
});

/**
 * @route   POST /api/auth/refresh-token
 * @desc    Refresh JWT token
 * @access  Private
 */
router.post('/refresh-token', protect, async (req, res) => {
  try {
    // Generate new token
    const token = jwt.sign(
      { id: req.user._id },
      process.env.JWT_SECRET || 'demo-secret-key',
      { expiresIn: process.env.JWT_EXPIRE || '7d' }
    );

    res.json({
      success: true,
      message: 'Token refreshed successfully',
      data: { token }
    });
  } catch (error) {
    console.error('Refresh token error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error refreshing token'
    });
  }
});

module.exports = router;
