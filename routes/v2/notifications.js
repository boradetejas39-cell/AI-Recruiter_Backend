const express = require('express');
const router = express.Router();

const notificationController = require('../../controllers/notificationController');
const validate = require('../../middleware/validate');
const { notifications: schemas } = require('../../utils/validators');
const { protect, hrOrAdmin } = require('../../middleware/auth');

/**
 * V2 Notification Routes
 * Prefix: /api/v2/notifications
 */

router.use(protect);

router.get('/', notificationController.getNotifications);
router.put('/read-all', notificationController.markAllRead);
router.put('/:id/read', notificationController.markRead);

// HR / Admin can send notifications
router.post('/send',
    hrOrAdmin,
    validate(schemas.sendNotification),
    notificationController.sendNotification
);

module.exports = router;
