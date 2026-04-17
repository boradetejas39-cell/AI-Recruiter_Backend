const mongoose = require('mongoose');

/**
 * Interview Schema — AI-Driven Candidate Interviews
 * Stores auto-generated questions, candidate answers, scores, and feedback.
 */

const questionSchema = new mongoose.Schema({
    questionId: { type: String, required: true },          // Unique key like "q1", "q2"
    text: { type: String, required: true, maxlength: 1000 }, // The question itself
    round: {
        type: String,
        enum: ['aptitude', 'technical', 'hr'],
        default: 'technical'
    },
    category: {
        type: String,
        enum: ['technical', 'behavioral', 'situational', 'role_specific', 'aptitude', 'hr'],
        default: 'technical'
    },
    difficulty: {
        type: String,
        enum: ['easy', 'medium', 'hard'],
        default: 'medium'
    },
    type: {
        type: String,
        enum: ['text', 'mcq'],
        default: 'text'
    },
    options: [String],
    correctAnswer: { type: String, select: false }, // Optional: hidden from client by default, or just kept in DB

    // Candidate's response
    answer: { type: String, maxlength: 5000, default: '' },
    answeredAt: { type: Date, default: null },
    // AI evaluation of this answer
    evaluation: {
        score: { type: Number, min: 0, max: 100, default: null },
        feedback: { type: String, maxlength: 2000, default: '' },
        keywords: [String]   // expected keywords that were found
    }
}, { _id: true });

const interviewSchema = new mongoose.Schema({
    // ── References ─────────────────────────────────────────────────
    applicationId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Application',
        required: true,
        index: true
    },
    jobId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Job',
        required: true,
        index: true
    },
    candidateId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    resumeId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Resume'
    },

    // ── Questions & Answers ────────────────────────────────────────
    questions: [questionSchema],
    totalQuestions: { type: Number, default: 0 },
    answeredQuestions: { type: Number, default: 0 },

    // ── Overall evaluation ─────────────────────────────────────────
    overallScore: { type: Number, min: 0, max: 100, default: null },
    feedbackSummary: { type: String, maxlength: 5000, default: '' },
    strengths: [String],
    weaknesses: [String],
    recommendation: {
        type: String,
        enum: ['strong_hire', 'hire', 'maybe', 'reject', null],
        default: null
    },

    // ── Status ─────────────────────────────────────────────────────
    status: {
        type: String,
        enum: ['pending', 'in_progress', 'completed', 'evaluated', 'expired'],
        default: 'pending',
        index: true
    },
    currentRound: {
        type: String,
        enum: ['aptitude', 'technical', 'hr'],
        default: 'aptitude'
    },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    evaluatedAt: { type: Date, default: null },
    expiresAt: { type: Date, default: null }  // optional deadline
}, {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
});

// Virtual: interview duration in minutes
interviewSchema.virtual('durationMinutes').get(function () {
    if (!this.startedAt || !this.completedAt) return null;
    return Math.round((this.completedAt - this.startedAt) / 60000);
});

// Virtual: completion percentage
interviewSchema.virtual('completionPercent').get(function () {
    if (this.totalQuestions === 0) return 0;
    return Math.round((this.answeredQuestions / this.totalQuestions) * 100);
});

module.exports = mongoose.model('Interview', interviewSchema);
