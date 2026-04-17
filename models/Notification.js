const mongoose = require('mongoose');

/**
 * Notification Schema — Email & In-App Notifications
 * Tracks all notifications sent to users (email delivery status, read state, etc.)
 */

const notificationSchema = new mongoose.Schema({
    // ── Recipient ──────────────────────────────────────────────────
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        index: true
    },
    email: {
        type: String,
        required: true,
        trim: true,
        lowercase: true
    },

    // ── Content ────────────────────────────────────────────────────
    subject: { type: String, required: true, maxlength: 200 },
    body: { type: String, required: true, maxlength: 10000 },
    template: {
        type: String,
        enum: [
            'application_received',
            'shortlisted',
            'rejected',
            'interview_scheduled',
            'offer_letter',
            'new_candidate_hr',
            'stage_change',
            'custom'
        ],
        default: 'custom'
    },

    // ── Context references (optional) ─────────────────────────────
    applicationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Application' },
    jobId: { type: mongoose.Schema.Types.ObjectId, ref: 'Job' },

    // ── Delivery ───────────────────────────────────────────────────
    channel: {
        type: String,
        enum: ['email', 'in_app', 'both'],
        default: 'email'
    },
    emailStatus: {
        type: String,
        enum: ['pending', 'sent', 'failed', 'skipped'],
        default: 'pending'
    },
    emailError: { type: String },
    sentAt: { type: Date },

    // ── In-app state ───────────────────────────────────────────────
    isRead: { type: Boolean, default: false },
    readAt: { type: Date }
}, {
    timestamps: true
});

notificationSchema.index({ userId: 1, isRead: 1, createdAt: -1 });
notificationSchema.index({ emailStatus: 1, createdAt: -1 });

module.exports = mongoose.model('Notification', notificationSchema);
