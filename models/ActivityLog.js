const mongoose = require('mongoose');

/**
 * ActivityLog Schema — Admin Audit Trail
 * Records every significant action in the system for admin review.
 */

const activityLogSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        index: true
    },
    action: {
        type: String,
        required: true,
        enum: [
            'user_register', 'user_login', 'user_logout', 'user_blocked', 'user_deleted',
            'password_reset_request', 'password_reset_complete',
            'job_created', 'job_updated', 'job_deleted', 'job_closed',
            'resume_uploaded', 'resume_deleted',
            'application_submitted', 'application_rescreened', 'application_status_changed', 'application_stage_changed',
            'screening_completed', 'interview_started', 'interview_completed',
            'candidate_selected', 'candidate_rejected',
            'notification_sent',
            'admin_action', 'system_event'
        ],
        index: true
    },
    description: { type: String, maxlength: 1000 },

    // ── Target resource ────────────────────────────────────────────
    targetModel: {
        type: String,
        enum: ['User', 'Job', 'Resume', 'Application', 'Interview', 'Match', 'Notification', null]
    },
    targetId: { type: mongoose.Schema.Types.ObjectId },

    // ── Additional metadata ────────────────────────────────────────
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
    ip: { type: String },
    userAgent: { type: String }
}, {
    timestamps: true
});

activityLogSchema.index({ createdAt: -1 });
activityLogSchema.index({ action: 1, createdAt: -1 });

/**
 * Static helper: create a log entry conveniently
 */
activityLogSchema.statics.record = function (data) {
    return this.create(data);
};

module.exports = mongoose.model('ActivityLog', activityLogSchema);
