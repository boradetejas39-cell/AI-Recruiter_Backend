const express = require('express');
const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');
const { body, validationResult } = require('express-validator');
const Resume = require('../models/Resume');
const Job = require('../models/Job');
const Match = require('../models/Match');
const { protect, authorize } = require('../middleware/auth');
const { upload } = require('../middleware/upload');
const { asyncHandler } = require('../middleware/errorHandler');
const resumeParserService = require('../services/resumeParserService');
const aiMatchingService = require('../services/aiMatchingService');

const router = express.Router();

/** True when Mongoose has an active MongoDB connection */
const isMongoConnected = () => mongoose.connection.readyState === 1;

/**
 * Auto-match a resume against all active jobs after upload.
 * Returns an array of { job, score, breakdown } objects sorted by score desc.
 */
async function autoMatchResume(resume) {
  if (!isMongoConnected()) return [];
  try {
    const activeJobs = await Job.find({ status: 'active' }).lean();
    if (activeJobs.length === 0) return [];

    const matches = [];
    for (const job of activeJobs) {
      try {
        const matchData = await aiMatchingService.calculateMatch(job._id, resume._id);

        // Save match to database
        const savedMatch = await Match.findOneAndUpdate(
          { jobId: job._id, resumeId: resume._id },
          {
            jobId: job._id,
            resumeId: resume._id,
            score: matchData.score,
            breakdown: matchData.breakdown,
            algorithm: matchData.algorithm
          },
          { upsert: true, new: true }
        );

        matches.push({
          matchId: savedMatch._id,
          job: {
            _id: job._id,
            title: job.title,
            location: job.location,
            jobType: job.jobType,
            department: job.department,
            requiredSkills: job.requiredSkills
          },
          score: matchData.score,
          breakdown: matchData.breakdown
        });
      } catch (err) {
        console.error(`Match error for job ${job._id}:`, err.message);
      }
    }

    // Sort by score descending
    matches.sort((a, b) => b.score - a.score);
    return matches;
  } catch (error) {
    console.error('Auto-match error:', error.message);
    return [];
  }
}

// All routes are protected
router.use(protect);

/**
 * @route   POST /api/resumes/user-upload
 * @desc    Upload a resume for regular users
 * @access  Private
 */
router.post('/user-upload', upload.single('resume'), asyncHandler(async (req, res) => {
  try {
    console.log('🚀 User resume upload route hit');
    console.log('📁 File info:', req.file ? {
      originalname: req.file.originalname,
      size: req.file.size,
      mimetype: req.file.mimetype,
      path: req.file.path
    } : 'No file');

    if (!req.file) {
      console.log('❌ No file uploaded');
      return res.status(400).json({
        success: false,
        message: 'No file uploaded. Please select a file to upload.'
      });
    }

    // Validate file
    const maxSize = 10 * 1024 * 1024; // 10MB
    if (req.file.size > maxSize) {
      console.log('❌ File too large:', req.file.size);
      return res.status(400).json({
        success: false,
        message: 'File size too large. Maximum size is 10MB.'
      });
    }

    const ext = path.extname(req.file.originalname).toLowerCase();
    const allowedExts = ['.pdf', '.docx', '.doc'];
    if (!allowedExts.includes(ext)) {
      console.log('❌ Invalid file type:', ext);
      return res.status(400).json({
        success: false,
        message: 'Invalid file type. Only PDF and Word documents are allowed.'
      });
    }

    // Parse resume
    const fileType = ext === '.pdf' ? 'pdf' : 'docx';
    const parsedData = await resumeParserService.parseResume(req.file.path, fileType);

    // Create resume object
    const resumeData = {
      candidateName: parsedData.candidateName || 'Unknown Name',
      email: parsedData.email || req.user.email,
      phone: parsedData.phone || req.user.phone || '',
      skills: parsedData.skills || [],
      experience: parsedData.experience || [],
      education: parsedData.education || [],
      totalExperience: parsedData.totalExperience || 0,
      currentLocation: parsedData.currentLocation || '',
      status: 'active',
      rawText: parsedData.rawText || '',
      fileName: req.file.originalname,
      filePath: req.file.path,
      fileType: ext.replace('.', ''),
      uploadedBy: req.user._id,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    let savedResume;

    if (isMongoConnected()) {
      // MongoDB path
      console.log('📁 Saving to MongoDB');
      savedResume = await Resume.create(resumeData);
    } else if (global.fileDB) {
      // File-based database path
      console.log('📁 Saving to file-based database');
      resumeData._id = Date.now().toString();
      global.fileDB.add('resumes', resumeData);
      savedResume = resumeData;
    } else {
      // Memory store path (initialize if needed)
      console.log('📁 Saving to memory store');
      resumeData._id = Date.now().toString();
      if (!global.resumes) global.resumes = [];
      global.resumes.push(resumeData);
      savedResume = resumeData;
    }

    console.log('✅ Resume uploaded successfully for user:', req.user.email);

    // Auto-match against active jobs
    console.log('🔍 Running auto-match against active jobs...');
    const jobMatches = await autoMatchResume(savedResume);
    console.log(`✅ Found ${jobMatches.length} job matches`);

    res.status(201).json({
      success: true,
      message: 'Resume uploaded successfully',
      data: savedResume,
      matches: jobMatches
    });
  } catch (error) {
    console.error('❌ Resume upload error:', error);
    res.status(500).json({
      success: false,
      message: 'Error uploading resume. Please try again.'
    });
  }
}));

/**
 * @route   GET /api/resumes/my
 * @desc    Get current user's resumes
 * @access  Private
 */
router.get('/my', asyncHandler(async (req, res) => {
  try {
    let resumes;

    if (isMongoConnected()) {
      // MongoDB path
      resumes = await Resume.find({ uploadedBy: req.user._id.toString() }).sort({ createdAt: -1 }).lean();
    } else if (global.fileDB) {
      // File-based database path
      const allResumes = global.fileDB.read('resumes');
      resumes = allResumes.filter(resume => resume.uploadedBy === req.user._id);
    } else {
      resumes = (global.resumes || []).filter(resume => resume.uploadedBy === req.user._id);
    }

    res.json({
      success: true,
      data: { resumes }
    });
  } catch (error) {
    console.error('Error fetching user resumes:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching resumes'
    });
  }
}));

