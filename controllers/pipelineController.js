const pipelineService = require('../services/pipelineService');
const logger = require('../utils/logger');
const { ok, serverError } = require('../utils/apiResponse');

/**
 * Pipeline Controller — Recruitment pipeline stage management.
 */

// ── PUT /api/v2/pipeline/:applicationId/move ────────────────────
exports.moveStage = async (req, res) => {
    try {
        const { toStage, notes } = req.body;
        const application = await pipelineService.moveStage(
            req.params.applicationId, toStage,
            { movedBy: req.user._id, notes }
        );
        return ok(res, `Application moved to ${toStage}`, { application });
    } catch (error) {
        logger.error('Pipeline move error', { error: error.message });
        // Service throws descriptive errors
        const status = error.message.includes('not found') ? 404 : 400;
        return res.status(status).json({ success: false, message: error.message });
    }
};

// ── GET /api/v2/pipeline/:jobId ─────────────────────────────────
exports.getJobPipeline = async (req, res) => {
    try {
        const pipeline = await pipelineService.getJobPipeline(req.params.jobId);
        return ok(res, 'Pipeline fetched', pipeline);
    } catch (error) {
        return serverError(res, 'Failed to fetch pipeline', error);
    }
};

// ── GET /api/v2/pipeline/:applicationId/history ─────────────────
exports.getStageHistory = async (req, res) => {
    try {
        const history = await pipelineService.getStageHistory(req.params.applicationId);
        return ok(res, 'Stage history fetched', history);
    } catch (error) {
        return serverError(res, 'Failed to fetch stage history', error);
    }
};
