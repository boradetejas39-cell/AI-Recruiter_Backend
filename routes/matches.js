const express = require('express');
const { body, validationResult } = require('express-validator');
const Match = require('../models/Match');
const Job = require('../models/Job');
const Resume = require('../models/Resume');
const { protect, authorize } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const aiMatchingService = require('../services/aiMatchingService');

const router = express.Router();

// All routes are protected
router.use(protect);

/**
 * @route   POST /api/matches/calculate/:jobId/:resumeId
 * @desc    Calculate match score between job and resume
 * @access  Private (HR, Admin)
 */
router.post('/calculate/:jobId/:resumeId', authorize('hr', 'admin'), asyncHandler(async (req, res) => {
  const { jobId, resumeId } = req.params;

  // Validate that job and resume exist
  const job = await Job.findById(jobId);
  const resume = await Resume.findById(resumeId);

  if (!job) {
    return res.status(404).json({
      success: false,
      message: 'Job not found'
    });
  }

  if (!resume) {
    return res.status(404).json({
      success: false,
      message: 'Resume not found'
    });
  }

  // Calculate match using AI service
  const matchData = await aiMatchingService.calculateMatch(jobId, resumeId);

  // Save or update match in database
  const match = await Match.findOneAndUpdate(
    { jobId, resumeId },
    matchData,
    { upsert: true, new: true }
  ).populate('resumeId', 'candidateName email skills')
   .populate('jobId', 'title location requiredSkills');

  res.json({
    success: true,
    message: 'Match calculated successfully',
    data: { match }
  });
}));

/**
 * @route   POST /api/matches/job/:jobId
 * @desc    Calculate matches for all resumes against a job
 * @access  Private (HR, Admin)
 */
router.post('/job/:jobId', authorize('hr', 'admin'), asyncHandler(async (req, res) => {
  const { jobId } = req.params;

  // Validate that job exists
  const job = await Job.findById(jobId);
  if (!job) {
    return res.status(404).json({
      success: false,
      message: 'Job not found'
    });
  }

  // Calculate matches for all resumes
  const matches = await aiMatchingService.matchAllResumesForJob(jobId);

  res.json({
    success: true,
    message: 'Matches calculated successfully',
    data: { 
      matches,
      total: matches.length
    }
  });
}));

/**
 * @route   GET /api/matches/job/:jobId
 * @desc    Get all matches for a specific job
 * @access  Private
 */
