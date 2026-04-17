const express = require('express');
const mongoose = require('mongoose');
const { body, validationResult } = require('express-validator');
const Job = require('../models/Job');
const { protect, hrOrAdmin, authorize, checkOwnership } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');

/** True when Mongoose has an active MongoDB connection */
const isMongoConnected = () => mongoose.connection.readyState === 1;

const router = express.Router();

// All routes are protected
router.use(protect);

/**
 * @route   POST /api/jobs/apply
 * @desc    Apply for a job
 * @access  Private
 */
router.post('/apply', asyncHandler(async (req, res) => {
  try {
    const { jobId, resumeId, coverLetter } = req.body;

    if (!jobId || !resumeId) {
      return res.status(400).json({
        success: false,
        message: 'Job ID and Resume ID are required'
      });
    }

    // Check if job exists
    let job;
    if (!isMongoConnected() && global.fileDB) {
      const jobs = global.fileDB.read('jobs');
      job = jobs.find(j => j._id === jobId);
    } else {
      job = await Job.findById(jobId);
    }

    if (!job) {
      return res.status(404).json({
        success: false,
        message: 'Job not found'
      });
    }

    // Check if resume exists and belongs to user
    let resume;
    if (!isMongoConnected() && global.fileDB) {
      const resumes = global.fileDB.read('resumes');
      resume = resumes.find(r => r._id === resumeId && r.uploadedBy === req.user._id);
    } else {
      const Resume = require('../models/Resume');
      resume = await Resume.findOne({ _id: resumeId, uploadedBy: req.user._id });
    }

    if (!resume) {
      return res.status(404).json({
        success: false,
        message: 'Resume not found or does not belong to you'
      });
    }

    // Create application
    let application;
    
    if (!isMongoConnected() && global.fileDB) {
      application = {
        _id: Date.now().toString(),
        jobId: jobId,
        jobTitle: job.title,
        company: job.company,
        candidateId: req.user._id,
        userName: req.user.name,
        userEmail: req.user.email,
        resumeId: resumeId,
        coverLetter: coverLetter || '',
        currentStage: 'applied',
        appliedAt: new Date().toISOString()
      };
      global.fileDB.add('applications', application);
    } else {
      // MongoDB path
      const Application = require('../models/Application');
      const aiScreeningService = require('../services/aiScreeningService');
      
      // Check for existing application
      const existingApp = await Application.findOne({ jobId, resumeId });
      if (existingApp) {
        return res.status(400).json({
          success: false,
          message: 'You have already applied for this job with this resume'
        });
      }

      // Perform AI screening
      let screeningResult = null;
      try {
        const Resume = require('../models/Resume');
        const [jobDoc, resumeDoc] = await Promise.all([
          Job.findById(jobId),
          Resume.findById(resumeId)
        ]);
        
        if (jobDoc && resumeDoc) {
          screeningResult = await aiScreeningService.screenCandidate(jobDoc, resumeDoc);
        }
      } catch (err) {
        console.error('AI screening failed during application submission:', err);
        // We continue anyway, just without the screening result
      }

      const newApplication = new Application({
        jobId,
        resumeId,
        candidateId: req.user._id,
        coverLetter: coverLetter || '',
        currentStage: 'applied',
        screeningResult: screeningResult || undefined
      });
      
      await newApplication.save();
      application = newApplication;
    }

    console.log('✅ Job application submitted:', req.user.email, 'for job:', job.title);

    res.status(201).json({
      success: true,
      message: 'Application submitted successfully',
      data: application
    });
  } catch (error) {
    console.error('❌ Job application error:', error);
    res.status(500).json({
      success: false,
      message: 'Error submitting application. Please try again.'
    });
  }
}));

/**
 * @route   GET /api/jobs/my-applications
 * @desc    Get current user's job applications
 * @access  Private
 */
router.get('/my-applications', asyncHandler(async (req, res) => {
  try {
    let applications;

    if (!isMongoConnected() && global.fileDB) {
      // File-based database path
      const allApplications = global.fileDB.read('applications') || [];
      applications = allApplications.filter(app => app.candidateId === req.user._id || app.userId === req.user._id);
    } else {
      // MongoDB path
      const Application = require('../models/Application');
      applications = await Application.find({ candidateId: req.user._id })
        .populate('jobId', 'title company location')
        .populate('resumeId', 'candidateName email');
    }

    res.json({
      success: true,
      data: { applications }
    });
  } catch (error) {
    console.error('Error fetching applications:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching applications'
    });
  }
}));

/**
 * @route   GET /api/jobs
 * @desc    Get all jobs (for users)
 * @access  Private
 */
