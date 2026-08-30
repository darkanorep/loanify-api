const express = require('express');
const router = express.Router();
const { register, verifyOtp, resendOtp, login, logout, forgotPassword, resetPassword, requestProfileOtp, updateProfileWithOtp } = require('../controllers/auth.controller');
const validate = require('../middlewares/validate');
const authenticate = require('../middlewares/auth');
const { verifyToken } = require('../controllers/verifyToken.controller');
const { registerSchema, verifyOtpSchema, resendOtpSchema, loginSchema, forgotPasswordSchema, resetPasswordSchema } = require('../validators/auth.validator');

router.post('/register', validate(registerSchema), register);
router.post('/verify-otp', validate(verifyOtpSchema), verifyOtp);
router.post('/resend-otp', validate(resendOtpSchema), resendOtp);
router.post('/login', validate(loginSchema), login);
router.post('/logout', authenticate, logout);
router.post('/forgot-password', validate(forgotPasswordSchema), forgotPassword);
router.post('/reset-password', validate(resetPasswordSchema), resetPassword);
router.get('/me', verifyToken);
router.post('/request-profile-otp', authenticate, requestProfileOtp);
router.post('/update-profile', authenticate, updateProfileWithOtp);

module.exports = router;