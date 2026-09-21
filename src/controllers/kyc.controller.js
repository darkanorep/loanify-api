const axios = require('axios');
const crypto = require('crypto');
const prisma = require('../lib/prisma');
const { syncKycDataToUser } = require('../services/kyc.service');

const SUMSUB_APP_TOKEN = process.env.SUMSUB_APP_TOKEN;
const SUMSUB_SECRET_KEY = process.env.SUMSUB_SECRET_KEY;
const SUMSUB_LEVEL_NAME = process.env.SUMSUB_LEVEL_NAME || 'id-and-liveness';
const SUMSUB_BASE_URL = 'https://api.sumsub.com';

const getSumsubToken = async (req, res) => {
    try {
        // Validate environment credentials
        if (!SUMSUB_APP_TOKEN || !SUMSUB_SECRET_KEY) {
            console.error("Sumsub Configuration Error: SUMSUB_APP_TOKEN or SUMSUB_SECRET_KEY is missing in process.env");
            return res.status(500).json({ error: "KYC service credentials are not configured on the server." });
        }

        const userId = String(req.user.id);
        const timestamp = Math.floor(Date.now() / 1000);
        const method = 'POST';
        const path = `/resources/accessTokens?userId=${encodeURIComponent(userId)}&levelName=${encodeURIComponent(SUMSUB_LEVEL_NAME)}`;

        // HMAC-SHA256 Signature Generation
        const signature = crypto.createHmac('sha256', SUMSUB_SECRET_KEY);
        signature.update(timestamp + method + path);

        const response = await axios({
            method,
            url: `${SUMSUB_BASE_URL}${path}`,
            headers: {
                'Accept': 'application/json',
                'X-App-Token': SUMSUB_APP_TOKEN,
                'X-App-Access-Sig': signature.digest('hex'),
                'X-App-Access-Ts': timestamp
            }
        });

        return res.json({ token: response.data.token, userId });
    } catch (err) {
        // Detailed console logging to inspect exact Sumsub API response
        console.error("Sumsub API Error Response:", err.response?.data || err.message);

        const sumsubError = err.response?.data?.description || err.response?.data?.errorMessage;
        return res.status(500).json({
            error: sumsubError || "Failed to generate identity verification session."
        });
    }
};

const handleSumsubWebhook = async (req, res) => {
    try {
        const { applicantId, externalUserId, reviewResult, type } = req.body;

        if (type === 'applicantReviewed' || type === 'applicantPending') {
            await syncKycDataToUser(externalUserId, applicantId, reviewResult);
        }

        return res.status(200).send('OK');
    } catch (err) {
        console.error("Sumsub webhook error:", err);
        return res.status(500).send("Webhook processing failed.");
    }
};

const getKycStatus = async (req, res) => {
    try {
        const user = await prisma.user.findUnique({
            where: { id: req.user.id },
            include: { kycDocuments: true }
        });

        if (!user) {
            return res.status(404).json({ error: 'User not found.' });
        }

        return res.json({
            kyc_status: user.kyc_status,
            rejection_note: user.kyc_rejection_note,
            submitted_at: user.kyc_submitted_at,
            verified_at: user.kyc_verified_at,
            documents: user.kycDocuments || []
        });
    } catch (err) {
        console.error("Get KYC Status error:", err);
        return res.status(500).json({ error: err.message });
    }
};

module.exports = { getSumsubToken, handleSumsubWebhook, getKycStatus };