/**
 * @route   POST /api/resumes/upload
 * @desc    Upload and parse a resume
 * @access  Private (HR, Admin)
 */
router.post('/upload', protect, authorize('hr', 'admin'), upload.single('resume'), asyncHandler(async (req, res) => {
  try {
    console.log('🚀 Resume upload route hit');
    console.log('📁 File info:', req.file ? {
      originalname: req.file.originalname,
      size: req.file.size,
      mimetype: req.file.mimetype,
      path: req.file.path
    } : 'No file');
    console.log('👤 User:', req.user ? { id: req.user._id, email: req.user.email } : 'No user');

    if (!req.file) {
      console.log('❌ No file uploaded');
      return res.status(400).json({
        success: false,
        message: 'No file uploaded. Please select a file to upload.'
      });
    }

    // Validate file
    const maxSize = 10 * 1024 * 1024; // 10MB
    if (req.file.size > maxSize) {
      console.log('❌ File too large:', req.file.size);
      return res.status(400).json({
        success: false,
        message: 'File size too large. Maximum size is 10MB.'
      });
    }

    const ext = path.extname(req.file.originalname).toLowerCase();
    const allowedExts = ['.pdf', '.docx', '.doc'];

    if (!allowedExts.includes(ext)) {
      console.log('❌ Invalid file extension:', ext);
      return res.status(400).json({
        success: false,
        message: 'Invalid file extension. Only PDF and DOCX files are allowed.'
      });
    }

    const fileType = ext === '.pdf' ? 'pdf' : 'docx';
    const filePath = req.file.path;
    const originalname = req.file.originalname;

    // Parse resume to extract structured data
    console.log('📄 Starting resume parsing...');
    console.log('📁 Parsing file:', filePath);
    const parsedData = await resumeParserService.parseResume(filePath, fileType);
    console.log('✅ Resume parsing completed');
    console.log('📊 Extracted status:', parsedData.status);

    // Create resume record
    const resumeData = {
      ...parsedData,
      fileName: originalname,
      filePath: filePath,
      fileType: fileType,
      uploadedBy: req.user._id,
      status: parsedData.status || 'new' // Default to 'new' if no status found
    };

    let resume;

    if (isMongoConnected()) {
      // ── MongoDB path ──
      console.log('💾 Saving to MongoDB...');
      resume = await Resume.create(resumeData);
      console.log('✅ Saved to MongoDB, id:', resume._id);
    } else if (global.fileDB) {
      // File-based database path
      console.log('💾 Saving to file-based database...');
      const resumes = global.fileDB.read('resumes');
      resume = {
        _id: Date.now().toString(),
        ...resumeData,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      resumes.push(resume);
      global.fileDB.write('resumes', resumes);
      console.log('✅ Saved to file-based database');

      // Add user info to response
      const users = global.fileDB.read('users');
      const uploader = users.find(u => u._id === resumeData.uploadedBy);
      resume.uploadedBy = uploader ? {
        _id: uploader._id,
        name: uploader.name,
        email: uploader.email
      } : null;
    } else {
      // Memory store path (no MongoDB)
      console.log('💾 Saving to memory store...');
      resume = {
        _id: Date.now().toString(),
        ...resumeData,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      // Store in global memory for demo
      if (!global.resumes) global.resumes = [];
      global.resumes.push(resume);
      console.log('✅ Saved to memory store');

      // Add user info to response
      resume.uploadedBy = {
        _id: req.user._id,
        name: req.user.name,
        email: req.user.email
      };
    }

    // Auto-match against active jobs (synchronous so we can return results)
    let jobMatches = [];
    if (isMongoConnected() && resume._id) {
      console.log('🔍 Running auto-match against active jobs...');
      jobMatches = await autoMatchResume(resume);
      console.log(`✅ Found ${jobMatches.length} job matches for resume ${resume._id}`);
    }

    res.status(201).json({
      success: true,
      message: 'Resume uploaded and parsed successfully',
      data: { resume },
      matches: jobMatches
    });
  } catch (error) {
    console.error('❌ Resume upload error:', error);
    console.error('Error stack:', error.stack);

    // Clean up uploaded file on error
    if (req.file && req.file.path) {
      try {
        fs.unlinkSync(req.file.path);
        console.log('🧹 Cleaned up file:', req.file.path);
      } catch (cleanupError) {
        console.error('Error cleaning up file:', cleanupError);
      }
    }

    res.status(500).json({
      success: false,
      message: `Failed to process resume: ${error.message}`
    });
  }
}));

/**
 * @route   GET /api/resumes
 * @desc    Get all resumes with filtering and pagination
 * @access  Private
 */
router.get('/', asyncHandler(async (req, res) => {
  console.log('📋 GET /api/resumes request received');
  console.log('� User:', req.user ? { id: req.user._id, email: req.user.email } : 'No user');
  console.log('� Query params:', req.query);

  const {
    page = 1,
    limit = 10,
    status = 'all',
    search,
    skills,
    minExperience,
    maxExperience,
    location,
    sortBy = 'createdAt',
    sortOrder = 'desc'
  } = req.query;

  // Build query
  const query = {};

  if (status !== 'all') {
    query.status = status;
  }

  if (minExperience || maxExperience) {
    query.totalExperience = {};
    if (minExperience) query.totalExperience.$gte = parseFloat(minExperience);
    if (maxExperience) query.totalExperience.$lte = parseFloat(maxExperience);
  }

  if (location) {
    query.$or = [
      { currentLocation: { $regex: location, $options: 'i' } },
      { preferredLocation: { $regex: location, $options: 'i' } }
    ];
  }

  if (skills) {
    const skillArray = Array.isArray(skills) ? skills : skills.split(',');
    query.skills = { $in: skillArray };
  }

  // Build sort options
  const sortOptions = {};
  sortOptions[sortBy] = sortOrder === 'desc' ? -1 : 1;

  // Execute query with pagination
  const pageNum = parseInt(page);
  const limitNum = parseInt(limit);
  const skip = (pageNum - 1) * limitNum;

  let resumes;
  let total;

  if (isMongoConnected()) {
    // ── MongoDB path ──
    console.log('📊 Using MongoDB for resumes');
    if (search) {
      query.$or = [
        { candidateName: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { skills: { $regex: search, $options: 'i' } }
      ];
    }
    total = await Resume.countDocuments(query);
    resumes = await Resume.find(query)
      .sort(sortOptions)
      .skip(skip)
      .limit(limitNum)
      .lean();
  } else if (global.fileDB) {
    // File-based database path
    const allResumes = global.fileDB.read('resumes');
    const users = global.fileDB.read('users');

    // Filter resumes based on query
    let filteredResumes = allResumes.filter(resume => {
      if (status !== 'all' && resume.status !== status) return false;
      if (minExperience || maxExperience) {
        const exp = resume.totalExperience || 0;
        if (minExperience && exp < parseFloat(minExperience)) return false;
        if (maxExperience && exp > parseFloat(maxExperience)) return false;
      }
      if (location) {
        const searchText = location.toLowerCase();
        return (resume.currentLocation && resume.currentLocation.toLowerCase().includes(searchText)) ||
          (resume.preferredLocation && resume.preferredLocation.toLowerCase().includes(searchText));
      }
      if (skills) {
        const skillArray = Array.isArray(skills) ? skills : skills.split(',');
        const resumeSkills = resume.skills || [];
        return skillArray.some(skill =>
          resumeSkills.some(resumeSkill =>
            resumeSkill.toLowerCase().includes(skill.toLowerCase())
          )
        );
      }
      return true;
    });

    console.log('📊 Filter results:', {
      totalResumes: allResumes.length,
      filteredResumes: filteredResumes.length,
      statusFilter: status
    });

    // Add user info to resumes
    resumes = filteredResumes.map(resume => {
      const uploader = users.find(u => u._id === resume.uploadedBy);
      return {
        ...resume,
        uploadedBy: uploader ? {
          _id: uploader._id,
          name: uploader.name,
          email: uploader.email
        } : null
      };
    });

    // Sort resumes
    resumes.sort((a, b) => {
      const aValue = a[sortBy];
      const bValue = b[sortBy];
      if (sortOrder === 'desc') {
        return new Date(bValue) - new Date(aValue);
      } else {
        return new Date(aValue) - new Date(bValue);
      }
    });

    // Pagination
    total = filteredResumes.length;
    resumes = resumes.slice(skip, skip + limitNum);
  } else if (global.resumes) {
    // Memory store path
    console.log('📊 Using memory store for resumes');
    let filteredResumes = global.resumes.filter(resume => {
      if (status !== 'all' && resume.status !== status) return false;
      if (search) {
        const searchText = search.toLowerCase();
        return (resume.candidateName && resume.candidateName.toLowerCase().includes(searchText)) ||
          (resume.email && resume.email.toLowerCase().includes(searchText)) ||
          (resume.skills && resume.skills.some(skill => skill.toLowerCase().includes(searchText)));
      }
      return true;
    });

    // Sort resumes
    resumes = filteredResumes.sort((a, b) => {
      const aValue = a[sortBy];
      const bValue = b[sortBy];
      if (sortOrder === 'desc') {
        return new Date(bValue) - new Date(aValue);
      } else {
        return new Date(aValue) - new Date(bValue);
      }
    });

    // Pagination
    total = filteredResumes.length;
    resumes = resumes.slice(skip, skip + limitNum);
  } else {
    // No database available
    console.log('📊 No resumes found');
    resumes = [];
    total = 0;
  }

  res.json({
    success: true,
    data: {
      resumes,
      pagination: {
        current: pageNum,
        pages: Math.ceil(total / limitNum),
        total: total,
        limit: limitNum
      }
    }
  });

  console.log('📋 Response sent:', {
    resumesCount: resumes.length,
    total: total,
    page: pageNum
  });
}));

/**
 * @route   GET /api/resumes/:id
 * @desc    Get a single resume by ID
 * @access  Private
 */
router.get('/:id', asyncHandler(async (req, res) => {
  let resume;

  if (isMongoConnected()) {
    // MongoDB path
    resume = await Resume.findById(req.params.id).lean();
  } else if (global.fileDB) {
    // File-based database path
    const resumes = global.fileDB.read('resumes');
    const users = global.fileDB.read('users');

    resume = resumes.find(r => r._id === req.params.id);

    if (resume) {
      // Add user info
      const uploader = users.find(u => u._id === resume.uploadedBy);
      resume.uploadedBy = uploader ? {
        _id: uploader._id,
        name: uploader.name,
        email: uploader.email
      } : null;
    }
  } else {
    // Memory store fallback
    resume = (global.resumes || []).find(r => r._id === req.params.id) || null;
  }

  if (!resume) {
    return res.status(404).json({
      success: false,
      message: 'Resume not found'
    });
  }

  res.json({
    success: true,
    data: { resume }
  });
}));

/**
 * @route   GET /api/resumes/:id/matches
 * @desc    Get all job matches for a specific resume
 * @access  Private
 */
router.get('/:id/matches', asyncHandler(async (req, res) => {
  try {
    const { id } = req.params;

    if (!isMongoConnected()) {
      return res.json({ success: true, data: { matches: [] } });
    }

    // Find all matches for this resume, populate job details
    const matches = await Match.find({ resumeId: id })
      .populate('jobId', 'title location jobType department requiredSkills status salary')
      .sort({ score: -1 })
      .lean();

    // Format response
    const formattedMatches = matches
      .filter(m => m.jobId) // filter out matches where job was deleted
      .map(m => ({
        matchId: m._id,
        job: m.jobId,
        score: m.score,
        breakdown: m.breakdown,
        createdAt: m.createdAt
      }));

    res.json({
      success: true,
      data: {
        matches: formattedMatches,
        totalMatches: formattedMatches.length,
        highMatches: formattedMatches.filter(m => m.score >= 70).length,
        averageScore: formattedMatches.length > 0
          ? Math.round(formattedMatches.reduce((sum, m) => sum + m.score, 0) / formattedMatches.length)
          : 0
      }
    });
  } catch (error) {
    console.error('Error fetching resume matches:', error);
    res.status(500).json({ success: false, message: 'Error fetching matches' });
  }
}));

/**
 * @route   PUT /api/resumes/:id
 * @desc    Update a resume
 * @access  Private (HR, Admin)
 */
router.put('/:id', authorize('hr', 'admin'), [
  body('candidateName')
    .optional()
    .trim()
    .isLength({ min: 2, max: 200 })
    .withMessage('Candidate name must be between 2 and 200 characters'),
  body('email')
    .optional()
    .isEmail()
    .normalizeEmail()
    .withMessage('Please provide a valid email'),
  body('phone')
    .optional()
    .trim(),
  body('skills')
    .optional()
    .isArray({ min: 1 })
    .withMessage('At least one skill must be specified'),
  body('skills.*')
    .optional()
    .trim()
    .isLength({ min: 2 })
    .withMessage('Each skill must be at least 2 characters long'),
  body('status')
    .optional()
    .isIn(['active', 'inactive', 'hired', 'rejected'])
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

  const resume = await Resume.findById(req.params.id);

  if (!resume) {
    return res.status(404).json({
      success: false,
      message: 'Resume not found'
    });
  }

  // Update resume
  const updatedResume = await Resume.findByIdAndUpdate(
    req.params.id,
    req.body,
    { new: true, runValidators: true }
  ).populate('uploadedBy', 'name email');

  res.json({
    success: true,
    message: 'Resume updated successfully',
    data: { resume: updatedResume }
  });
}));

/**
 * @route   DELETE /api/resumes/:id
 * @desc    Delete a resume
 * @access  Private (HR, Admin)
 */
router.delete('/:id', authorize('hr', 'admin'), asyncHandler(async (req, res) => {
  console.log('🗑️ DELETE resume request for ID:', req.params.id);
  console.log('👤 User role:', req.user?.role);

  let resume;

  if (isMongoConnected()) {
    // MongoDB path
    console.log('🗄️ Using MongoDB');
    resume = await Resume.findById(req.params.id);

    if (!resume) {
      return res.status(404).json({
        success: false,
        message: 'Resume not found'
      });
    }

    // Delete the file from filesystem
    if (resume.filePath && fs.existsSync(resume.filePath)) {
      try {
        fs.unlinkSync(resume.filePath);
        console.log('🗑️ File deleted:', resume.filePath);
      } catch (fileError) {
        console.error('❌ Error deleting file:', fileError);
      }
    }

    await Resume.findByIdAndDelete(req.params.id);
    console.log('✅ Resume deleted from MongoDB');
  } else if (global.fileDB) {
    // File-based database path
    console.log('📁 Using file-based database');
    const resumes = global.fileDB.read('resumes');
    resume = resumes.find(r => r._id === req.params.id);

    if (!resume) {
      console.log('❌ Resume not found');
      return res.status(404).json({
        success: false,
        message: 'Resume not found'
      });
    }

    console.log('✅ Found resume:', resume.candidateName);

    if (resume.filePath && fs.existsSync(resume.filePath)) {
      try {
        fs.unlinkSync(resume.filePath);
        console.log('🗑️ File deleted:', resume.filePath);
      } catch (fileError) {
        console.error('❌ Error deleting file:', fileError);
      }
    }

    try {
      global.fileDB.delete('resumes', req.params.id);
      console.log('✅ Resume deleted from database');
    } catch (dbError) {
      console.error('❌ Error deleting from database:', dbError);
      return res.status(500).json({
        success: false,
        message: 'Error deleting resume from database'
      });
    }
  } else {
    // Memory store fallback
    const idx = (global.resumes || []).findIndex(r => r._id === req.params.id);
    if (idx === -1) {
      return res.status(404).json({ success: false, message: 'Resume not found' });
    }
    resume = global.resumes[idx];
    if (resume.filePath && fs.existsSync(resume.filePath)) {
      try { fs.unlinkSync(resume.filePath); } catch (e) { /* ignore */ }
    }
    global.resumes.splice(idx, 1);
  }

  res.json({
    success: true,
    message: 'Resume deleted successfully'
  });
}));

/**
 * @route   POST /api/resumes/:id/skills
 * @desc    Add skill to resume
 * @access  Private (HR, Admin)
 */
router.post('/:id/skills', authorize('hr', 'admin'), [
  body('skill')
    .trim()
    .isLength({ min: 2 })
    .withMessage('Skill must be at least 2 characters long')
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

  const resume = await Resume.findById(req.params.id);

  if (!resume) {
    return res.status(404).json({
      success: false,
      message: 'Resume not found'
    });
  }

  const { skill } = req.body;
  await resume.addSkill(skill);

  res.json({
    success: true,
    message: 'Skill added successfully'
  });
}));

/**
 * @route   DELETE /api/resumes/:id/skills/:skill
 * @desc    Remove skill from resume
 * @access  Private (HR, Admin)
 */
router.delete('/:id/skills/:skill', authorize('hr', 'admin'), asyncHandler(async (req, res) => {
  const resume = await Resume.findById(req.params.id);

  if (!resume) {
    return res.status(404).json({
      success: false,
      message: 'Resume not found'
    });
  }

  await resume.removeSkill(req.params.skill);

  res.json({
    success: true,
    message: 'Skill removed successfully'
  });
}));

/**
 * @route   GET /api/resumes/skills/all
 * @desc    Get all unique skills from all resumes
 * @access  Private
 */
router.get('/skills/all', asyncHandler(async (req, res) => {
  const skills = await Resume.distinct('skills', { status: 'active' });

  res.json({
    success: true,
    data: { skills: skills.sort() }
  });
}));

/**
 * @route   GET /api/resumes/stats
 * @desc    Get resume statistics
 * @access  Private (HR, Admin)
 */
router.get('/stats', authorize('hr', 'admin'), asyncHandler(async (req, res) => {
  const stats = await Resume.aggregate([
    {
      $group: {
        _id: null,
        totalResumes: { $sum: 1 },
        activeResumes: {
          $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] }
        },
        hiredResumes: {
          $sum: { $cond: [{ $eq: ['$status', 'hired'] }, 1, 0] }
        },
        rejectedResumes: {
          $sum: { $cond: [{ $eq: ['$status', 'rejected'] }, 1, 0] }
        },
        avgExperience: { $avg: '$totalExperience' }
      }
    }
  ]);

  const skillStats = await Resume.aggregate([
    { $unwind: '$skills' },
    { $match: { status: 'active' } },
    {
      $group: {
        _id: '$skills',
        count: { $sum: 1 }
      }
    },
    { $sort: { count: -1 } },
    { $limit: 20 }
  ]);

  const experienceStats = await Resume.aggregate([
    { $match: { status: 'active' } },
    {
      $bucket: {
        groupBy: '$totalExperience',
        boundaries: [0, 1, 3, 5, 10, 20],
        default: '20+',
        output: {
          count: { $sum: 1 }
        }
      }
    }
  ]);

  res.json({
    success: true,
    data: {
      overview: stats[0] || {
        totalResumes: 0,
        activeResumes: 0,
        hiredResumes: 0,
        rejectedResumes: 0,
        avgExperience: 0
      },
      topSkills: skillStats,
      experienceDistribution: experienceStats
    }
  });
}));

/**
 * @route   GET /api/resumes/search/skills
 * @desc    Search resumes by skills
 * @access  Private
 */
router.get('/search/skills', asyncHandler(async (req, res) => {
  const { skills, minMatch = 1 } = req.query;

  if (!skills) {
    return res.status(400).json({
      success: false,
      message: 'Skills parameter is required'
    });
  }

  const skillArray = Array.isArray(skills) ? skills : skills.split(',');
  const minMatchInt = parseInt(minMatch);

  const resumes = await Resume.findBySkills(skillArray, minMatchInt)
    .populate('uploadedBy', 'name email');

  res.json({
    success: true,
    data: { resumes }
  });
}));

module.exports = router;
