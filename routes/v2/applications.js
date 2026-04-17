const express = require('express');
const router = express.Router();

const appController = require('../../controllers/applicationController');
const validate = require('../../middleware/validate');
const { applications: schemas } = require('../../utils/validators');
const { protect, hrOrAdmin } = require('../../middleware/auth');

/**
 * V2 Application Routes
 * Prefix: /api/v2/applications
 */

router.use(protect);

router.route('/')
    .get(appController.getApplications)
    .post(validate(schemas.createApplication), appController.apply);

router.route('/:id')
    .get(appController.getApplication);

router.put('/:id/status',
    hrOrAdmin,
    validate(schemas.updateApplicationStatus),
    appController.updateStatus
);

router.post('/:id/screen',
    hrOrAdmin,
    appController.reScreen
);

module.exports = router;
