const prisma = require('../lib/prisma');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { sendOtp } = require('../lib/mailer');

const generateOtp = () => require('crypto').randomInt(100000, 1000000).toString();
const hashOtp = (otp) => require('crypto').createHash('sha256').update(otp).digest('hex');
const register = async (req, res) => {
    try {
        const { first_name, middle_name, last_name, email, phone_number, username, password } = req.body;

        const hashed = await bcrypt.hash(password, 10);
        const otp = generateOtp();
        const otp_expires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

        const user = await prisma.user.create({
            data: { first_name, middle_name, last_name, email, phone_number, username, password: hashed, otp: hashOtp(otp), otp_expires }
        });

        try {
            await sendOtp(email, otp);
        } catch (emailErr) {
            return res.status(201).json({ message: 'Registered successfully. Unable to send OTP right now; please use the resend OTP endpoint.' });
        }

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

module.exports = { register, verifyOtp, resendOtp, login };