router.get('/', asyncHandler(async (req, res) => {
  try {
    let jobs;

    if (!isMongoConnected() && global.fileDB) {
      // File-based database path
      jobs = global.fileDB.read('jobs');
      // Filter only active jobs for regular users
      jobs = jobs.filter(job => job.status === 'active');
    } else {
      // MongoDB path
      jobs = await Job.find({ status: 'active' });
    }

    res.json({
      success: true,
      data: { jobs }
    });
  } catch (error) {
    console.error('Error fetching jobs:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching jobs'
    });
  }
}));

/**
 * @route   POST /api/jobs
 * @desc    Create a new job
 * @access  Private (HR, Admin)
 */
router.post('/', authorize('hr', 'admin'), [
  body('title')
    .trim()
    .isLength({ min: 2, max: 200 })
    .withMessage('Job title must be between 2 and 200 characters'),
  body('description')
    .trim()
    .isLength({ min: 10, max: 5000 })
    .withMessage('Job description must be between 10 and 5000 characters'),
  body('requiredSkills')
    .isArray({ min: 1 })
    .withMessage('At least one required skill must be specified'),
  body('requiredSkills.*')
    .trim()
    .isLength({ min: 2 })
    .withMessage('Each skill must be at least 2 characters long'),
  body('location')
    .trim()
    .isLength({ min: 2, max: 200 })
    .withMessage('Location must be between 2 and 200 characters'),
  body('experienceRequired.min')
    .optional()
    .isInt({ min: 0 })
    .withMessage('Minimum experience must be a non-negative integer'),
  body('experienceRequired.max')
    .optional()
    .isInt({ min: 0 })
    .withMessage('Maximum experience must be a non-negative integer'),
  body('jobType')
    .optional()
    .isIn(['full-time', 'part-time', 'contract', 'internship', 'remote'])
    .withMessage('Invalid job type'),
  body('department')
    .optional()
    .trim()
    .isLength({ max: 100 })
    .withMessage('Department cannot exceed 100 characters'),
  body('priority')
    .optional()
    .isIn(['low', 'medium', 'high', 'urgent'])
    .withMessage('Invalid priority level')
], asyncHandler(async (req, res) => {
  // Check for validation errors
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array()
    });
  }

  const jobData = {
    ...req.body,
    status: req.body.status || 'active', // Default to active if not provided
    createdBy: req.user._id.toString() // Convert to string for file-based DB
  };

  // For file-based database, save to file instead of MongoDB
  if (!isMongoConnected() && global.fileDB) {
    const jobs = global.fileDB.read('jobs');
    const newJob = {
      _id: Date.now().toString(),
      ...jobData,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    jobs.push(newJob);
    global.fileDB.write('jobs', jobs);

    // Add user info to response
    newJob.createdBy = {
      _id: req.user._id,
      name: req.user.name,
      email: req.user.email
    };

    res.status(201).json({
      success: true,
      message: 'Job created successfully',
      data: { job: newJob }
    });
  } else {
    // MongoDB path (for production)
    const job = await Job.create(jobData);
    await job.populate('createdBy', 'name email');

    res.status(201).json({
      success: true,
      message: 'Job created successfully',
      data: { job }
    });
  }
}));

/**
 * @route   GET /api/jobs
 * @desc    Get all jobs with filtering and pagination
 * @access  Private
 */
router.get('/', asyncHandler(async (req, res) => {
  console.log('📋 GET /api/jobs request received');
  console.log('👤 User:', req.user ? { id: req.user._id, email: req.user.email } : 'No user');
  console.log('📋 Query params:', req.query);

  const {
    page = 1,
    limit = 10,
    status = 'active',
    search,
    jobType,
    department,
    priority,
    sortBy = 'createdAt',
    sortOrder = 'desc'
  } = req.query;

  // Build query
  const query = {};

  if (status !== 'all') {
    query.status = status;
  }

  if (jobType) {
    query.jobType = jobType;
  }

  if (department) {
    query.department = department;
  }

  if (priority) {
    query.priority = priority;
  }

  // Build sort options
  const sortOptions = {};
  sortOptions[sortBy] = sortOrder === 'desc' ? -1 : 1;

  // Execute query with pagination
  const pageNum = parseInt(page);
  const limitNum = parseInt(limit);
  const skip = (pageNum - 1) * limitNum;

  let jobs;
  let total;

  if (!isMongoConnected() && global.fileDB) {
    // File-based database path
    const allJobs = global.fileDB.read('jobs');
    const users = global.fileDB.read('users');

    // Filter jobs based on query
    let filteredJobs = allJobs.filter(job => {
      if (status !== 'all' && job.status !== status) return false;
      if (jobType && job.jobType !== jobType) return false;
      if (department && job.department !== department) return false;
      if (priority && job.priority !== priority) return false;
      if (search) {
        const searchText = search.toLowerCase();
        return job.title.toLowerCase().includes(searchText) ||
          job.description.toLowerCase().includes(searchText) ||
          job.requiredSkills.some(skill => skill.toLowerCase().includes(searchText));
      }
      return true;
    });

    // Add user info to jobs
    filteredJobs = filteredJobs.map(job => {
      const creator = users.find(u => u._id === job.createdBy);
      return {
        ...job,
        createdBy: creator ? {
          _id: creator._id,
          name: creator.name,
          email: creator.email
        } : null
      };
    });

    // Sort jobs
    filteredJobs.sort((a, b) => {
      const aValue = a[sortBy];
      const bValue = b[sortBy];
      if (sortOrder === 'desc') {
        return new Date(bValue) - new Date(aValue);
      } else {
        return new Date(aValue) - new Date(bValue);
      }
    });

    // Pagination
    total = filteredJobs.length;
    jobs = filteredJobs.slice(skip, skip + limitNum);
  } else {
    // MongoDB path (for production)
    if (search) {
      // Use text search for search functionality
      jobs = await Job.searchJobs(search, query)
        .sort(sortOptions)
        .skip(skip)
        .limit(limitNum);

      // Get total count for search results
      total = await Job.countDocuments({
        ...query,
        $text: { $search: search }
      });
    } else {
      jobs = await Job.find(query)
        .populate('createdBy', 'name email')
        .sort(sortOptions)
        .skip(skip)
        .limit(limitNum);

      total = await Job.countDocuments(query);
    }
  }

  res.json({
    success: true,
    data: {
      jobs,
      pagination: {
        current: pageNum,
        pages: Math.ceil(total / limitNum),
        total,
        limit: limitNum
      }
    }
  });
}));

