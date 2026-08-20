const express = require('express');
const router = express.Router();
const { getPaymentsSummary } = require('../controllers/payments.controller');

router.get('/summary', getPaymentsSummary);

module.exports = router;