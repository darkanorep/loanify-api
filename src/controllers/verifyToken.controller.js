const jwt = require('jsonwebtoken');
const { isTokenActive } = require('../lib/activeTokens'); // adjust path if yours differs

const verifyToken = async (req, res) => {
    const authHeader = req.headers.authorization; // "Bearer <token>"
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ valid: false, error: 'No token provided.' });
    }

    try {
        // 1. Signature + expiry check
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        // 2. Allowlist check — catches tokens that are cryptographically
        // valid but were revoked via logout (this is the check that was
        // missing entirely before, letting a copied token back in).
        const active = await isTokenActive(token);
        if (!active) {
            return res.status(401).json({ valid: false, error: 'Token has been revoked.' });
        }

        res.json({
            valid: true,
            user: { id: decoded.id, username: decoded.username, email: decoded.email },
        });
    } catch (err) {
        res.status(401).json({ valid: false, error: 'Invalid or expired token.' });
    }
};

module.exports = { verifyToken };