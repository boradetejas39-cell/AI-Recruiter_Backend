const User = require('../models/User');
const ActivityLog = require('../models/ActivityLog');
const Job = require('../models/Job');
const Application = require('../models/Application');
const Interview = require('../models/Interview');
const Resume = require('../models/Resume');
const logger = require('../utils/logger');
const { ok, badRequest, notFound, serverError } = require('../utils/apiResponse');

/**
 * Admin Controller — User management, system stats, activity logs.
 */

// ── GET /api/v2/admin/users ─────────────────────────────────────
exports.getUsers = async (req, res) => {
    try {
        const { page = 1, limit = 20, role, search, blocked } = req.query;
        const filter = {};
        if (role) filter.role = role;
        if (blocked === 'true') filter.isBlocked = true;
        if (blocked === 'false') filter.isBlocked = { $ne: true };
        if (search) {
            filter.$or = [
                { name: new RegExp(search, 'i') },
                { email: new RegExp(search, 'i') }
            ];
        }

        const skip = (parseInt(page) - 1) * parseInt(limit);
        const [users, total] = await Promise.all([
            User.find(filter).sort({ createdAt: -1 }).skip(skip).limit(parseInt(limit))
                .select('-password').lean(),
            User.countDocuments(filter)
        ]);

        return ok(res, 'Users fetched', users, {
            page: parseInt(page), limit: parseInt(limit),
            total, pages: Math.ceil(total / parseInt(limit))
        });
    } catch (error) {
        return serverError(res, 'Failed to fetch users', error);
    }
};

// ── GET /api/v2/admin/users/:id ─────────────────────────────────
exports.getUser = async (req, res) => {
    try {
        const user = await User.findById(req.params.id).select('-password');
        if (!user) return notFound(res, 'User not found');
        return ok(res, 'User fetched', { user });
    } catch (error) {
        return serverError(res, 'Failed to fetch user', error);
    }
};

// ── PUT /api/v2/admin/users/:id/role ────────────────────────────
exports.updateUserRole = async (req, res) => {
    try {
        const { role } = req.body;
        const user = await User.findById(req.params.id);
        if (!user) return notFound(res, 'User not found');

        // Prevent self-demotion
        if (user._id.toString() === req.user._id.toString()) {
            return badRequest(res, 'Cannot change your own role');
        }

        const oldRole = user.role;
        user.role = role;
        await user.save();

        ActivityLog.record({
            userId: req.user._id, action: 'user_role_changed',
            description: `Role changed from ${oldRole} to ${role} for ${user.name}`,
            targetModel: 'User', targetId: user._id,
            metadata: { oldRole, newRole: role }
        }).catch(() => { });

        return ok(res, `User role updated to ${role}`, { user: { _id: user._id, name: user.name, role: user.role } });
    } catch (error) {
        return serverError(res, 'Failed to update user role', error);
    }
};

// ── PUT /api/v2/admin/users/:id/block ───────────────────────────
exports.blockUser = async (req, res) => {
    try {
        const { reason } = req.body;
        const user = await User.findById(req.params.id);
        if (!user) return notFound(res, 'User not found');

        if (user._id.toString() === req.user._id.toString()) {
            return badRequest(res, 'Cannot block yourself');
        }

        user.isBlocked = true;
        user.blockedReason = reason || 'Blocked by admin';
        user.blockedAt = new Date();
        await user.save();

        ActivityLog.record({
            userId: req.user._id, action: 'user_blocked',
            description: `Blocked user: ${user.name}`,
            targetModel: 'User', targetId: user._id,
            metadata: { reason: user.blockedReason }
        }).catch(() => { });

        return ok(res, 'User blocked', { user: { _id: user._id, name: user.name, isBlocked: true } });
    } catch (error) {
        return serverError(res, 'Failed to block user', error);
    }
};

// ── PUT /api/v2/admin/users/:id/unblock ─────────────────────────
exports.unblockUser = async (req, res) => {
    try {
        const user = await User.findById(req.params.id);
        if (!user) return notFound(res, 'User not found');

        user.isBlocked = false;
        user.blockedReason = undefined;
        user.blockedAt = undefined;
        await user.save();

        ActivityLog.record({
            userId: req.user._id, action: 'user_unblocked',
            description: `Unblocked user: ${user.name}`,
            targetModel: 'User', targetId: user._id
        }).catch(() => { });

        return ok(res, 'User unblocked', { user: { _id: user._id, name: user.name, isBlocked: false } });
    } catch (error) {
        return serverError(res, 'Failed to unblock user', error);
    }
};

// ── DELETE /api/v2/admin/users/:id ──────────────────────────────
exports.deleteUser = async (req, res) => {
    try {
        const user = await User.findById(req.params.id);
        if (!user) return notFound(res, 'User not found');

        if (user._id.toString() === req.user._id.toString()) {
            return badRequest(res, 'Cannot delete yourself');
        }

        await User.findByIdAndDelete(req.params.id);

        ActivityLog.record({
            userId: req.user._id, action: 'user_deleted',
            description: `Deleted user: ${user.name} (${user.email})`,
            targetModel: 'User', targetId: user._id
        }).catch(() => { });

        return ok(res, 'User deleted');
    } catch (error) {
        return serverError(res, 'Failed to delete user', error);
    }
};

// ── GET /api/v2/admin/activity-logs ─────────────────────────────
exports.getActivityLogs = async (req, res) => {
    try {
        const { page = 1, limit = 50, action, userId } = req.query;
        const filter = {};
        if (action) filter.action = action;
        if (userId) filter.userId = userId;

        const skip = (parseInt(page) - 1) * parseInt(limit);
        const [logs, total] = await Promise.all([
            ActivityLog.find(filter).sort({ createdAt: -1 }).skip(skip).limit(parseInt(limit))
                .populate('userId', 'name email role').lean(),
            ActivityLog.countDocuments(filter)
        ]);

        return ok(res, 'Activity logs fetched', logs, {
            page: parseInt(page), limit: parseInt(limit),
            total, pages: Math.ceil(total / parseInt(limit))
        });
    } catch (error) {
        return serverError(res, 'Failed to fetch activity logs', error);
    }
};

// ── GET /api/v2/admin/system-stats ──────────────────────────────
exports.getSystemStats = async (req, res) => {
    try {
        const [users, jobs, applications, interviews, resumes] = await Promise.all([
            User.aggregate([
                { $group: { _id: '$role', count: { $sum: 1 } } }
            ]),
            Job.countDocuments(),
            Application.countDocuments(),
            Interview.countDocuments(),
            Resume.countDocuments()
        ]);

        const usersByRole = {};
        users.forEach(u => { usersByRole[u._id] = u.count; });

        return ok(res, 'System stats fetched', {
            users: { total: Object.values(usersByRole).reduce((a, b) => a + b, 0), byRole: usersByRole },
            jobs, applications, interviews, resumes,
            server: {
                uptime: process.uptime(),
                memory: process.memoryUsage(),
                nodeVersion: process.version
            }
        });
    } catch (error) {
        return serverError(res, 'Failed to fetch system stats', error);
    }
};
