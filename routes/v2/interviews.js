const express = require('express');
const router = express.Router();

const interviewController = require('../../controllers/interviewController');
const validate = require('../../middleware/validate');
const { interviews: schemas } = require('../../utils/validators');
const { protect, hrOrAdmin } = require('../../middleware/auth');
const { aiLimiter } = require('../../middleware/rateLimiter');

/**
 * V2 Interview Routes
 * Prefix: /api/v2/interviews
 */

router.use(protect);

router.get('/', interviewController.getInterviews);
router.get('/:id', interviewController.getInterview);

router.post('/start',
    hrOrAdmin, aiLimiter,
    validate(schemas.startInterview),
    interviewController.startInterview
);

router.post('/:id/answer',
    validate(schemas.submitAnswer),
    interviewController.submitAnswer
);

router.post('/:id/evaluate',
    hrOrAdmin, aiLimiter,
    interviewController.evaluateInterview
);

module.exports = router;
