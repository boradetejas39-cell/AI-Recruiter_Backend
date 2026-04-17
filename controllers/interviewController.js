const Interview = require('../models/Interview');
const Application = require('../models/Application');
const aiInterviewService = require('../services/aiInterviewService');
const ActivityLog = require('../models/ActivityLog');
const logger = require('../utils/logger');
const { sendEmail } = require('../services/emailService');
const Job = require('../models/Job');
const { ok, created, badRequest, notFound, serverError } = require('../utils/apiResponse');

/**
 * Interview Controller — AI-driven interview system.
 */

// ── POST /api/v2/interviews/start ───────────────────────────────
exports.startInterview = async (req, res) => {
    try {
        const { applicationId, questionCount } = req.body;

        const application = await Application.findById(applicationId)
            .populate('jobId').populate('resumeId');
        if (!application) return notFound(res, 'Application not found');

        // Check if an interview already exists for this application
        let interview = await Interview.findOne({ applicationId });
        
        // Generate questions via AI for the selected round
        const round = req.body.round || 'aptitude';
        const targetCount = questionCount || (round === 'aptitude' ? 30 : (round === 'technical' ? 35 : 5));
        const questions = aiInterviewService.generateQuestions(
            application.jobId, application.resumeId, round, targetCount
        );

        if (interview) {
            // Re-exam: explicitly clear questions for the round being restarted
            if (req.body.reExam) {
                interview.questions = interview.questions.filter(q => q.round !== round);
            }

            // APPEND questions to existing interview
            const newQuestions = questions.map((q, idx) => ({
                questionId: `q${Date.now()}${idx}`,
                text: q.text, 
                category: q.category, 
                round: q.round,
                difficulty: q.difficulty,
                type: q.type,
                options: q.options,
                correctAnswer: q.correctAnswer
            }));
            
            interview.questions.push(...newQuestions);
            interview.currentRound = round;
            // If it was already completed or evaluated, reset it for the new round
            if (['completed', 'evaluated'].includes(interview.status)) {
                interview.status = 'pending';
            }
            await interview.save();
            
            logger.info('Interview round added', { interviewId: interview._id, round });
        } else {
            // CREATE new interview
            interview = await Interview.create({
                applicationId,
                jobId: application.jobId._id,
                candidateId: application.candidateId,
                currentRound: round,
                questions: questions.map((q, idx) => ({
                    questionId: `q${Date.now()}${idx}`,
                    text: q.text, 
                    category: q.category, 
                    round: q.round,
                    difficulty: q.difficulty,
                    type: q.type,
                    options: q.options,
                    correctAnswer: q.correctAnswer
                })),
                status: 'pending'
            });

            // Link interview to application
            application.interviewId = interview._id;
            application.currentStage = 'interview';
            await application.save();
        }

        application.stageHistory.push({
            stage: 'interview', movedBy: req.user._id,
            notes: `Started ${round} round`
        });
        await application.save();

        ActivityLog.record({
            userId: req.user._id, action: 'interview_round_started',
            description: `Round ${round} started for application ${applicationId}`,
            targetModel: 'Interview', targetId: interview._id,
            metadata: { round }
        }).catch(() => { });

        logger.info('Interview started', { interviewId: interview._id });
        return created(res, 'Interview started', {
            interview: {
                _id: interview._id,
                status: interview.status,
                questions: interview.questions.map(q => ({
                    _id: q._id, text: q.text, category: q.category, difficulty: q.difficulty
                }))
            }
        });
    } catch (error) {
        logger.error('Start interview error', { error: error.message });
        return serverError(res, 'Failed to start interview', error);
    }
};

// ── POST /api/v2/interviews/:id/answer ──────────────────────────
exports.submitAnswer = async (req, res) => {
    try {
        const { questionId, answer } = req.body;
        const interview = await Interview.findById(req.params.id).select('+questions.correctAnswer');
        if (!interview) return notFound(res, 'Interview not found');

        if (interview.status === 'evaluated' || interview.status === 'expired') {
            return badRequest(res, 'This interview is no longer active');
        }

        const question = interview.questions.id(questionId);
        if (!question) return notFound(res, 'Question not found');

        question.answer = answer;
        question.answeredAt = new Date();

        // Auto-score immediately for MCQs
        if (question.type === 'mcq') {
            const isCorrect = answer.trim() === (question.correctAnswer || '').trim();
            question.evaluation = {
                score: isCorrect ? 100 : 0,
                feedback: isCorrect ? 'Correct!' : `Incorrect. The correct answer was: ${question.correctAnswer}`,
                keywords: []
            };
        }

        // Update interview status
        if (interview.status === 'pending') {
            interview.status = 'in_progress';
            interview.startedAt = interview.startedAt || new Date();
        }

        // Check if all questions answered
        const allAnswered = interview.questions.every(q => q.answer);
        if (allAnswered) interview.status = 'completed';

        await interview.save();

        return ok(res, 'Answer submitted', {
            questionId,
            totalQuestions: interview.questions.length,
            answered: interview.questions.filter(q => q.answer).length,
            status: interview.status,
            evaluation: question.evaluation // Send back the instant MCQ result
        });
    } catch (error) {
        return serverError(res, 'Failed to submit answer', error);
    }
};

