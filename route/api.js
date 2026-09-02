const express = require('express');
const router = express.Router();

const authRoutes = require('../src/routes/auth.routes');
const profileRoutes = require('../src/routes/profile.routes');
const oauthRoutes = require('../src/routes/oauth.routes');
const loanRoutes = require('../src/routes/loan.routes');
const dashboardRoutes = require('../src/routes/dashboard.routes');
const paymentsRoutes = require('../src/routes/payments.routes');
const paymentMethodRoutes = require('../src/routes/paymentmethod.routes');
const p2pRoutes = require('../src/routes/p2p.routes');
const notificationRoutes = require('../src/routes/notification.routes');
const chatRoutes = require('../src/routes/chat.routes');
const authenticate = require('../src/middlewares/auth');

router.use('/auth', authRoutes);
router.use('/auth', oauthRoutes);
router.use('/profile', authenticate, profileRoutes);
router.use('/loans', authenticate, loanRoutes);
router.use('/dashboard', authenticate, dashboardRoutes);
router.use('/payments', authenticate, paymentsRoutes);
router.use('/payment-methods', authenticate, paymentMethodRoutes);
router.use('/p2p', authenticate, p2pRoutes);
router.use('/notifications', authenticate, notificationRoutes);
router.use('/chat', authenticate, chatRoutes);
module.exports = router;