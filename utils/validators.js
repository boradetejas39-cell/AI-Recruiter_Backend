const Joi = require('joi');

/**
 * Joi Validation Schemas
 * Centralised request-body validation for every module.
 * Used via the validate() middleware in middleware/validate.js
 */

// ── Reusable field rules ────────────────────────────────────────────

const objectId = Joi.string().regex(/^[0-9a-fA-F]{24}$/).message('Invalid ObjectId');
const passwordRule = Joi.string().min(6).max(128);
const emailRule = Joi.string().email().lowercase().trim();

// ── 1. Auth ─────────────────────────────────────────────────────────

const register = Joi.object({
    name: Joi.string().trim().min(2).max(100).required(),
    email: emailRule.required(),
    password: passwordRule.required(),
    role: Joi.string().valid('admin', 'hr', 'recruiter', 'user').default('user'),
    company: Joi.string().trim().max(200).allow('', null)
});

const login = Joi.object({
    email: emailRule.required(),
    password: Joi.string().required()
});

const forgotPassword = Joi.object({
    email: emailRule.required()
});

const resetPassword = Joi.object({
    token: Joi.string().required(),
    password: passwordRule.required()
});

const changePassword = Joi.object({
    currentPassword: Joi.string().required(),
    newPassword: passwordRule.required()
});

// ── 2. Jobs ─────────────────────────────────────────────────────────

const createJob = Joi.object({
    title: Joi.string().trim().min(2).max(200).required(),
    description: Joi.string().trim().min(10).max(5000).required(),
    requiredSkills: Joi.array().items(Joi.string().trim()).min(1).required(),
    experienceRequired: Joi.object({
        min: Joi.number().min(0).default(0),
        max: Joi.number().min(0).default(0),
        experienceType: Joi.string().valid('years', 'months').default('years')
    }),
    location: Joi.string().trim().min(2).max(200).required(),
    jobType: Joi.string().valid('full-time', 'part-time', 'contract', 'internship', 'remote').default('full-time'),
    salary: Joi.object({
        min: Joi.number().min(0),
        max: Joi.number().min(0),
        currency: Joi.string().default('USD')
    }),
    department: Joi.string().trim().max(100).allow('', null),
    status: Joi.string().valid('active', 'inactive', 'closed').default('active'),
    priority: Joi.string().valid('low', 'medium', 'high', 'urgent').default('medium'),
    tags: Joi.array().items(Joi.string().trim())
});

const updateJob = createJob.fork(
    ['title', 'description', 'requiredSkills', 'location'],
    (schema) => schema.optional()
);

// ── 3. Applications ─────────────────────────────────────────────────

const createApplication = Joi.object({
    jobId: objectId.required(),
    resumeId: objectId.required(),
    coverLetter: Joi.string().max(3000).allow('', null)
});

const updateApplicationStatus = Joi.object({
    status: Joi.string().valid(
        'applied', 'screening', 'shortlisted', 'interview',
        'evaluation', 'offer', 'hired', 'rejected', 'withdrawn'
    ).required(),
    notes: Joi.string().max(2000).allow('', null)
});

// ── 4. Interviews ───────────────────────────────────────────────────

const startInterview = Joi.object({
    applicationId: objectId.required(),
    jobId: objectId.required(),
    round: Joi.string().valid('aptitude', 'technical', 'hr').default('aptitude'),
    questionCount: Joi.number().min(1).max(20).default(5),
    reExam: Joi.boolean().default(false)
});

const submitAnswer = Joi.object({
    questionId: Joi.string().required(),
    answer: Joi.string().min(1).max(5000).required()
});

const evaluateInterview = Joi.object({
    interviewId: objectId.required()
});

// ── 5. Pipeline ─────────────────────────────────────────────────────

const moveStage = Joi.object({
    applicationId: objectId.required(),
    toStage: Joi.string().valid(
        'applied', 'screening', 'shortlisted', 'interview',
        'evaluation', 'offer', 'hired', 'rejected', 'withdrawn'
    ).required(),
    notes: Joi.string().max(2000).allow('', null)
});

// ── 6. Notifications ────────────────────────────────────────────────

const sendNotification = Joi.object({
    to: emailRule.required(),
    subject: Joi.string().trim().min(2).max(200).required(),
    template: Joi.string().valid(
        'application_received', 'shortlisted', 'rejected',
        'interview_scheduled', 'offer_letter', 'custom'
    ).required(),
    data: Joi.object().default({})
});

// ── 7. Admin ────────────────────────────────────────────────────────

const updateUserRole = Joi.object({
    role: Joi.string().valid('admin', 'hr', 'recruiter', 'user').required()
});

const blockUser = Joi.object({
    reason: Joi.string().max(500).allow('', null)
});

// ── Exports ─────────────────────────────────────────────────────────

module.exports = {
    auth: { register, login, forgotPassword, resetPassword, changePassword },
    jobs: { createJob, updateJob },
    applications: { createApplication, updateApplicationStatus },
    interviews: { startInterview, submitAnswer, evaluateInterview },
    pipeline: { moveStage },
    notifications: { sendNotification },
    admin: { updateUserRole, blockUser }
};
