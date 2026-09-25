const express = require('express');
const router = express.Router();
const {
    initiatePaymongoTopup,
    handleWalletTopUp,
    getWalletOverview,
    verifyPaymongoTopup,
    handleWalletWithdrawal
} = require('../controllers/wallet.controller');

router.get('/overview', getWalletOverview);
router.post('/topup', handleWalletTopUp);
router.post('/paymongo-topup', initiatePaymongoTopup);
router.post('/paymongo-verify', verifyPaymongoTopup);
router.post('/withdraw', handleWalletWithdrawal);

module.exports = router;