/**
 * @route   GET /api/jobs/:id
 * @desc    Get a single job by ID
 * @access  Private
 */
router.get('/:id', asyncHandler(async (req, res) => {
  let job;

  if (!isMongoConnected() && global.fileDB) {
    // File-based database path
    const allJobs = global.fileDB.read('jobs');
    const users = global.fileDB.read('users');

    job = allJobs.find(j => j._id === req.params.id);

    if (job) {
      // Add user info to job
      const creator = users.find(u => u._id === job.createdBy);
      job = {
        ...job,
        createdBy: creator ? {
          _id: creator._id,
          name: creator.name,
          email: creator.email
        } : null
      };
    }
  } else {
    // MongoDB path
    job = await Job.findById(req.params.id)
      .populate('createdBy', 'name email')
      .populate('applicants', 'candidateName email skills');
  }

  if (!job) {
    return res.status(404).json({
      success: false,
      message: 'Job not found'
    });
  }

  res.json({
    success: true,
    data: { job }
  });
}));

/**
 * @route   PUT /api/jobs/:id
 * @desc    Update a job
 * @access  Private (Owner or Admin)
 */
router.put('/:id', [
  body('title')
    .optional()
    .trim()
    .isLength({ min: 2, max: 200 })
    .withMessage('Job title must be between 2 and 200 characters'),
  body('description')
    .optional()
    .trim()
    .isLength({ min: 10, max: 5000 })
    .withMessage('Job description must be between 10 and 5000 characters'),
  body('requiredSkills')
    .optional()
    .isArray({ min: 1 })
    .withMessage('At least one required skill must be specified'),
  body('requiredSkills.*')
    .optional()
    .trim()
    .isLength({ min: 2 })
    .withMessage('Each skill must be at least 2 characters long'),
  body('location')
    .optional()
    .trim()
    .isLength({ min: 2, max: 200 })
    .withMessage('Location must be between 2 and 200 characters'),
  body('status')
    .optional()
    .isIn(['active', 'inactive', 'closed'])
    .withMessage('Invalid status'),
  body('jobType')
    .optional()
    .isIn(['full-time', 'part-time', 'contract', 'internship', 'remote'])
    .withMessage('Invalid job type'),
  body('priority')
    .optional()
    .isIn(['low', 'medium', 'high', 'urgent'])
    .withMessage('Invalid priority level')
], asyncHandler(async (req, res) => {
  // Check for validation errors
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array()
    });
  }

  let job;

  if (!isMongoConnected() && global.fileDB) {
    // File-based database path
    const allJobs = global.fileDB.read('jobs');
    const jobIndex = allJobs.findIndex(j => j._id === req.params.id);

    if (jobIndex === -1) {
      return res.status(404).json({
        success: false,
        message: 'Job not found'
      });
    }

    job = allJobs[jobIndex];

    // Check ownership or admin privileges
    if (req.user.role !== 'admin' && job.createdBy !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to update this job'
      });
    }

    // Update job
    const updatedJob = {
      ...job,
      ...req.body,
      updatedAt: new Date().toISOString()
    };

    allJobs[jobIndex] = updatedJob;
    global.fileDB.write('jobs', allJobs);

    // Add user info to response
    const users = global.fileDB.read('users');
    const creator = users.find(u => u._id === updatedJob.createdBy);
    updatedJob.createdBy = creator ? {
      _id: creator._id,
      name: creator.name,
      email: creator.email
    } : null;

    job = updatedJob;
  } else {
    // MongoDB path
    job = await Job.findById(req.params.id);

    if (!job) {
      return res.status(404).json({
        success: false,
        message: 'Job not found'
      });
    }

    // Check ownership or admin privileges
    if (req.user.role !== 'admin' && !job.createdBy.equals(req.user._id)) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to update this job'
      });
    }

    // Update job
    job = await Job.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    ).populate('createdBy', 'name email');
  }

  res.json({
    success: true,
    message: 'Job updated successfully',
    data: { job }
  });
}));

