const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
    },
});

const sendOtp = async (to, otp) => {
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
        throw new Error('Email transport is not configured (missing EMAIL_USER/EMAIL_PASS)');
    }

    await transporter.sendMail({
        from: `"Loanify" <${process.env.EMAIL_USER}>`,
        to,
        subject: 'Your Loanify OTP Code',
        html: `<p>Your OTP code is: <strong>${otp}</strong>. It expires in 10 minutes.</p>`,
    });
};

module.exports = { sendOtp };