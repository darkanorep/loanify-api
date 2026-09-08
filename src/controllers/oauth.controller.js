const jwt = require('jsonwebtoken');
const prisma = require('../lib/prisma');
const { addToken } = require('../lib/activeTokens');

const googleCallback = async (req, res) => {
    const clientUrl = process.env.CLIENT_URL;
    try {
        const user = req.user;
        const token = jwt.sign(
            { id: user.id, username: user.username, email: user.email, is_admin: user.is_admin },
            process.env.JWT_SECRET || "loanify-dev-secret",
            { expiresIn: '1d' }
        );

        // Register in active tokens cache/store and save session in database
        await addToken(token);
        await prisma.session.create({
            data: {
                user_id: user.id,
                token: token
            }
        });

        // Dynamically route based on admin privileges
        const redirectPath = user.is_admin ? "/admin/dashboard" : "/dashboard";

        res.redirect(`${clientUrl}/oauth/callback?token=${token}&redirect=${redirectPath}`);
    } catch (err) {
        res.redirect(`${clientUrl}/login?error=oauth_failed`);
    }
};

module.exports = { googleCallback };