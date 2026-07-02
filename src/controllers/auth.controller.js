const prisma = require('../lib/prisma');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { sendOtp } = require('../lib/mailer');

const generateOtp = () => Math.floor(100000 + Math.random() * 900000).toString();

const register = async (req, res) => {
    try {
        const { first_name, middle_name, last_name, email, phone_number, username, password } = req.body;

        const hashed = await bcrypt.hash(password, 10);
        const otp = generateOtp();
        const otp_expires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

        const user = await prisma.user.create({
            data: { first_name, middle_name, last_name, email, phone_number, username, password: hashed, otp, otp_expires }
        });

        await sendOtp(email, otp);

        res.status(201).json({ message: 'Registered successfully. Check your email for the OTP.' });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
};

const verifyOtp = async (req, res) => {
    try {
        const { email, otp } = req.body;

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user) return res.status(404).json({ error: 'User not found' });
        if (user.is_verified) return res.status(400).json({ error: 'User already verified' });
        if (user.otp !== otp) return res.status(400).json({ error: 'Invalid OTP' });
        if (new Date() > user.otp_expires) return res.status(400).json({ error: 'OTP has expired' });

        await prisma.user.update({
            where: { email },
            data: { is_verified: true, otp: null, otp_expires: null }
        });

        res.json({ message: 'Email verified successfully. You can now log in.' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

const resendOtp = async (req, res) => {
    try {
        const { email } = req.body;

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user) return res.status(404).json({ error: 'User not found' });
        if (user.is_verified) return res.status(400).json({ error: 'User already verified' });

        const otp = generateOtp();
        const otp_expires = new Date(Date.now() + 10 * 60 * 1000);

        await prisma.user.update({ where: { email }, data: { otp, otp_expires } });
        await sendOtp(email, otp);

        res.json({ message: 'OTP resent successfully.' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

const login = async (req, res) => {
    try {
        const { username, password } = req.body;

        const user = await prisma.user.findUnique({ where: { username } });
        if (!user) return res.status(404).json({ error: 'User not found' });
        if (!user.is_verified) return res.status(403).json({ error: 'Please verify your email first' });

        const match = await bcrypt.compare(password, user.password);
        if (!match) return res.status(401).json({ error: 'Invalid credentials' });

        const token = jwt.sign({ id: user.id, username: user.username }, process.env.JWT_SECRET, { expiresIn: '1d' });

        res.json({ message: 'Login successful', token });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

const logout = (req, res) => {
  res.json({ message: 'Logged out successfully' });
};

const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const otp = generateOtp();
    const reset_otp_expires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    await prisma.user.update({
      where: { email },
      data: { reset_otp: otp, reset_otp_expires }
    });

    await sendOtp(email, otp);

    res.json({ message: 'Password reset OTP sent to your email.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

const resetPassword = async (req, res) => {
  try {
    const { email, otp, new_password } = req.body;

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.reset_otp !== otp) return res.status(400).json({ error: 'Invalid OTP' });
    if (new Date() > user.reset_otp_expires) return res.status(400).json({ error: 'OTP has expired' });

    const hashed = await bcrypt.hash(new_password, 10);

    await prisma.user.update({
      where: { email },
      data: { password: hashed, reset_otp: null, reset_otp_expires: null }
    });

    res.json({ message: 'Password reset successfully. You can now log in.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

module.exports = { 
    register, 
    verifyOtp, 
    resendOtp, 
    login, 
    logout,
    forgotPassword,
    resetPassword
};