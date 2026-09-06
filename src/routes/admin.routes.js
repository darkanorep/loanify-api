const express = require('express');
const router = express.Router();
const { triggerBatchCreditUpdate, getBorrowers, streamAdminEvents } = require('../controllers/admin.controller');

router.post('/credit-limits/refresh', triggerBatchCreditUpdate);
router.get('/borrowers', getBorrowers);
router.get('/events', streamAdminEvents);

module.exports = router;