/**
 * @route   DELETE /api/jobs/:id
 * @desc    Delete a job
 * @access  Private (Owner or Admin)
 */
router.delete('/:id', asyncHandler(async (req, res) => {
  let job;

  if (!isMongoConnected() && global.fileDB) {
    // File-based database path
    const allJobs = global.fileDB.read('jobs');
    const jobIndex = allJobs.findIndex(j => j._id === req.params.id);

    if (jobIndex === -1) {
      return res.status(404).json({
        success: false,
        message: 'Job not found'
      });
    }

    job = allJobs[jobIndex];

    // Check ownership or admin privileges
    if (req.user.role !== 'admin' && job.createdBy !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to delete this job'
      });
    }

    // Delete job
    allJobs.splice(jobIndex, 1);
    global.fileDB.write('jobs', allJobs);
  } else {
    // MongoDB path
    job = await Job.findById(req.params.id);

    if (!job) {
      return res.status(404).json({
        success: false,
        message: 'Job not found'
      });
    }

    // Check ownership or admin privileges
    if (req.user.role !== 'admin' && !job.createdBy.equals(req.user._id)) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to delete this job'
      });
    }

    await Job.findByIdAndDelete(req.params.id);
  }

  res.json({
    success: true,
    message: 'Job deleted successfully'
  });
}));

/**
 * @route   POST /api/jobs/:id/applicants
 * @desc    Add applicant to job
 * @access  Private (HR, Admin)
 */
router.post('/:id/applicants', authorize('hr', 'admin'), [
  body('resumeId')
    .isMongoId()
    .withMessage('Valid resume ID is required')
], asyncHandler(async (req, res) => {
  // Check for validation errors
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array()
    });
  }

  const job = await Job.findById(req.params.id);
  if (!job) {
    return res.status(404).json({
      success: false,
      message: 'Job not found'
    });
  }

  const { resumeId } = req.body;

  // Add applicant to job
  await job.addApplicant(resumeId);

  res.json({
    success: true,
    message: 'Applicant added successfully'
  });
}));

/**
 * @route   DELETE /api/jobs/:id/applicants/:resumeId
 * @desc    Remove applicant from job
 * @access  Private (HR, Admin)
 */
router.delete('/:id/applicants/:resumeId', authorize('hr', 'admin'), asyncHandler(async (req, res) => {
  const job = await Job.findById(req.params.id);
  if (!job) {
    return res.status(404).json({
      success: false,
      message: 'Job not found'
    });
  }

  // Remove applicant from job
  await job.removeApplicant(req.params.resumeId);

  res.json({
    success: true,
    message: 'Applicant removed successfully'
  });
}));

/**
 * @route   GET /api/jobs/stats
 * @desc    Get job statistics
 * @access  Private (HR, Admin)
 */
router.get('/stats', authorize('hr', 'admin'), asyncHandler(async (req, res) => {
  const stats = await Job.aggregate([
    {
      $group: {
        _id: null,
        totalJobs: { $sum: 1 },
        activeJobs: {
          $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] }
        },
        closedJobs: {
          $sum: { $cond: [{ $eq: ['$status', 'closed'] }, 1, 0] }
        },
        highPriorityJobs: {
          $sum: { $cond: [{ $eq: ['$priority', 'high'] }, 1, 0] }
        },
        urgentJobs: {
          $sum: { $cond: [{ $eq: ['$priority', 'urgent'] }, 1, 0] }
        }
      }
    }
  ]);

  const jobTypeStats = await Job.aggregate([
    {
      $group: {
        _id: '$jobType',
        count: { $sum: 1 }
      }
    }
  ]);

  const departmentStats = await Job.aggregate([
    {
      $group: {
        _id: '$department',
        count: { $sum: 1 }
      }
    }
  ]);

  res.json({
    success: true,
    data: {
      overview: stats[0] || {
        totalJobs: 0,
        activeJobs: 0,
        closedJobs: 0,
        highPriorityJobs: 0,
        urgentJobs: 0
      },
      byType: jobTypeStats,
      byDepartment: departmentStats
    }
  });
}));

module.exports = router;
