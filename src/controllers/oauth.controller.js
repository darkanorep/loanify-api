const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const prisma = require('../lib/prisma');
const redis = require('../lib/redisClient');
const { addToken } = require('../lib/activeTokens');

const googleCallback = async (req, res) => {
    const clientUrl = process.env.CLIENT_URL;
    const isMobile = req.session?.oauthClient === 'mobile';

    try {
        const user = req.user;

        const token = jwt.sign(
            {
                id: user.id,
                username: user.username,
                email: user.email,
                is_admin: user.is_admin,
            },
            process.env.JWT_SECRET || 'loanify-dev-secret',
            { expiresIn: '1d' }
        );

        await addToken(token);
        await prisma.session.create({
            data: {
                user_id: user.id,
                token,
            },
        });

        if (isMobile) {
            const code = crypto.randomBytes(32).toString('hex');
            const result = {
                token,
                user: {
                    id: user.id,
                    email: user.email,
                    full_name: user.full_name,
                    is_admin: user.is_admin,
                },
            };

            await redis.set(
                `oauth_exchange:${code}`,
                JSON.stringify(result),
                'EX',
                60,
                'NX'
            );

            delete req.session.oauthClient;

            return res.redirect(
                `loanifymobile://oauth/callback?code=${encodeURIComponent(code)}`
            );
        }

        const redirectPath = user.is_admin ? '/admin/dashboard' : '/dashboard';

        return res.redirect(
            `${clientUrl}/oauth/callback?token=${encodeURIComponent(token)}&redirect=${encodeURIComponent(redirectPath)}`
        );
    } catch (err) {
        if (isMobile) {
            delete req.session.oauthClient;
            return res.redirect(
                'loanifymobile://oauth/callback?error=oauth_failed'
            );
        }

        return res.redirect(`${clientUrl}/login?error=oauth_failed`);
    }
};
const exchangeGoogleMobileCode = async (req, res) => {
    res.set('Cache-Control', 'no-store');

    const { code } = req.body || {};

    if (typeof code !== 'string' || !/^[a-f0-9]{64}$/i.test(code)) {
        return res.status(400).json({ error: 'Invalid authorization code' });
    }

    try {
        const result = await redis.eval(
            `
                local value = redis.call('GET', KEYS[1])
                if value then
                    redis.call('DEL', KEYS[1])
                end
                return value
            `,
            1,
            `oauth_exchange:${code}`
        );

        if (!result) {
            return res.status(401).json({
                error: 'Authorization code expired or already used',
            });
        }

        return res.json(JSON.parse(result));
    } catch {
        return res.status(500).json({ error: 'Could not complete sign-in' });
    }
};

module.exports = { googleCallback, exchangeGoogleMobileCode };