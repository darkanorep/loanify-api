const express = require('express');
const router = express.Router();
const passport = require('../lib/passport');
const { googleCallback, exchangeGoogleMobileCode } = require('../controllers/oauth.controller');

router.get('/google', passport.authenticate('google', { scope: ['profile', 'email'] }));
router.get(
    '/google/mobile',
    (req, res, next) => {
        req.session.oauthClient = 'mobile';

        req.session.save((error) => {
            if (error) return next(error);
            next();
        });
    },
    passport.authenticate('google', { scope: ['profile', 'email'] })
);
router.get('/google/callback', passport.authenticate(
    'google', { failureRedirect: '/api/auth/google/failed', session: false }), googleCallback);

router.get('/google/failed', (req, res) => {
    res.status(401).json({ error: 'Google authentication failed' });
});

router.post('/google/mobile/exchange', exchangeGoogleMobileCode);

module.exports = router;