const express = require('express');
const router = express.Router();
const { broadcast } = require('../lib/websocket');
const { triggerBatchCreditUpdate, getBorrowers, streamAdminEvents, getDashboardStats } = require('../controllers/admin.controller');

router.post('/credit-limits/refresh', triggerBatchCreditUpdate);
router.get('/borrowers', getBorrowers);
router.get('/events', streamAdminEvents);
router.get('/stats', getDashboardStats)
router.post('/admin/broadcast-seed', (req, res) => {
    broadcast({ type: "admin_data_updated", action: "DATABASE_SEEDED" });
    res.json({ success: true });
});

module.exports = router;