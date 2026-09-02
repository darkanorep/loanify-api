const jwt = require('jsonwebtoken');
const prisma = require('../lib/prisma');

const authenticate = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: "Access token missing or malformed." });
    }

    const token = authHeader.split(' ')[1];

    try {
        // 1. Verify token signature & expiration
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        // 2. Check if session exists in database (ensures it wasn't wiped out by logout)
        const activeSession = await prisma.session.findUnique({
            where: { token }
        });

        if (!activeSession) {
            return res.status(401).json({ error: "Session expired or logged out." });
        }

        req.user = decoded;
        next();
    } catch (err) {
        return res.status(401).json({ error: "Invalid or expired token." });
    }
};

module.exports = authenticate;