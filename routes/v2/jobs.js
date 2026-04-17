const express = require('express');
const router = express.Router();

const jobController = require('../../controllers/jobController');
const validate = require('../../middleware/validate');
const { jobs: schemas } = require('../../utils/validators');
const { protect, hrOrAdmin } = require('../../middleware/auth');

/**
 * V2 Job Routes
 * Prefix: /api/v2/jobs
 */

router.use(protect);

router.route('/')
    .get(jobController.getAllJobs)
    .post(hrOrAdmin, validate(schemas.createJob), jobController.createJob);

router.route('/:id')
    .get(jobController.getJob)
    .put(hrOrAdmin, validate(schemas.updateJob), jobController.updateJob)
    .delete(hrOrAdmin, jobController.deleteJob);

module.exports = router;
