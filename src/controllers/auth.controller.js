const crypto = require('crypto');
const { addToken, removeToken } = require('../lib/activeTokens');
const prisma = require('../lib/prisma');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { sendOtp } = require('../lib/mailer');

const generateOtp = () => Math.floor(100000 + Math.random() * 900000).toString();

const register = async (req, res) => {
    try {
        const { first_name, middle_name, last_name, email, phone_number, username, password } = req.body;

        const existingUser = await prisma.user.findUnique({
            where: { email: email }
        });

        if (existingUser) {
            return res.status(400).json({
                error: "An account with this email is already registered."
            });
        }

        const hashed = await bcrypt.hash(password, 10);
        const otp = generateOtp();
        const otp_expires = new Date(Date.now() + 10 * 60 * 1000);

        await prisma.user.create({
            data: { first_name, middle_name, last_name, email, phone_number, username, password: hashed, otp, otp_expires }
        });

        await sendOtp(email, otp);

        res.status(201).json({ message: 'Registered successfully. Check your email for the OTP.' });
    } catch (err) {
        if (err.code === 'P2002') {
            return res.status(400).json({ error: `An account with this ${err.meta.target[0]} already exists.` });
        }
        res.status(500).json({ error: "Something went wrong during registration." });
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

        const token = jwt.sign(
            {
                id: user.id,
                jti: crypto.randomUUID() // Ensures every token is completely unique
            },
            process.env.JWT_SECRET || "loanify-dev-secret",
            { expiresIn: '7d' }
        );

        await addToken(token);

        await prisma.session.create({
            data: {
                user_id: user.id,
                token: token
            }
        });

        res.json({ message: 'Login successful', token, user : { id: user.id, email: user.email, full_name: user.full_name, is_admin: user.is_admin, } });
    } catch (err) {
        console.error("Login error:", err);
        res.status(500).json({ error: err.message });
    }
};

const logout = async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        const token = authHeader && authHeader.split(' ')[1];

        if (token) {
            await removeToken(token);
            await prisma.session.deleteMany({
                where: { token }
            });
        }

        res.json({ message: 'Logged out successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
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

const requestProfileOtp = async (req, res) => {
    try {
        const userId = req.user.id;
        const { email, phone_country_code, phone_number } = req.body;

        const user = await prisma.user.findUnique({ where: { id: userId } });
        if (!user) return res.status(404).json({ error: 'User not found' });

        const otp = generateOtp();
        const otp_expires = new Date(Date.now() + 10 * 60 * 1000);

        await prisma.user.update({
            where: { id: userId },
            data: { otp, otp_expires }
        });

        const targetEmail = email || user.email;
        await sendOtp(targetEmail, otp);

        res.json({ message: 'Verification code sent successfully.' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

const updateProfileWithOtp = async (req, res) => {
    try {
        const userId = req.user.id;
        const { full_name, email, phone_country_code, phone_number, otp_code } = req.body;

        const user = await prisma.user.findUnique({ where: { id: userId } });
        if (!user) return res.status(404).json({ error: 'User not found' });

        const emailChanged = email && email !== user.email;
        const phoneChanged = phone_number && phone_number !== user.phone_number;

        if (emailChanged || phoneChanged) {
            if (!otp_code || user.otp !== otp_code) {
                return res.status(400).json({ error: 'Invalid verification code' });
            }
            if (user.otp_expires && new Date() > user.otp_expires) {
                return res.status(400).json({ error: 'Verification code has expired' });
            }
        }

        const updatedUser = await prisma.user.update({
            where: { id: userId },
            data: {
                first_name: full_name ? full_name.split(" ")[0] : user.first_name,
                last_name: full_name ? full_name.split(" ").slice(1).join(" ") : user.last_name,
                email: email || user.email,
                phone_country_code: phone_country_code || user.phone_country_code,
                phone_number: phone_number || user.phone_number,
                otp: null,
                otp_expires: null
            }
        });

        res.json({ message: 'Profile updated successfully', user: updatedUser });
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
    resetPassword,
    requestProfileOtp,
    updateProfileWithOtp
};