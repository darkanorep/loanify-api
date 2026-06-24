const express = require('express');
const router = express.Router();
const { register, verifyOtp, resendOtp, login } = require('../controllers/auth.controller');

router.post('/register', register);
router.post('/verify-otp', verifyOtp);
router.post('/resend-otp', resendOtp);
router.post('/login', login);

module.exports = router;