const mongoose = require('mongoose');
const Application = require('../models/Application');
const Interview = require('../models/Interview');
const ActivityLog = require('../models/ActivityLog');
const emailService = require('./emailService');
const logger = require('../utils/logger');

/**
 * Pipeline Service — Manages candidate movement through hiring stages.
 *
 * Stages: applied → resume_screened → ai_interview → technical_round → final_hr → selected | rejected
 *
 * Handles validation, history tracking, notifications, and activity logging.
 */

// Stage ordering for forward-only validation (index ↑ = further along)
const STAGE_ORDER = [
    'applied',
    'resume_screened',
    'ai_interview',
    'technical_round',
    'final_hr',
    'selected',
    'rejected'
];

class PipelineService {
    /**
     * Move an application to a new stage.
     *
     * @param {string} applicationId  Application ObjectId
     * @param {string} toStage        Target stage name
     * @param {Object} opts           { notes?, changedBy?, skipNotification? }
     * @returns {Object}              Updated application document
     */
    async moveStage(applicationId, toStage, opts = {}) {
        const { notes = '', changedBy = null, skipNotification = false } = opts;

        const app = await Application.findById(applicationId)
            .populate('jobId', 'title location')
            .populate('resumeId', 'candidateName email');

        if (!app) throw new Error('Application not found');
        if (!STAGE_ORDER.includes(toStage)) throw new Error(`Invalid stage: ${toStage}`);

        const currentIdx = STAGE_ORDER.indexOf(app.currentStage);
        const targetIdx = STAGE_ORDER.indexOf(toStage);

        // "rejected" can come from any stage; otherwise enforce forward movement
        if (toStage !== 'rejected' && targetIdx <= currentIdx) {
            throw new Error(`Cannot move from "${app.currentStage}" to "${toStage}". Stage must advance forward.`);
        }

        // Close the current stage in history
        const lastHistory = app.stageHistory[app.stageHistory.length - 1];
        if (lastHistory && !lastHistory.exitedAt) {
            lastHistory.exitedAt = new Date();
        }

        // Push new stage entry
        app.stageHistory.push({
            stage: toStage,
            enteredAt: new Date(),
            notes,
            changedBy
        });

        app.currentStage = toStage;
        if (toStage === 'selected') app.hiredAt = new Date();
        if (toStage === 'rejected') app.rejectedAt = new Date();

        await app.save();

        // ── Activity log ──────────────────────────────────────────
        try {
            await ActivityLog.record({
                userId: changedBy,
                action: toStage === 'selected' ? 'candidate_selected'
                    : toStage === 'rejected' ? 'candidate_rejected'
                        : 'application_stage_changed',
                description: `Application ${applicationId} moved to "${toStage}"`,
                targetModel: 'Application',
                targetId: app._id,
                metadata: { fromStage: STAGE_ORDER[currentIdx], toStage, notes }
            });
        } catch (e) { logger.warn('Activity log failed', { error: e.message }); }

        // ── Email notification ────────────────────────────────────
        if (!skipNotification && app.resumeId?.email) {
            const emailData = {
                candidateName: app.resumeId.candidateName,
                jobTitle: app.jobId?.title || 'Unknown',
                stage: toStage,
                notes
            };

            if (toStage === 'rejected') {
                emailService.sendEmail(app.resumeId.email, 'rejected', emailData).catch(() => { });
            } else if (toStage === 'selected') {
                emailService.sendEmail(app.resumeId.email, 'offer_letter', emailData).catch(() => { });
            } else if (toStage === 'resume_screened') {
                emailService.sendEmail(app.resumeId.email, 'shortlisted', emailData).catch(() => { });
            } else {
                emailService.sendEmail(app.resumeId.email, 'stage_change', emailData).catch(() => { });
            }
        }

        logger.info(`Pipeline: ${applicationId} → ${toStage}`, { notes });
        return app;
    }

    /**
     * Get pipeline summary for a job — counts per stage.
     */
    async getJobPipeline(jobId) {
        const stages = await Application.countByStage(jobId);
        // Fill in zeros for stages with no applications
        const result = {};
        for (const s of STAGE_ORDER) {
            const found = stages.find(st => st._id === s);
            result[s] = found ? found.count : 0;
        }
        return result;
    }

    /**
     * Get full stage history for an application.
     */
    async getStageHistory(applicationId) {
        const app = await Application.findById(applicationId)
            .select('currentStage stageHistory appliedAt hiredAt rejectedAt')
            .populate('stageHistory.changedBy', 'name email');
        if (!app) throw new Error('Application not found');
        return {
            currentStage: app.currentStage,
            appliedAt: app.appliedAt,
            hiredAt: app.hiredAt,
            rejectedAt: app.rejectedAt,
            history: app.stageHistory
        };
    }
}

module.exports = new PipelineService();
