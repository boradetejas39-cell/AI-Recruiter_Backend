const express = require('express');
const mongoose = require('mongoose');
const Job = require('../models/Job');
const Resume = require('../models/Resume');
const Match = require('../models/Match');
const User = require('../models/User');
const { protect, authorize, hrOnly, adminOnly, hrOrAdmin } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');

/** True when Mongoose has an active MongoDB connection */
const isMongoConnected = () => mongoose.connection.readyState === 1;

const router = express.Router();

// All routes are protected
router.use(protect);

/**
 * @route   GET /api/dashboard/overview
 * @desc    Get dashboard overview statistics
 * @access  Private (HR, Admin)
 */
router.get('/overview', authorize('hr', 'admin'), asyncHandler(async (req, res) => {
  let totalJobs = 0, activeJobs = 0, totalResumes = 0, activeResumes = 0, totalMatches = 0, totalUsers = 0;
  let recentJobs = [], recentResumes = [], recentMatches = [], topMatches = [];

  if (isMongoConnected()) {
    // MongoDB path
    totalJobs = await Job.countDocuments();
    activeJobs = await Job.countDocuments({ status: 'active' });
    totalResumes = await Resume.countDocuments();
    activeResumes = await Resume.countDocuments({ status: 'active' });
    totalMatches = await Match.countDocuments();
    totalUsers = await User.countDocuments();

    recentJobs = await Job.find().sort({ createdAt: -1 }).limit(5).lean();
    recentResumes = await Resume.find().sort({ createdAt: -1 }).limit(5)
      .select('candidateName email status skills createdAt uploadedBy').lean();
    recentMatches = await Match.find().sort({ createdAt: -1 }).limit(5).lean();
    topMatches = await Match.find({ score: { $gte: 60 } })
      .sort({ score: -1 })
      .limit(10)
      .populate('resumeId', 'candidateName email skills')
      .populate('jobId', 'title location')
      .lean();
    // Format topMatches for frontend
    topMatches = topMatches
      .filter(m => m.resumeId && m.jobId)
      .map(m => ({
        candidateName: m.resumeId?.candidateName || 'Unknown',
        email: m.resumeId?.email || '',
        jobTitle: m.jobId?.title || 'Unknown Job',
        jobLocation: m.jobId?.location || '',
        matchScore: m.score,
        matchId: m._id,
        resumeId: m.resumeId?._id,
        jobId: m.jobId?._id
      }));
  } else if (global.fileDB) {
    // File-based database path
    const jobs = global.fileDB.read('jobs');
    const resumes = global.fileDB.read('resumes');
    const matches = global.fileDB.read('matches');
    const users = global.fileDB.read('users');

    totalJobs = jobs.length;
    activeJobs = jobs.filter(job => job.status === 'active').length;
    totalResumes = resumes.length;
    activeResumes = resumes.filter(resume => resume.status === 'active').length;
    totalMatches = matches.length;
    totalUsers = users.length;

    recentJobs = jobs.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 5);
    recentResumes = resumes.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 5);
    recentMatches = matches.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 5);
    topMatches = matches.filter(m => m.score >= 80).sort((a, b) => b.score - a.score).slice(0, 10);
  } else {
    // Memory store fallback
    const jobs = global.jobs || [];
    const resumes = global.resumes || [];
    const matches = global.matches || [];

    totalJobs = jobs.length;
    activeJobs = jobs.filter(job => job.status === 'active').length;
    totalResumes = resumes.length;
    activeResumes = resumes.filter(resume => resume.status === 'active').length;
    totalMatches = matches.length;
    totalUsers = 0;

    recentJobs = jobs.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 5);
    recentResumes = resumes.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 5);
    recentMatches = matches.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 5);
    topMatches = matches.filter(m => m.score >= 80).sort((a, b) => b.score - a.score).slice(0, 10);
  }

  // Calculate matched candidates and average match score
  let matchedCandidates = 0;
  let averageMatchScore = 0;

  if (isMongoConnected()) {
    try {
      // Count unique resumes that have at least one match
      const uniqueResumes = await Match.distinct('resumeId');
      matchedCandidates = uniqueResumes.length;

      // Calculate average match score
      const scoreAgg = await Match.aggregate([
        { $group: { _id: null, avgScore: { $avg: '$score' } } }
      ]);
      averageMatchScore = scoreAgg.length > 0 ? Math.round(scoreAgg[0].avgScore) : 0;
    } catch (err) {
      console.error('Error calculating match stats:', err.message);
    }
  }

  // Build per-job matching candidate counts
  let jobMatchCounts = [];
  if (isMongoConnected()) {
    try {
      jobMatchCounts = await Match.aggregate([
        { $group: { _id: '$jobId', candidateCount: { $sum: 1 }, avgScore: { $avg: '$score' }, topScore: { $max: '$score' } } },
        { $lookup: { from: 'jobs', localField: '_id', foreignField: '_id', as: 'job' } },
        { $unwind: '$job' },
        { $project: { jobId: '$_id', title: '$job.title', candidateCount: 1, avgScore: { $round: ['$avgScore', 0] }, topScore: { $round: ['$topScore', 0] } } },
        { $sort: { candidateCount: -1 } },
        { $limit: 20 }
      ]);
    } catch (err) {
      console.error('Error calculating job match counts:', err.message);
    }
  }

    const recentUsers = await User.find().sort({ createdAt: -1 }).limit(5).select('name email role createdAt').lean();

    res.json({
      success: true,
      data: {
        stats: {
          totalJobs,
          activeJobs,
          totalResumes,
          activeResumes,
          totalMatches,
          totalUsers,
          matchedCandidates,
          averageMatchScore
        },
        recentActivity: {
          jobs: recentJobs,
          resumes: recentResumes,
          matches: recentMatches,
          users: recentUsers
        },
        topMatches,
        jobMatchCounts
      }
    });
}));

