const express = require('express');
const router = express.Router();
const { register, verifyOtp, resendOtp, login } = require('../controllers/auth.controller');
const validate = require('../middlewares/validate');
const { registerSchema, verifyOtpSchema, resendOtpSchema, loginSchema } = require('../validators/auth.validator');

router.post('/register', validate(registerSchema), register);
router.post('/verify-otp', validate(verifyOtpSchema), verifyOtp);
router.post('/resend-otp', validate(resendOtpSchema), resendOtp);
router.post('/login', validate(loginSchema), login);

module.exports = router;