const mongoose = require('mongoose');
const Job = require('../models/Job');
const Resume = require('../models/Resume');
const Application = require('../models/Application');
const Match = require('../models/Match');
const Interview = require('../models/Interview');
const User = require('../models/User');
const logger = require('../utils/logger');

/**
 * Analytics Service — Aggregation queries for reporting endpoints.
 *
 * All methods return plain objects suitable for JSON serialisation.
 */

class AnalyticsService {
    /**
     * Core KPIs — overview numbers for the dashboard.
     */
    async getOverviewStats() {
        const [
            totalJobs,
            activeJobs,
            totalCandidates,
            totalApplications,
            totalMatches,
            totalInterviews,
            totalUsers
        ] = await Promise.all([
            Job.countDocuments(),
            Job.countDocuments({ status: 'active' }),
            Resume.countDocuments(),
            Application.countDocuments(),
            Match.countDocuments(),
            Interview.countDocuments(),
            User.countDocuments()
        ]);

        // Shortlisted = those past resume_screened stage
        const shortlisted = await Application.countDocuments({
            currentStage: { $in: ['ai_interview', 'technical_round', 'final_hr', 'selected'] }
        });

        // Average match score
        const scoreAgg = await Match.aggregate([
            { $group: { _id: null, avg: { $avg: '$score' } } }
        ]);
        const averageMatchScore = scoreAgg.length > 0 ? Math.round(scoreAgg[0].avg) : 0;

        // Hiring success rate = selected / total applications
        const selected = await Application.countDocuments({ currentStage: 'selected' });
        const hiringSuccessRate = totalApplications > 0
            ? Math.round((selected / totalApplications) * 100)
            : 0;

        // Average time-to-hire (for selected candidates with hiredAt)
        const timeAgg = await Application.aggregate([
            { $match: { currentStage: 'selected', hiredAt: { $ne: null } } },
            { $project: { diff: { $subtract: ['$hiredAt', '$appliedAt'] } } },
            { $group: { _id: null, avg: { $avg: '$diff' } } }
        ]);
        const avgTimeToHireDays = timeAgg.length > 0
            ? Math.round(timeAgg[0].avg / (1000 * 60 * 60 * 24))
            : null;

        return {
            totalJobs,
            activeJobs,
            totalCandidates,
            totalApplications,
            shortlisted,
            selected,
            totalMatches,
            totalInterviews,
            totalUsers,
            averageMatchScore,
            hiringSuccessRate,
            avgTimeToHireDays
        };
    }

    /**
     * Pipeline distribution — how many candidates at each stage.
     */
    async getPipelineDistribution() {
        const stages = await Application.aggregate([
            { $match: { isActive: true } },
            { $group: { _id: '$currentStage', count: { $sum: 1 } } },
            { $sort: { count: -1 } }
        ]);
        return stages.map(s => ({ stage: s._id, count: s.count }));
    }

    /**
     * Top jobs by number of candidates.
     */
    async getTopJobsByApplicants(limit = 10) {
        return Application.aggregate([
            { $group: { _id: '$jobId', count: { $sum: 1 }, avgScore: { $avg: '$screeningResult.matchScore' } } },
            { $lookup: { from: 'jobs', localField: '_id', foreignField: '_id', as: 'job' } },
            { $unwind: '$job' },
            { $project: { jobId: '$_id', title: '$job.title', location: '$job.location', count: 1, avgScore: { $round: ['$avgScore', 0] } } },
            { $sort: { count: -1 } },
            { $limit: limit }
        ]);
    }

    /**
     * Skill demand — most requested skills across all active jobs.
     */
    async getSkillDemand(limit = 20) {
        return Job.aggregate([
            { $match: { status: 'active' } },
            { $unwind: '$requiredSkills' },
            { $group: { _id: { $toLower: '$requiredSkills' }, count: { $sum: 1 } } },
            { $sort: { count: -1 } },
            { $limit: limit },
            { $project: { skill: '$_id', count: 1, _id: 0 } }
        ]);
    }

    /**
     * Match-score distribution (histogram buckets).
     */
    async getScoreDistribution() {
        const buckets = [
            { label: '0-20', min: 0, max: 20 },
            { label: '21-40', min: 21, max: 40 },
            { label: '41-60', min: 41, max: 60 },
            { label: '61-80', min: 61, max: 80 },
            { label: '81-100', min: 81, max: 100 }
        ];

        const result = await Promise.all(
            buckets.map(async (b) => {
                const count = await Match.countDocuments({ score: { $gte: b.min, $lte: b.max } });
                return { range: b.label, count };
            })
        );
        return result;
    }

    /**
     * Monthly application trend (last N months).
     */
    async getMonthlyTrend(months = 6) {
        const startDate = new Date();
        startDate.setMonth(startDate.getMonth() - months);

        return Application.aggregate([
            { $match: { createdAt: { $gte: startDate } } },
            {
                $group: {
                    _id: { year: { $year: '$createdAt' }, month: { $month: '$createdAt' } },
                    applications: { $sum: 1 },
                    hired: { $sum: { $cond: [{ $eq: ['$currentStage', 'selected'] }, 1, 0] } }
                }
            },
            { $sort: { '_id.year': 1, '_id.month': 1 } },
            {
                $project: {
                    _id: 0,
                    month: { $concat: [{ $toString: '$_id.year' }, '-', { $toString: '$_id.month' }] },
                    applications: 1,
                    hired: 1
                }
            }
        ]);
    }

    /**
     * Interview performance stats.
     */
    async getInterviewStats() {
        const stats = await Interview.aggregate([
            { $match: { status: { $in: ['completed', 'evaluated'] } } },
            {
                $group: {
                    _id: null,
                    total: { $sum: 1 },
                    avgScore: { $avg: '$overallScore' },
                    strongHire: { $sum: { $cond: [{ $eq: ['$recommendation', 'strong_hire'] }, 1, 0] } },
                    hire: { $sum: { $cond: [{ $eq: ['$recommendation', 'hire'] }, 1, 0] } },
                    maybe: { $sum: { $cond: [{ $eq: ['$recommendation', 'maybe'] }, 1, 0] } },
                    reject: { $sum: { $cond: [{ $eq: ['$recommendation', 'reject'] }, 1, 0] } }
                }
            }
        ]);
        return stats.length > 0 ? stats[0] : { total: 0, avgScore: 0, strongHire: 0, hire: 0, maybe: 0, reject: 0 };
    }
}

module.exports = new AnalyticsService();
