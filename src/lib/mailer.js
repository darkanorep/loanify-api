const nodemailer = require('nodemailer');
const { otpEmailTemplate } = require('./otpEmailTemplate'); // adjust path if yours differs

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS, // App Password, not your real Gmail password
    },
});

async function sendOtp(email, otp) {
    await transporter.sendMail({
        from: `"Loanify" <${process.env.EMAIL_USER}>`,
        to: email,
        subject: 'Your Loanify OTP Code',
        text: `Your OTP code is: ${otp}. It expires in 10 minutes.`, // plain-text fallback
        html: otpEmailTemplate(otp),
    });
}

module.exports = { sendOtp };