/**
 * @route   GET /api/dashboard/analytics
 * @desc    Get detailed analytics data
 * @access  Private (HR, Admin)
 */
router.get('/analytics', authorize('hr', 'admin'), asyncHandler(async (req, res) => {
  let jobAnalytics = [], resumeAnalytics = [], matchAnalytics = [];
  let jobTypeDistribution = [], departmentDistribution = [], skillDemand = [];
  let scoreDistribution = [], statusDistribution = [], experienceDistribution = [];

  if (isMongoConnected()) {
    // MongoDB path
    const { period = '30' } = req.query;
    const daysAgo = parseInt(period);
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysAgo);

    jobAnalytics = await Job.aggregate([
      { $match: { createdAt: { $gte: startDate } } },
      {
        $group: {
          _id: { year: { $year: '$createdAt' }, month: { $month: '$createdAt' }, day: { $dayOfMonth: '$createdAt' } },
          count: { $sum: 1 }
        }
      },
      { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 } }
    ]);

    resumeAnalytics = await Resume.aggregate([
      { $match: { createdAt: { $gte: startDate } } },
      {
        $group: {
          _id: { year: { $year: '$createdAt' }, month: { $month: '$createdAt' }, day: { $dayOfMonth: '$createdAt' } },
          count: { $sum: 1 }
        }
      },
      { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 } }
    ]);

    matchAnalytics = await Match.aggregate([
      { $match: { createdAt: { $gte: startDate } } },
      {
        $group: {
          _id: { year: { $year: '$createdAt' }, month: { $month: '$createdAt' }, day: { $dayOfMonth: '$createdAt' } },
          count: { $sum: 1 },
          avgScore: { $avg: '$score' }
        }
      },
      { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 } }
    ]);

    jobTypeDistribution = await Job.aggregate([
      { $group: { _id: '$jobType', count: { $sum: 1 } } }
    ]);

    departmentDistribution = await Job.aggregate([
      { $group: { _id: '$department', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 }
    ]);

    skillDemand = await Job.aggregate([
      { $unwind: '$requiredSkills' },
      { $group: { _id: '$requiredSkills', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 20 }
    ]);

    scoreDistribution = await Match.aggregate([
      {
        $bucket: {
          groupBy: '$score',
          boundaries: [0, 20, 40, 60, 80, 100],
          default: '100',
          output: { count: { $sum: 1 }, avgScore: { $avg: '$score' } }
        }
      }
    ]);

    statusDistribution = await Match.aggregate([
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ]);

    experienceDistribution = await Resume.aggregate([
      { $match: { status: 'active' } },
      {
        $bucket: {
          groupBy: '$totalExperience',
          boundaries: [0, 1, 3, 5, 10, 20],
          default: '20+',
          output: { count: { $sum: 1 } }
        }
      }
    ]);
  } else if (global.fileDB) {
    // File-based database path
    const jobs = global.fileDB.read('jobs');
    const resumes = global.fileDB.read('resumes');
    const matches = global.fileDB.read('matches');

    const { period = '30' } = req.query;
    const daysAgo = parseInt(period);
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysAgo);

    const recentJobs = jobs.filter(job => new Date(job.createdAt) >= startDate);
    const jobCounts = {};
    recentJobs.forEach(job => {
      const date = new Date(job.createdAt).toDateString();
      jobCounts[date] = (jobCounts[date] || 0) + 1;
    });
    jobAnalytics = Object.entries(jobCounts).map(([date, count]) => ({
      _id: { date },
      count
    }));

    const recentResumes = resumes.filter(resume => new Date(resume.createdAt) >= startDate);
    const resumeCounts = {};
    recentResumes.forEach(resume => {
      const date = new Date(resume.createdAt).toDateString();
      resumeCounts[date] = (resumeCounts[date] || 0) + 1;
    });
    resumeAnalytics = Object.entries(resumeCounts).map(([date, count]) => ({
      _id: { date },
      count
    }));

    const recentMatches = matches.filter(match => new Date(match.createdAt) >= startDate);
    const matchCounts = {};
    recentMatches.forEach(match => {
      const date = new Date(match.createdAt).toDateString();
      matchCounts[date] = (matchCounts[date] || 0) + 1;
    });
    matchAnalytics = Object.entries(matchCounts).map(([date, count]) => ({
      _id: { date },
      count
    }));

    const jobTypeCounts = {};
    jobs.forEach(job => {
      jobTypeCounts[job.jobType || 'unknown'] = (jobTypeCounts[job.jobType || 'unknown'] || 0) + 1;
    });
    jobTypeDistribution = Object.entries(jobTypeCounts).map(([type, count]) => ({
      _id: type,
      count
    }));

    const deptCounts = {};
    jobs.forEach(job => {
      const dept = job.department || 'unknown';
      deptCounts[dept] = (deptCounts[dept] || 0) + 1;
    });
    departmentDistribution = Object.entries(deptCounts)
      .map(([dept, count]) => ({ _id: dept, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    const skillCounts = {};
    jobs.forEach(job => {
      if (job.requiredSkills) {
        job.requiredSkills.forEach(skill => {
          skillCounts[skill] = (skillCounts[skill] || 0) + 1;
        });
      }
    });
    skillDemand = Object.entries(skillCounts)
      .map(([skill, count]) => ({ _id: skill, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 20);

    const scoreBuckets = { '0-20': 0, '20-40': 0, '40-60': 0, '60-80': 0, '80-100': 0 };
    matches.forEach(match => {
      const score = match.score || 0;
      if (score < 20) scoreBuckets['0-20']++;
      else if (score < 40) scoreBuckets['20-40']++;
      else if (score < 60) scoreBuckets['40-60']++;
      else if (score < 80) scoreBuckets['60-80']++;
      else scoreBuckets['80-100']++;
    });
    scoreDistribution = Object.entries(scoreBuckets).map(([range, count]) => ({
      _id: range,
      count
    }));

    const statusCounts = {};
    matches.forEach(match => {
      const status = match.status || 'unknown';
      statusCounts[status] = (statusCounts[status] || 0) + 1;
    });
    statusDistribution = Object.entries(statusCounts).map(([status, count]) => ({
      _id: status,
      count
    }));

    const expBuckets = { '0-1': 0, '1-3': 0, '3-5': 0, '5-10': 0, '10-20': 0, '20+': 0 };
    resumes.filter(resume => resume.status === 'active').forEach(resume => {
      const exp = resume.totalExperience || 0;
      if (exp < 1) expBuckets['0-1']++;
      else if (exp < 3) expBuckets['1-3']++;
      else if (exp < 5) expBuckets['3-5']++;
      else if (exp < 10) expBuckets['5-10']++;
      else if (exp < 20) expBuckets['10-20']++;
      else expBuckets['20+']++;
    });
    experienceDistribution = Object.entries(expBuckets).map(([range, count]) => ({
      _id: range,
      count
    }));
  }

  res.json({
    success: true,
    data: {
      trends: {
        jobs: jobAnalytics,
        resumes: resumeAnalytics,
        matches: matchAnalytics
      },
      distributions: {
        jobTypes: jobTypeDistribution,
        departments: departmentDistribution,
        skills: skillDemand,
        scores: scoreDistribution,
        status: statusDistribution,
        experience: experienceDistribution
      }
    }
  });
}));

/**
 * @route   GET /api/dashboard/performance
 * @desc    Get performance metrics
 * @access  Private (HR, Admin)
 */
router.get('/performance', authorize('hr', 'admin'), asyncHandler(async (req, res) => {
  // Average match score over time
  const avgScoreOverTime = await Match.aggregate([
    {
      $group: {
        _id: {
          year: { $year: '$createdAt' },
          month: { $month: '$createdAt' }
        },
        avgScore: { $avg: '$score' },
        count: { $sum: 1 }
      }
    },
    {
      $sort: { '_id.year': 1, '_id.month': 1 }
    }
  ]);

  // Top performing jobs (highest average match scores)
  const topPerformingJobs = await Job.aggregate([
    {
      $lookup: {
        from: 'matches',
        localField: '_id',
        foreignField: 'jobId',
        as: 'matches'
      }
    },
    {
      $addFields: {
        avgMatchScore: { $avg: '$matches.score' },
        totalMatches: { $size: '$matches' }
      }
    },
    {
      $match: {
        totalMatches: { $gt: 0 }
      }
    },
    {
      $sort: { avgMatchScore: -1 }
    },
    {
      $limit: 10
    },
    {
      $project: {
        title: 1,
        location: 1,
        avgMatchScore: 1,
        totalMatches: 1,
        status: 1
      }
    }
  ]);

  // Conversion rates (matches to hires)
  const conversionRates = await Match.aggregate([
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 }
      }
    }
  ]);

  // Time to hire analysis
  const timeToHire = await Match.aggregate([
    {
      $match: {
        status: 'hired',
        reviewedAt: { $exists: true }
      }
    },
    {
      $addFields: {
        timeToHire: {
          $divide: [
            { $subtract: ['$reviewedAt', '$createdAt'] },
            1000 * 60 * 60 * 24 // Convert to days
          ]
        }
      }
    },
    {
      $group: {
        _id: null,
        avgTimeToHire: { $avg: '$timeToHire' },
        minTimeToHire: { $min: '$timeToHire' },
        maxTimeToHire: { $max: '$timeToHire' },
        count: { $sum: 1 }
      }
    }
  ]);

  // Skill match effectiveness
  const skillEffectiveness = await Match.aggregate([
    {
      $addFields: {
        skillMatchPercentage: '$breakdown.skillMatch.score'
      }
    },
    {
      $bucket: {
        groupBy: '$skillMatchPercentage',
        boundaries: [0, 25, 50, 75, 100],
        default: '100',
        output: {
          count: { $sum: 1 },
          avgOverallScore: { $avg: '$score' }
        }
      }
    }
  ]);

  res.json({
    success: true,
    data: {
      avgScoreOverTime,
      topPerformingJobs,
      conversionRates,
      timeToHire: timeToHire[0] || {
        avgTimeToHire: 0,
        minTimeToHire: 0,
        maxTimeToHire: 0,
        count: 0
      },
      skillEffectiveness
    }
  });
}));

