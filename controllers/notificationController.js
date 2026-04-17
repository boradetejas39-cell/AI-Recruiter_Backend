const Notification = require('../models/Notification');
const { sendEmail } = require('../services/emailService');
const logger = require('../utils/logger');
const { ok, created, notFound, serverError } = require('../utils/apiResponse');

/**
 * Notification Controller — Email + in-app notification endpoints.
 */

// ── POST /api/v2/notifications/send ─────────────────────────────
exports.sendNotification = async (req, res) => {
    try {
        const { userId, email, template, subject, body, data, channel } = req.body;

        const notification = await Notification.create({
            userId, email, template: template || 'custom',
            subject: subject || `Notification — ${template}`,
            body: body || '', channel: channel || 'email'
        });

        // Send email if channel is email or both
        if (channel !== 'in_app') {
            try {
                await sendEmail(email, template || 'custom', {
                    ...data, subject, body
                });
                notification.emailStatus = 'sent';
            } catch (err) {
                notification.emailStatus = 'failed';
                logger.warn('Email send failed', { error: err.message });
            }
            await notification.save();
        }

        return created(res, 'Notification sent', { notification });
    } catch (error) {
        logger.error('Send notification error', { error: error.message });
        return serverError(res, 'Failed to send notification', error);
    }
};

// ── GET /api/v2/notifications ───────────────────────────────────
exports.getNotifications = async (req, res) => {
    try {
        const { page = 1, limit = 20, unreadOnly } = req.query;
        const filter = { userId: req.user._id };
        if (unreadOnly === 'true') filter.isRead = false;

        const skip = (parseInt(page) - 1) * parseInt(limit);
        const [notifications, total, unreadCount] = await Promise.all([
            Notification.find(filter).sort({ createdAt: -1 }).skip(skip).limit(parseInt(limit)).lean(),
            Notification.countDocuments(filter),
            Notification.countDocuments({ userId: req.user._id, isRead: false })
        ]);

        return ok(res, 'Notifications fetched', notifications, {
            page: parseInt(page), limit: parseInt(limit),
            total, pages: Math.ceil(total / parseInt(limit)),
            unreadCount
        });
    } catch (error) {
        return serverError(res, 'Failed to fetch notifications', error);
    }
};

// ── PUT /api/v2/notifications/:id/read ──────────────────────────
exports.markRead = async (req, res) => {
    try {
        const notification = await Notification.findOneAndUpdate(
            { _id: req.params.id, userId: req.user._id },
            { isRead: true, readAt: new Date() },
            { new: true }
        );
        if (!notification) return notFound(res, 'Notification not found');
        return ok(res, 'Notification marked as read', { notification });
    } catch (error) {
        return serverError(res, 'Failed to mark notification', error);
    }
};

// ── PUT /api/v2/notifications/read-all ──────────────────────────
exports.markAllRead = async (req, res) => {
    try {
        const result = await Notification.updateMany(
            { userId: req.user._id, isRead: false },
            { isRead: true, readAt: new Date() }
        );
        return ok(res, 'All notifications marked as read', { updated: result.modifiedCount });
    } catch (error) {
        return serverError(res, 'Failed to mark all as read', error);
    }
};
