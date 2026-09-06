const prisma = require('../lib/prisma');
const verifyAdmin = async (req, res, next) => {
    try {
        const user = await prisma.user.findUnique({ where: { id: req.user.id } });
        if (!user || !user.is_admin) {
            return res.status(403).json({ error: 'Access denied. Administrator privileges required.' });
        }
        next();
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

module.exports = verifyAdmin;