/**
 * @route   GET /api/dashboard/alerts
 * @desc    Get system alerts and notifications
 * @access  Private (HR, Admin)
 */
router.get('/alerts', authorize('hr', 'admin'), asyncHandler(async (req, res) => {
  const alerts = [];

  if (isMongoConnected()) {
    // MongoDB path
    const jobsWithoutApplicants = await Job.countDocuments({
      status: 'active',
      createdAt: { $lte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
    });

    if (jobsWithoutApplicants > 0) {
      alerts.push({
        type: 'warning',
        title: 'Jobs Without Applicants',
        message: `${jobsWithoutApplicants} active jobs have no applicants`,
        count: jobsWithoutApplicants
      });
    }

    const highPriorityJobs = await Job.countDocuments({
      status: 'active',
      priority: { $in: ['high', 'urgent'] }
    });

    if (highPriorityJobs > 0) {
      alerts.push({
        type: 'info',
        title: 'High Priority Jobs',
        message: `${highPriorityJobs} high priority jobs need attention`,
        count: highPriorityJobs
      });
    }

    const pendingMatches = await Match.countDocuments({
      status: 'pending',
      createdAt: { $lte: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000) }
    });

    if (pendingMatches > 0) {
      alerts.push({
        type: 'warning',
        title: 'Pending Matches',
        message: `${pendingMatches} matches pending review`,
        count: pendingMatches
      });
    }

    const lowScoringMatches = await Match.countDocuments({
      score: { $lt: 30 },
      status: { $in: ['pending', 'reviewed'] }
    });

    if (lowScoringMatches > 0) {
      alerts.push({
        type: 'info',
        title: 'Low Scoring Matches',
        message: `${lowScoringMatches} matches with scores below 30%`,
        count: lowScoringMatches
      });
    }

    const newResumesThisWeek = await Resume.countDocuments({
      createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
    });

    if (newResumesThisWeek > 0) {
      alerts.push({
        type: 'success',
        title: 'New Resumes',
        message: `${newResumesThisWeek} new resumes added this week`,
        count: newResumesThisWeek
      });
    }
  } else if (global.fileDB) {
    // File-based database path
    const jobs = global.fileDB.read('jobs');
    const resumes = global.fileDB.read('resumes');
    const matches = global.fileDB.read('matches');

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const jobsWithoutApplicants = jobs.filter(job =>
      job.status === 'active' && new Date(job.createdAt) <= sevenDaysAgo
    ).length;
    if (jobsWithoutApplicants > 0) {
      alerts.push({ type: 'warning', title: 'Jobs Without Applicants', message: `${jobsWithoutApplicants} active jobs have no applicants`, count: jobsWithoutApplicants });
    }

    const highPriorityJobs = jobs.filter(job => job.status === 'active' && ['high', 'urgent'].includes(job.priority)).length;
    if (highPriorityJobs > 0) {
      alerts.push({ type: 'info', title: 'High Priority Jobs', message: `${highPriorityJobs} high priority jobs need attention`, count: highPriorityJobs });
    }

    const pendingMatches = matches.filter(match => match.status === 'pending' && new Date(match.createdAt) <= new Date(Date.now() - 3 * 24 * 60 * 60 * 1000)).length;
    if (pendingMatches > 0) {
      alerts.push({ type: 'warning', title: 'Pending Matches', message: `${pendingMatches} matches pending review`, count: pendingMatches });
    }

    const newResumesThisWeek = resumes.filter(resume => new Date(resume.createdAt) >= sevenDaysAgo).length;
    if (newResumesThisWeek > 0) {
      alerts.push({ type: 'success', title: 'New Resumes', message: `${newResumesThisWeek} new resumes added this week`, count: newResumesThisWeek });
    }
  }

  res.json({
    success: true,
    data: { alerts }
  });
}));

