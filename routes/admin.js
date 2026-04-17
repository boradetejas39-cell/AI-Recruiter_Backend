const express = require('express');
const mongoose = require('mongoose');
const { body, validationResult } = require('express-validator');
const { protect, adminOnly } = require('../middleware/auth');
const memoryStore = require('../utils/memoryStore');

const router = express.Router();

/** True when Mongoose has an active MongoDB connection */
const isMongoConnected = () => mongoose.connection.readyState === 1;

// All admin routes require authentication + admin role
router.use(protect, adminOnly);

// ─────────────────────────────────────────────────────────────────────────────
// Helper: read/write users from whichever store is active
// ─────────────────────────────────────────────────────────────────────────────
async function readUsers() {
    if (isMongoConnected()) {
        return await memoryStore.findAll();
    }
    return global.fileDB ? global.fileDB.read('users') : (global.users || []);
}
async function writeUsers(users) {
    // For MongoDB path, individual updates are used instead
    if (!isMongoConnected()) {
        if (global.fileDB) global.fileDB.write('users', users);
        else global.users = users;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/admin/users  — list all system users
// ─────────────────────────────────────────────────────────────────────────────
router.get('/users', async (req, res) => {
    const { role, isActive, page = 1, limit = 20 } = req.query;
    let users = await readUsers();

    // Filters
    if (role) users = users.filter(u => u.role === role);
    if (isActive !== undefined) users = users.filter(u => String(u.isActive) === isActive);

    const total = users.length;
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const paginated = users
        .slice((pageNum - 1) * limitNum, pageNum * limitNum)
        .map(({ password, ...safe }) => safe);   // never return passwords

    res.json({
        success: true,
        data: {
            users: paginated,
            pagination: { current: pageNum, pages: Math.ceil(total / limitNum), total, limit: limitNum }
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/admin/users/:id  — get single user detail
// ─────────────────────────────────────────────────────────────────────────────
router.get('/users/:id', async (req, res) => {
    const users = await readUsers();
    const user = users.find(u => u._id === req.params.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    const { password, ...safe } = user;
    res.json({ success: true, data: { user: safe } });
});

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/admin/users/:id/role  — change a user's role (admin only)
// ─────────────────────────────────────────────────────────────────────────────
router.put('/users/:id/role', [
    body('role').isIn(['admin', 'hr']).withMessage("Role must be 'admin' or 'hr'")
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, message: 'Validation failed', errors: errors.array() });

    if (isMongoConnected()) {
        const user = await memoryStore.findById(req.params.id);
        if (!user) return res.status(404).json({ success: false, message: 'User not found' });
        if (user._id.toString() === req.user._id.toString() && req.body.role !== 'admin') {
            return res.status(400).json({ success: false, message: 'You cannot change your own role.' });
        }
        const updated = await memoryStore.findByIdAndUpdate(req.params.id, { role: req.body.role, updatedAt: new Date() }, { new: true });
        console.log(`[ADMIN] ${req.user.email} changed role of ${updated.email} → ${req.body.role}`);
        const { password, ...safe } = updated;
        return res.json({ success: true, message: 'User role updated successfully', data: { user: safe } });
    }

    const users = await readUsers();
    const idx = users.findIndex(u => u._id === req.params.id);
    if (idx === -1) return res.status(404).json({ success: false, message: 'User not found' });

    // Prevent an admin from demoting themselves
    if (users[idx]._id === req.user._id && req.body.role !== 'admin') {
        return res.status(400).json({ success: false, message: 'You cannot change your own role.' });
    }

    users[idx].role = req.body.role;
    users[idx].updatedAt = new Date().toISOString();
    writeUsers(users);

    console.log(`[ADMIN] ${req.user.email} changed role of ${users[idx].email} → ${req.body.role}`);
    const { password, ...safe } = users[idx];
    res.json({ success: true, message: 'User role updated successfully', data: { user: safe } });
});

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/admin/users/:id/status  — activate / deactivate a user account
// ─────────────────────────────────────────────────────────────────────────────
router.put('/users/:id/status', [
    body('isActive').isBoolean().withMessage('isActive must be a boolean')
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, message: 'Validation failed', errors: errors.array() });

    if (isMongoConnected()) {
        const user = await memoryStore.findById(req.params.id);
        if (!user) return res.status(404).json({ success: false, message: 'User not found' });
        if (user._id.toString() === req.user._id.toString()) {
            return res.status(400).json({ success: false, message: 'You cannot deactivate your own account.' });
        }
        await memoryStore.findByIdAndUpdate(req.params.id, { isActive: req.body.isActive, updatedAt: new Date() });
        const action = req.body.isActive ? 'activated' : 'deactivated';
        console.log(`[ADMIN] ${req.user.email} ${action} account of ${user.email}`);
        return res.json({ success: true, message: `User account ${action} successfully` });
    }

    const users = await readUsers();
    const idx = users.findIndex(u => u._id === req.params.id);
    if (idx === -1) return res.status(404).json({ success: false, message: 'User not found' });

    if (users[idx]._id === req.user._id) {
        return res.status(400).json({ success: false, message: 'You cannot deactivate your own account.' });
    }

    users[idx].isActive = req.body.isActive;
    users[idx].updatedAt = new Date().toISOString();
    writeUsers(users);

    const action = req.body.isActive ? 'activated' : 'deactivated';
    console.log(`[ADMIN] ${req.user.email} ${action} account of ${users[idx].email}`);
    res.json({ success: true, message: `User account ${action} successfully` });
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/admin/users/:id  — permanently delete a user
// ─────────────────────────────────────────────────────────────────────────────
router.delete('/users/:id', async (req, res) => {
    if (isMongoConnected()) {
        const user = await memoryStore.findById(req.params.id);
        if (!user) return res.status(404).json({ success: false, message: 'User not found' });
        if (user._id.toString() === req.user._id.toString()) {
            return res.status(400).json({ success: false, message: 'You cannot delete your own account.' });
        }
        await memoryStore.deleteById(req.params.id);
        console.log(`[ADMIN] ${req.user.email} permanently deleted user ${user.email}`);
        return res.json({ success: true, message: 'User deleted successfully' });
    }

    const users = await readUsers();
    const idx = users.findIndex(u => u._id === req.params.id);
    if (idx === -1) return res.status(404).json({ success: false, message: 'User not found' });

    if (users[idx]._id === req.user._id) {
        return res.status(400).json({ success: false, message: 'You cannot delete your own account.' });
    }

    const deleted = users.splice(idx, 1)[0];
    writeUsers(users);

    console.log(`[ADMIN] ${req.user.email} permanently deleted user ${deleted.email}`);
    res.json({ success: true, message: 'User deleted successfully' });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/admin/system-stats  — platform-wide statistics (admin dashboard)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/system-stats', async (req, res) => {
    const users = await readUsers();
    let jobs, resumes, matches;

    if (isMongoConnected()) {
        const Job = require('../models/Job');
        const Resume = require('../models/Resume');
        const Match = require('../models/Match');
        jobs = await Job.find().lean();
        resumes = await Resume.find().lean();
        matches = await Match.find().lean();
    } else {
        jobs = global.fileDB ? global.fileDB.read('jobs') : [];
        resumes = global.fileDB ? global.fileDB.read('resumes') : [];
        matches = global.fileDB ? global.fileDB.read('matches') : [];
    }

    res.json({
        success: true,
        data: {
            users: {
                total: users.length,
                admins: users.filter(u => u.role === 'admin').length,
                hr: users.filter(u => u.role === 'hr').length,
                active: users.filter(u => u.isActive).length,
                inactive: users.filter(u => !u.isActive).length
            },
            jobs: {
                total: jobs.length,
                active: jobs.filter(j => j.status === 'active').length,
                closed: jobs.filter(j => j.status === 'closed').length
            },
            resumes: {
                total: resumes.length,
                active: resumes.filter(r => r.status === 'active').length,
                hired: resumes.filter(r => r.status === 'hired').length
            },
            matches: {
                total: matches.length,
                avgScore: matches.length
                    ? Math.round(matches.reduce((s, m) => s + (m.score || 0), 0) / matches.length)
                    : 0
            }
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/admin/audit-log  — recent access-control events (from server logs)
//   In production this would read from a proper audit DB collection.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/audit-log', (req, res) => {
    res.json({
        success: true,
        message: 'Audit log endpoint ready. In production, connect to your audit DB collection.',
        data: { entries: [] }
    });
});

module.exports = router;
