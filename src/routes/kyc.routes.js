const express = require('express');
const router = express.Router();
const { getSumsubToken, handleSumsubWebhook, getKycStatus } = require('../controllers/kyc.controller');

// KYC Status and Token Endpoints
router.get('/status', getKycStatus);
router.get('/sumsub-token', getSumsubToken);

// Webhook endpoint (Public, called by Sumsub)
router.post('/webhook', handleSumsubWebhook);

module.exports = router;