// ── POST /api/v2/interviews/:id/evaluate ────────────────────────
exports.evaluateInterview = async (req, res) => {
    try {
        const interview = await Interview.findById(req.params.id);
        if (!interview) return notFound(res, 'Interview not found');

        if (interview.status === 'evaluated') {
            return badRequest(res, 'Interview already evaluated');
        }

        const unanswered = interview.questions.filter(q => !q.answer);
        if (unanswered.length > interview.questions.length * 0.5) {
            return badRequest(res, 'Too many unanswered questions to evaluate');
        }

        // Evaluate each answer individually
        for (const question of interview.questions) {
            if (question.answer && question.type !== 'mcq') {
                const evaluation = aiInterviewService.evaluateAnswer(question.answer, question);
                question.evaluation = {
                    score: evaluation.score,
                    feedback: evaluation.feedback,
                    keywords: evaluation.keywordsFound || []
                };
            }
        }

        // Overall evaluation
        const overallResult = aiInterviewService.evaluateInterview(interview.questions);
        interview.overallScore = overallResult.overallScore;
        interview.feedbackSummary = overallResult.feedbackSummary;
        interview.strengths = overallResult.strengths;
        interview.weaknesses = overallResult.weaknesses;
        interview.recommendation = overallResult.recommendation;
        interview.status = 'evaluated';
        interview.completedAt = new Date();

        await interview.save();

        // ── Send Notification ──
        try {
            const job = await Job.findById(interview.jobId);
            const isPassed = overallResult.recommendation !== 'reject';
            const template = isPassed ? 'round_pass' : 'round_fail';
            
            sendEmail(interview.candidateId.email, template, {
                candidateName: interview.candidateId.name,
                jobTitle: job ? job.title : 'the position',
                roundName: interview.currentRound.charAt(0).toUpperCase() + interview.currentRound.slice(1),
                score: interview.overallScore
            }).catch(e => logger.error('Email failed from interview eval', e));
        } catch (e) {
            logger.error('Post-eval notification logic failed', e);
        }

        ActivityLog.record({
            userId: req.user._id, action: 'interview_evaluated',
            description: `Interview evaluated: score ${interview.overallScore}`,
            targetModel: 'Interview', targetId: interview._id
        }).catch(() => { });

        return ok(res, 'Interview evaluated', {
            overallScore: interview.overallScore,
            recommendation: interview.recommendation,
            feedbackSummary: interview.feedbackSummary,
            strengths: interview.strengths,
            weaknesses: interview.weaknesses
        });
    } catch (error) {
        logger.error('Evaluate interview error', { error: error.message });
        return serverError(res, 'Failed to evaluate interview', error);
    }
};

// ── GET /api/v2/interviews/:id ──────────────────────────────────
exports.getInterview = async (req, res) => {
    try {
        const interview = await Interview.findById(req.params.id)
            .populate('applicationId').populate('candidateId', 'name email');
        if (!interview) return notFound(res, 'Interview not found');

        // Candidates can only see their own
        if (req.user.role === 'user' &&
            interview.candidateId._id.toString() !== req.user._id.toString()) {
            return notFound(res, 'Interview not found');
        }

        return ok(res, 'Interview fetched', { interview });
    } catch (error) {
        return serverError(res, 'Failed to fetch interview', error);
    }
};

// ── GET /api/v2/interviews?applicationId=xxx ────────────────────
exports.getInterviews = async (req, res) => {
    try {
        const { applicationId, status, page = 1, limit = 20 } = req.query;
        const filter = {};

        if (req.user.role === 'user') filter.candidateId = req.user._id;
        if (applicationId) filter.applicationId = applicationId;
        if (status) filter.status = status;

        const skip = (parseInt(page) - 1) * parseInt(limit);
        const [interviews, total] = await Promise.all([
            Interview.find(filter).sort({ createdAt: -1 }).skip(skip).limit(parseInt(limit))
                .populate('applicationId', 'currentStage')
                .populate('candidateId', 'name email').lean(),
            Interview.countDocuments(filter)
        ]);

        return ok(res, 'Interviews fetched', interviews, {
            page: parseInt(page), limit: parseInt(limit),
            total, pages: Math.ceil(total / parseInt(limit))
        });
    } catch (error) {
        return serverError(res, 'Failed to fetch interviews', error);
    }
};
