const mongoose = require('mongoose');

/**
 * Application Schema — Candidate Job Applications
 * Tracks each candidate's application lifecycle from submission to final decision.
 * Links a Resume to a Job and stores the full pipeline history.
 */

const PIPELINE_STAGES = [
    'applied',
    'screening',
    'shortlisted',
    'interview',
    'evaluation',
    'offer',
    'hired',
    'rejected',
    'withdrawn'
];

const stageHistorySchema = new mongoose.Schema({
    stage: { type: String, enum: PIPELINE_STAGES, required: true },
    enteredAt: { type: Date, default: Date.now },
    exitedAt: { type: Date, default: null },
    notes: { type: String, maxlength: 2000 },
    changedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { _id: true });

const applicationSchema = new mongoose.Schema({
    // ── Core references ────────────────────────────────────────────
    jobId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Job',
        required: [true, 'Job ID is required'],
        index: true
    },
    resumeId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Resume',
        required: [true, 'Resume ID is required'],
        index: true
    },
    candidateId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        index: true
    },

    // ── Application data ──────────────────────────────────────────
    coverLetter: { type: String, maxlength: 3000 },

    // ── Pipeline tracking ─────────────────────────────────────────
    currentStage: {
        type: String,
        enum: PIPELINE_STAGES,
        default: 'applied',
        index: true
    },
    stageHistory: [stageHistorySchema],

    // ── AI screening results (populated after resume screening) ───
    screeningResult: {
        matchScore: { type: Number, min: 0, max: 100 },
        strengths: [String],
        weaknesses: [String],
        recommendation: {
            type: String,
            enum: ['hire', 'maybe', 'reject', null],
            default: null
        },
        summary: { type: String, maxlength: 3000 },
        screenedAt: Date
    },

    // ── Interview reference ───────────────────────────────────────
    interviewId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Interview'
    },

    // ── Meta ───────────────────────────────────────────────────────
    isActive: { type: Boolean, default: true },
    appliedAt: { type: Date, default: Date.now },
    hiredAt: { type: Date, default: null },
    rejectedAt: { type: Date, default: null }
}, {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
});

// Compound index: one application per resume-job pair
applicationSchema.index({ jobId: 1, resumeId: 1 }, { unique: true });
applicationSchema.index({ currentStage: 1, createdAt: -1 });

// Virtual: time-to-hire (ms between applied and hired)
applicationSchema.virtual('timeToHire').get(function () {
    if (!this.hiredAt || !this.appliedAt) return null;
    return this.hiredAt - this.appliedAt;
});

// Static: count by stage for a given job
applicationSchema.statics.countByStage = async function (jobId) {
    return this.aggregate([
        { $match: { jobId: new mongoose.Types.ObjectId(jobId), isActive: true } },
        { $group: { _id: '$currentStage', count: { $sum: 1 } } },
        { $sort: { _id: 1 } }
    ]);
};

module.exports = mongoose.model('Application', applicationSchema);
module.exports.PIPELINE_STAGES = PIPELINE_STAGES;
