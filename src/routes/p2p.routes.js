const express = require('express');
const router = express.Router();
const { createOffer,
    getMarketplaceOffers,
    applyToOffer,
    getBorrowerApplications,
    getLenderApplications,
    approveApplication,
    updateOffer,
    deleteOffer,
    cancelApplication,
    rejectApplication
} = require('../controllers/p2p.controller');

router.get('/marketplace', getMarketplaceOffers);
router.post('/offer', createOffer);
router.post('/apply', applyToOffer);
router.get('/applications', getLenderApplications);
router.post('/applications/approve', approveApplication);
router.put('/offer/:id', updateOffer);
router.delete('/offer/:id', deleteOffer);
router.delete('/applications/:id', cancelApplication);
router.get('/borrower-applications', getBorrowerApplications);
router.post('/applications/reject', rejectApplication);

module.exports = router;