const analyticsService = require('../services/analyticsService');
const { ok, serverError } = require('../utils/apiResponse');

/**
 * Analytics Controller — Reporting & KPI endpoints.
 */

// ── GET /api/v2/analytics/overview ──────────────────────────────
exports.getOverview = async (req, res) => {
    try {
        const stats = await analyticsService.getOverviewStats();
        return ok(res, 'Overview stats fetched', stats);
    } catch (error) {
        return serverError(res, 'Failed to fetch overview', error);
    }
};

// ── GET /api/v2/analytics/pipeline ──────────────────────────────
exports.getPipeline = async (req, res) => {
    try {
        const { jobId } = req.query;
        const data = await analyticsService.getPipelineDistribution(jobId);
        return ok(res, 'Pipeline distribution fetched', data);
    } catch (error) {
        return serverError(res, 'Failed to fetch pipeline distribution', error);
    }
};

// ── GET /api/v2/analytics/top-jobs ──────────────────────────────
exports.getTopJobs = async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 10;
        const data = await analyticsService.getTopJobsByApplicants(limit);
        return ok(res, 'Top jobs fetched', data);
    } catch (error) {
        return serverError(res, 'Failed to fetch top jobs', error);
    }
};

// ── GET /api/v2/analytics/skills ────────────────────────────────
exports.getSkillDemand = async (req, res) => {
    try {
        const data = await analyticsService.getSkillDemand();
        return ok(res, 'Skill demand fetched', data);
    } catch (error) {
        return serverError(res, 'Failed to fetch skill demand', error);
    }
};

// ── GET /api/v2/analytics/scores ────────────────────────────────
exports.getScoreDistribution = async (req, res) => {
    try {
        const data = await analyticsService.getScoreDistribution();
        return ok(res, 'Score distribution fetched', data);
    } catch (error) {
        return serverError(res, 'Failed to fetch scores', error);
    }
};

// ── GET /api/v2/analytics/monthly ───────────────────────────────
exports.getMonthlyTrend = async (req, res) => {
    try {
        const months = parseInt(req.query.months) || 6;
        const data = await analyticsService.getMonthlyTrend(months);
        return ok(res, 'Monthly trend fetched', data);
    } catch (error) {
        return serverError(res, 'Failed to fetch monthly trend', error);
    }
};

// ── GET /api/v2/analytics/interviews ────────────────────────────
exports.getInterviewStats = async (req, res) => {
    try {
        const data = await analyticsService.getInterviewStats();
        return ok(res, 'Interview stats fetched', data);
    } catch (error) {
        return serverError(res, 'Failed to fetch interview stats', error);
    }
};
