const express = require('express');
const router = express.Router();
const { createOffer, getMarketplaceOffers, applyToOffer, getLenderApplications, approveApplication, updateOffer } = require('../controllers/p2p.controller');

router.get('/marketplace', getMarketplaceOffers);
router.post('/offer', createOffer);
router.post('/apply', applyToOffer);
router.get('/applications', getLenderApplications);
router.post('/applications/approve', approveApplication);
router.put('/offer/:id', updateOffer);

module.exports = router;