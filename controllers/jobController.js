const Job = require('../models/Job');
const ActivityLog = require('../models/ActivityLog');
const logger = require('../utils/logger');
const { ok, created, badRequest, notFound, serverError } = require('../utils/apiResponse');

/**
 * Job Controller — CRUD operations for job postings.
 */

// ── POST /api/v2/jobs ───────────────────────────────────────────
exports.createJob = async (req, res) => {
    try {
        const jobData = { ...req.body, createdBy: req.user._id };
        const job = await Job.create(jobData);

        ActivityLog.record({
            userId: req.user._id, action: 'job_created',
            description: `Job created: ${job.title}`,
            targetModel: 'Job', targetId: job._id
        }).catch(() => { });

        logger.info('Job created', { jobId: job._id, title: job.title });
        return created(res, 'Job created successfully', { job });
    } catch (error) {
        logger.error('Create job error', { error: error.message });
        return serverError(res, 'Failed to create job', error);
    }
};

// ── GET /api/v2/jobs ────────────────────────────────────────────
exports.getAllJobs = async (req, res) => {
    try {
        const {
            page = 1, limit = 20, status, search, department,
            jobType, sortBy = 'createdAt', order = 'desc'
        } = req.query;

        const filter = {};
        if (status) filter.status = status;
        if (department) filter.department = new RegExp(department, 'i');
        if (jobType) filter.jobType = jobType;
        if (search) {
            filter.$or = [
                { title: new RegExp(search, 'i') },
                { description: new RegExp(search, 'i') }
            ];
        }

        const skip = (parseInt(page) - 1) * parseInt(limit);
        const sort = { [sortBy]: order === 'asc' ? 1 : -1 };

        const [jobs, total] = await Promise.all([
            Job.find(filter).sort(sort).skip(skip).limit(parseInt(limit))
                .populate('createdBy', 'name email').lean(),
            Job.countDocuments(filter)
        ]);

        return ok(res, 'Jobs fetched', jobs, {
            page: parseInt(page), limit: parseInt(limit),
            total, pages: Math.ceil(total / parseInt(limit))
        });
    } catch (error) {
        return serverError(res, 'Failed to fetch jobs', error);
    }
};

// ── GET /api/v2/jobs/:id ────────────────────────────────────────
exports.getJob = async (req, res) => {
    try {
        const job = await Job.findById(req.params.id).populate('createdBy', 'name email');
        if (!job) return notFound(res, 'Job not found');
        return ok(res, 'Job fetched', { job });
    } catch (error) {
        return serverError(res, 'Failed to fetch job', error);
    }
};

// ── PUT /api/v2/jobs/:id ────────────────────────────────────────
exports.updateJob = async (req, res) => {
    try {
        const job = await Job.findByIdAndUpdate(req.params.id, req.body, {
            new: true, runValidators: true
        });
        if (!job) return notFound(res, 'Job not found');

        ActivityLog.record({
            userId: req.user._id, action: 'job_updated',
            description: `Job updated: ${job.title}`,
            targetModel: 'Job', targetId: job._id
        }).catch(() => { });

        return ok(res, 'Job updated', { job });
    } catch (error) {
        return serverError(res, 'Failed to update job', error);
    }
};

// ── DELETE /api/v2/jobs/:id ─────────────────────────────────────
exports.deleteJob = async (req, res) => {
    try {
        const job = await Job.findByIdAndDelete(req.params.id);
        if (!job) return notFound(res, 'Job not found');

        ActivityLog.record({
            userId: req.user._id, action: 'job_deleted',
            description: `Job deleted: ${job.title}`,
            targetModel: 'Job', targetId: job._id
        }).catch(() => { });

        return ok(res, 'Job deleted');
    } catch (error) {
        return serverError(res, 'Failed to delete job', error);
    }
};
