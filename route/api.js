const express = require('express');
const router = express.Router();

const authRoutes = require('../src/routes/auth.routes');
const oauthRoutes = require('../src/routes/oauth.routes');
const loanRoutes = require('../src/routes/loan.routes');
const dashboardRoutes = require('../src/routes/dashboard.routes');
const authenticate = require('../src/middlewares/auth');

router.use('/auth', authRoutes);
router.use('/auth', oauthRoutes);
router.use('/loans', authenticate, loanRoutes);
router.use('/dashboard', authenticate, dashboardRoutes);

module.exports = router;