/**
 * @route   GET /api/dashboard/export
 * @desc    Export dashboard data
 * @access  Private (HR, Admin)
 */
router.get('/export', authorize('hr', 'admin'), asyncHandler(async (req, res) => {
  const { type = 'summary' } = req.query;

  let exportData = {};

  switch (type) {
    case 'summary':
      exportData = {
        timestamp: new Date().toISOString(),
        summary: {
          totalJobs: await Job.countDocuments(),
          activeJobs: await Job.countDocuments({ status: 'active' }),
          totalResumes: await Resume.countDocuments(),
          activeResumes: await Resume.countDocuments({ status: 'active' }),
          totalMatches: await Match.countDocuments(),
          avgMatchScore: await Match.aggregate([{ $group: { _id: null, avgScore: { $avg: '$score' } } }])
        }
      };
      break;

    case 'jobs':
      exportData = {
        timestamp: new Date().toISOString(),
        jobs: await Job.find()
          .populate('createdBy', 'name email')
          .select('title location status priority jobType createdAt')
      };
      break;

    case 'resumes':
      exportData = {
        timestamp: new Date().toISOString(),
        resumes: await Resume.find()
          .populate('uploadedBy', 'name email')
          .select('candidateName email status totalExperience createdAt')
      };
      break;

    case 'matches':
      exportData = {
        timestamp: new Date().toISOString(),
        matches: await Match.find()
          .populate('jobId', 'title location')
          .populate('resumeId', 'candidateName email')
          .select('score status createdAt')
      };
      break;

    default:
      return res.status(400).json({
        success: false,
        message: 'Invalid export type'
      });
  }

  res.json({
    success: true,
    data: exportData
  });
}));

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/dashboard/hr-summary   — HR-specific recruitment-focused metrics
// Access: HR only
// ─────────────────────────────────────────────────────────────────────────────
router.get('/hr-summary', hrOnly, asyncHandler(async (req, res) => {
  let jobs, resumes, matches;

  if (isMongoConnected()) {
    jobs = await Job.find().lean();
    resumes = await Resume.find().lean();
    matches = await Match.find().lean();
  } else if (global.fileDB) {
    jobs = global.fileDB.read('jobs');
    resumes = global.fileDB.read('resumes');
    matches = global.fileDB.read('matches');
  } else {
    jobs = []; resumes = []; matches = [];
  }

  const openJobs = jobs.filter(j => j.status === 'active');
  const pendingMatches = matches.filter(m => m.status === 'pending');
  const shortlisted = matches.filter(m => m.status === 'shortlisted');
  const recentResumes = resumes
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 5)
    .map(({ rawText, filePath, ...safe }) => safe);  // strip large fields

  res.json({
    success: true,
    data: {
      role: 'hr',
      summary: {
        openJobs: openJobs.length,
        pendingMatches: pendingMatches.length,
        shortlisted: shortlisted.length,
        totalResumes: resumes.length
      },
      recentResumes,
      urgentJobs: openJobs
        .filter(j => ['high', 'urgent'].includes(j.priority))
        .map(({ description, ...safe }) => safe)
        .slice(0, 5)
    }
  });
}));

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/dashboard/admin-summary  — Admin-specific system-wide metrics
// Access: Admin only
// ─────────────────────────────────────────────────────────────────────────────
router.get('/admin-summary', adminOnly, asyncHandler(async (req, res) => {
  let users, jobs, resumes, matches;

  if (isMongoConnected()) {
    users = await User.find().lean();
    jobs = await Job.find().lean();
    resumes = await Resume.find().lean();
    matches = await Match.find().lean();
  } else if (global.fileDB) {
    users = global.fileDB.read('users');
    jobs = global.fileDB.read('jobs');
    resumes = global.fileDB.read('resumes');
    matches = global.fileDB.read('matches');
  } else {
    users = []; jobs = []; resumes = []; matches = [];
  }

  const avgScore = matches.length
    ? Math.round(matches.reduce((s, m) => s + (m.score || 0), 0) / matches.length)
    : 0;

  res.json({
    success: true,
    data: {
      role: 'admin',
      systemHealth: {
        databaseMode: isMongoConnected() ? 'mongodb' : (global.fileDB ? 'file-based' : 'memory'),
        serverTime: new Date().toISOString()
      },
      users: {
        total: users.length,
        admins: users.filter(u => u.role === 'admin').length,
        hr: users.filter(u => u.role === 'hr').length,
        active: users.filter(u => u.isActive).length,
        inactive: users.filter(u => !u.isActive).length
      },
      platform: {
        totalJobs: jobs.length,
        activeJobs: jobs.filter(j => j.status === 'active').length,
        totalResumes: resumes.length,
        totalMatches: matches.length,
        avgMatchScore: avgScore
      }
    }
  });
}));

module.exports = router;
