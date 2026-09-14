const express = require('express');
const { getWalletOverview, processTopUp } = require('../controllers/wallet.controller');

const router = express.Router();

// User Wallet Routes
router.get('/overview', getWalletOverview);
router.post('/topup', processTopUp);

// // P2P Escrow Routes

module.exports = router;