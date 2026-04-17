const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
// Load .env: try backend/.env first, then root .env (for Render vs local dev)
const fs = require('fs');
const localEnv = path.join(__dirname, '.env');
const rootEnv = path.join(__dirname, '..', '.env');
require('dotenv').config({ path: fs.existsSync(localEnv) ? localEnv : rootEnv });
const connectDB = require('./utils/db');

// Import legacy (v1) routes
const authRoutes = require('./routes/auth');
const jobRoutes = require('./routes/jobs');
const resumeRoutes = require('./routes/resumes');
const matchRoutes = require('./routes/matches');
const dashboardRoutes = require('./routes/dashboard');
const adminRoutes = require('./routes/admin');
const jobStatusService = require('./services/jobStatusService');

// Import v2 routes (production MVC)
const v2AuthRoutes = require('./routes/v2/auth');
const v2JobRoutes = require('./routes/v2/jobs');
const v2ApplicationRoutes = require('./routes/v2/applications');
const v2InterviewRoutes = require('./routes/v2/interviews');
const v2PipelineRoutes = require('./routes/v2/pipeline');
const v2AnalyticsRoutes = require('./routes/v2/analytics');
const v2NotificationRoutes = require('./routes/v2/notifications');
const v2AdminRoutes = require('./routes/v2/admin');

// Import production middleware & utils
const logger = require('./utils/logger');
const sanitize = require('./middleware/sanitize');

// Initialize Express app
const app = express();

// Simple request logger for debugging
app.use((req, res, next) => {
  console.log('[REQ]', req.method, req.originalUrl);
  next();
});

// Structured request logging (production)
app.use(logger.requestLogger);

// Security middleware
app.use(helmet());

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.NODE_ENV === 'production' ? 100 : 1000 // generous limit in dev
});
app.use(limiter);

// CORS configuration
app.use(cors({
  origin: function (origin, callback) {
    // Dynamically allow any origin this request is coming from
    // This perfectly bypasses CORS blocks for Vercel preview & production URLs
    callback(null, true);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept']
}));

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Input sanitization (XSS protection)
app.use(sanitize);

// Static files
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ── Legacy (v1) Routes ──────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/jobs', jobRoutes);
app.use('/api/resumes', resumeRoutes);
app.use('/api/matches', matchRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/admin', adminRoutes);

// ── V2 Production Routes (MVC) ─────────────────────────────────
app.use('/api/v2/auth', v2AuthRoutes);
app.use('/api/v2/jobs', v2JobRoutes);
app.use('/api/v2/applications', v2ApplicationRoutes);
app.use('/api/v2/interviews', v2InterviewRoutes);
app.use('/api/v2/pipeline', v2PipelineRoutes);
app.use('/api/v2/analytics', v2AnalyticsRoutes);
app.use('/api/v2/notifications', v2NotificationRoutes);
app.use('/api/v2/admin', v2AdminRoutes);

// Root endpoint (for Render health checks & direct visits)
app.get('/', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'AI Recruiter API is running',
    version: '2.0',
    health: '/api/health',
    timestamp: new Date().toISOString()
  });
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    message: 'AI Recruiter API is running',
    timestamp: new Date().toISOString()
  });
});

// Job status management endpoints
app.get('/api/jobs/status/update', async (req, res) => {
  try {
    const result = await jobStatusService.updateJobStatuses();
    res.status(200).json({
      success: true,
      message: 'Job statuses updated successfully',
      data: result
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to update job statuses',
      error: error.message
    });
  }
});

app.get('/api/jobs/:id/status', async (req, res) => {
  try {
    const jobId = req.params.id;
    const result = jobStatusService.getJobStatus({ _id: jobId });

    if (!result) {
      return res.status(404).json({
        success: false,
        message: 'Job not found'
      });
    }

    res.status(200).json({
      success: true,
      data: result
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to get job status',
      error: error.message
    });
  }
});

// NOTE: Frontend is deployed separately on Vercel.
// No static file serving needed here — backend is API-only on Render.

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    success: false,
    message: 'Something went wrong!',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// 404 handler (must be last)
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found'
  });
});

// Database connection and server start
const startServer = () => {
  const PORT = process.env.PORT || 5001;
  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV}`);
  });
};

connectDB()
  .then((connected) => {
    if (connected) {
      console.log('Database connection: Connected');
      console.log('🔄 Starting automatic job status scheduler...');

      // Run status updates every hour
      setInterval(async () => {
        await jobStatusService.updateJobStatuses();
      }, 60 * 60 * 1000);

      // Run initial status update after 5 seconds
      setTimeout(async () => {
        await jobStatusService.updateJobStatuses();
      }, 5000);
    } else {
      console.log('Database connection: Not connected (starting server without database)');
      console.log('Note: Database features will not be available.');
    }
    startServer();
  })
  .catch((err) => {
    console.error('Unexpected error:', err.message || err);
    console.log('Starting server anyway...');
    startServer();
  });
