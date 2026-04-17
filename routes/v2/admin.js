const express = require('express');
const router = express.Router();

const adminController = require('../../controllers/adminController');
const validate = require('../../middleware/validate');
const { admin: schemas } = require('../../utils/validators');
const { protect, adminOnly } = require('../../middleware/auth');

/**
 * V2 Admin Routes
 * Prefix: /api/v2/admin
 */

router.use(protect, adminOnly);

// User management
router.get('/users', adminController.getUsers);
router.get('/users/:id', adminController.getUser);
router.put('/users/:id/role', validate(schemas.updateUserRole), adminController.updateUserRole);
router.put('/users/:id/block', validate(schemas.blockUser), adminController.blockUser);
router.put('/users/:id/unblock', adminController.unblockUser);
router.delete('/users/:id', adminController.deleteUser);

// Activity logs & system stats
router.get('/activity-logs', adminController.getActivityLogs);
router.get('/system-stats', adminController.getSystemStats);

module.exports = router;
