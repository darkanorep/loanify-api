const jwt = require('jsonwebtoken');
const { addToken } = require('../lib/activeTokens'); // adjust path if yours differs

const googleCallback = async (req, res) => {
    const clientUrl = process.env.CLIENT_URL;
    try {
        const user = req.user;
        const token = jwt.sign(
            { id: user.id, username: user.username, email: user.email },
            process.env.JWT_SECRET,
            { expiresIn: '1d' }
        );

        await addToken(token); // now recognized as valid by the auth middleware

        res.redirect(`${clientUrl}/oauth/callback?token=${token}`);
    } catch (err) {
        res.redirect(`${clientUrl}/login?error=oauth_failed`);
    }
};

module.exports = { googleCallback };