const express = require('express');
const { handleEscrowBid } = require('../controllers/escrow.controller');

const router = express.Router();

// Route for lenders backing a P2P note
router.post('/bid', handleEscrowBid);

module.exports = router;