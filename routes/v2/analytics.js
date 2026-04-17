const express = require('express');
const router = express.Router();

const analyticsController = require('../../controllers/analyticsController');
const { protect, hrOrAdmin } = require('../../middleware/auth');

/**
 * V2 Analytics Routes
 * Prefix: /api/v2/analytics
 */

router.use(protect, hrOrAdmin);

router.get('/overview', analyticsController.getOverview);
router.get('/pipeline', analyticsController.getPipeline);
router.get('/top-jobs', analyticsController.getTopJobs);
router.get('/skills', analyticsController.getSkillDemand);
router.get('/scores', analyticsController.getScoreDistribution);
router.get('/monthly', analyticsController.getMonthlyTrend);
router.get('/interviews', analyticsController.getInterviewStats);

module.exports = router;
