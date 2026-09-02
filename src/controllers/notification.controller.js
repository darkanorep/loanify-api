const prisma = require('../lib/prisma');

const getNotifications = async (req, res) => {
    try {
        const userId = req.user.id;
        const notifications = await prisma.notification.findMany({
            where: { user_id: userId },
            orderBy: { created_at: 'desc' },
            take: 20 // limit to last 20 notifications
        });
        res.json(notifications);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

const markAsRead = async (req, res) => {
    try {
        const userId = req.user.id;
        const { id } = req.params;

        await prisma.notification.updateMany({
            where: { id: parseInt(id), user_id: userId },
            data: { is_read: true }
        });

        res.json({ message: "Notification marked as read." });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

module.exports = { getNotifications, markAsRead };