router.get('/job/:jobId', asyncHandler(async (req, res) => {
  const { jobId } = req.params;
  const { 
    status, 
    minScore, 
    page = 1, 
    limit = 10,
    sortBy = 'score',
    sortOrder = 'desc'
  } = req.query;

  // Validate that job exists
  const job = await Job.findById(jobId);
  if (!job) {
    return res.status(404).json({
      success: false,
      message: 'Job not found'
    });
  }

  // Build options
  const options = {};
  if (status) options.status = status;
  if (minScore) options.minScore = parseFloat(minScore);

  // Build sort options
  const sortOptions = {};
  sortOptions[sortBy] = sortOrder === 'desc' ? -1 : 1;

  // Get matches with pagination
  const pageNum = parseInt(page);
  const limitNum = parseInt(limit);
  const skip = (pageNum - 1) * limitNum;

  const matches = await Match.findByJob(jobId, options)
    .sort(sortOptions)
    .skip(skip)
    .limit(limitNum);

  const total = await Match.countDocuments({ jobId, ...options });

  res.json({
    success: true,
    data: {
      matches,
      job: {
        id: job._id,
        title: job.title,
        location: job.location
      },
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
 * @route   GET /api/matches/resume/:resumeId
 * @desc    Get all matches for a specific resume
 * @access  Private
 */
router.get('/resume/:resumeId', asyncHandler(async (req, res) => {
  const { resumeId } = req.params;
  const { 
    status, 
    minScore, 
    page = 1, 
    limit = 10,
    sortBy = 'score',
    sortOrder = 'desc'
  } = req.query;

  // Validate that resume exists
  const resume = await Resume.findById(resumeId);
  if (!resume) {
    return res.status(404).json({
      success: false,
      message: 'Resume not found'
    });
  }

  // Build options
  const options = {};
  if (status) options.status = status;
  if (minScore) options.minScore = parseFloat(minScore);

  // Build sort options
  const sortOptions = {};
  sortOptions[sortBy] = sortOrder === 'desc' ? -1 : 1;

  // Get matches with pagination
  const pageNum = parseInt(page);
  const limitNum = parseInt(limit);
  const skip = (pageNum - 1) * limitNum;

  const matches = await Match.findByResume(resumeId, options)
    .sort(sortOptions)
    .skip(skip)
    .limit(limitNum);

  const total = await Match.countDocuments({ resumeId, ...options });

  res.json({
    success: true,
    data: {
      matches,
      resume: {
        id: resume._id,
        candidateName: resume.candidateName,
        email: resume.email
      },
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
 * @route   GET /api/matches/:id
 * @desc    Get a single match by ID
 * @access  Private
 */
router.get('/:id', asyncHandler(async (req, res) => {
  const match = await Match.findById(req.params.id)
    .populate('jobId', 'title description location requiredSkills experienceRequired')
    .populate('resumeId', 'candidateName email skills experience education')
    .populate('reviewedBy', 'name email');

  if (!match) {
    return res.status(404).json({
      success: false,
      message: 'Match not found'
    });
  }

  res.json({
    success: true,
    data: { match }
  });
}));

/**
 * @route   PUT /api/matches/:id/status
 * @desc    Update match status
 * @access  Private (HR, Admin)
 */
router.put('/:id/status', authorize('hr', 'admin'), [
  body('status')
    .isIn(['pending', 'reviewed', 'shortlisted', 'rejected', 'hired'])
    .withMessage('Invalid status'),
  body('notes')
    .optional()
    .trim()
    .isLength({ max: 1000 })
    .withMessage('Notes cannot exceed 1000 characters')
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

  const match = await Match.findById(req.params.id);

  if (!match) {
    return res.status(404).json({
      success: false,
      message: 'Match not found'
    });
  }

  const { status, notes } = req.body;

  // Update match status
  await match.updateStatus(status, req.user._id, notes);

  // Get updated match with populated data
  const updatedMatch = await Match.findById(req.params.id)
    .populate('jobId', 'title location')
    .populate('resumeId', 'candidateName email')
    .populate('reviewedBy', 'name email');

  res.json({
    success: true,
    message: 'Match status updated successfully',
    data: { match: updatedMatch }
  });
}));

/**
 * @route   POST /api/matches/:id/tags
 * @desc    Add tag to match
 * @access  Private (HR, Admin)
 */
router.post('/:id/tags', authorize('hr', 'admin'), [
  body('tag')
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage('Tag must be between 2 and 50 characters')
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

  const match = await Match.findById(req.params.id);

  if (!match) {
    return res.status(404).json({
      success: false,
      message: 'Match not found'
    });
  }

  const { tag } = req.body;
  await match.addTag(tag);

  res.json({
    success: true,
    message: 'Tag added successfully'
  });
}));

/**
 * @route   GET /api/matches/top/:jobId
 * @desc    Get top matches for a job
 * @access  Private
 */
router.get('/top/:jobId', asyncHandler(async (req, res) => {
  const { jobId } = req.params;
  const { limit = 10 } = req.query;

  // Validate that job exists
  const job = await Job.findById(jobId);
  if (!job) {
    return res.status(404).json({
      success: false,
      message: 'Job not found'
    });
  }

  const limitNum = parseInt(limit);
  const matches = await aiMatchingService.getTopMatches(jobId, limitNum);

  res.json({
    success: true,
    data: {
      matches,
      job: {
        id: job._id,
        title: job.title,
        location: job.location
      }
    }
  });
}));

/**
 * @route   GET /api/matches/stats
 * @desc    Get matching statistics
 * @access  Private (HR, Admin)
 */
router.get('/stats', authorize('hr', 'admin'), asyncHandler(async (req, res) => {
  const { jobId } = req.query;

  let stats;
  if (jobId) {
    // Stats for specific job
    stats = await Match.getMatchStats(jobId);
  } else {
    // Overall stats
    stats = await Match.aggregate([
      {
        $group: {
          _id: null,
          totalMatches: { $sum: 1 },
          averageScore: { $avg: '$score' },
          highMatches: {
            $sum: { $cond: [{ $gte: ['$score', 80] }, 1, 0] }
          },
          mediumMatches: {
            $sum: { $cond: [{ $and: [{ $gte: ['$score', 50] }, { $lt: ['$score', 80] }] }, 1, 0] }
          },
          lowMatches: {
            $sum: { $cond: [{ $lt: ['$score', 50] }, 1, 0] }
          },
          pendingMatches: {
            $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] }
          },
          reviewedMatches: {
            $sum: { $cond: [{ $eq: ['$status', 'reviewed'] }, 1, 0] }
          },
          shortlistedMatches: {
            $sum: { $cond: [{ $eq: ['$status', 'shortlisted'] }, 1, 0] }
          }
        }
      }
    ]);
  }

  // Score distribution
  const scoreDistribution = await Match.aggregate([
    {
      $bucket: {
        groupBy: '$score',
        boundaries: [0, 20, 40, 60, 80, 100],
        default: '100',
        output: {
          count: { $sum: 1 }
        }
      }
    }
  ]);

  // Status distribution
  const statusDistribution = await Match.aggregate([
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 }
      }
    }
  ]);

  res.json({
    success: true,
    data: {
      overview: stats[0] || {
        totalMatches: 0,
        averageScore: 0,
        highMatches: 0,
        mediumMatches: 0,
        lowMatches: 0,
        pendingMatches: 0,
        reviewedMatches: 0,
        shortlistedMatches: 0
      },
      scoreDistribution,
      statusDistribution
    }
  });
}));

/**
 * @route   DELETE /api/matches/:id
 * @desc    Delete a match
 * @access  Private (HR, Admin)
 */
router.delete('/:id', authorize('hr', 'admin'), asyncHandler(async (req, res) => {
  const match = await Match.findById(req.params.id);

  if (!match) {
    return res.status(404).json({
      success: false,
      message: 'Match not found'
    });
  }

  await Match.findByIdAndDelete(req.params.id);

  res.json({
    success: true,
    message: 'Match deleted successfully'
  });
}));

module.exports = router;
