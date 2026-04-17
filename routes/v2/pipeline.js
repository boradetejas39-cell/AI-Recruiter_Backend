const express = require('express');
const router = express.Router();

const pipelineController = require('../../controllers/pipelineController');
const validate = require('../../middleware/validate');
const { pipeline: schemas } = require('../../utils/validators');
const { protect, hrOrAdmin } = require('../../middleware/auth');

/**
 * V2 Pipeline Routes
 * Prefix: /api/v2/pipeline
 */

router.use(protect);

router.put('/:applicationId/move',
    hrOrAdmin,
    validate(schemas.moveStage),
    pipelineController.moveStage
);

router.get('/:jobId', pipelineController.getJobPipeline);
router.get('/:applicationId/history', pipelineController.getStageHistory);

module.exports = router;
