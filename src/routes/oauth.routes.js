const express = require('express');
const router = express.Router();
const passport = require('../lib/passport');
const { googleCallback } = require('../controllers/oauth.controller');

router.get('/google', passport.authenticate('google', { scope: ['profile', 'email'] }));
router.get('/google/callback', passport.authenticate(
    'google', { failureRedirect: '/api/auth/google/failed', session: false }), googleCallback);

router.get('/google/failed', (req, res) => {
    res.status(401).json({ error: 'Google authentication failed' });
});

module.exports = router;