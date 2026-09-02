const prisma = require('../lib/prisma');
const { sendToUser } = require('../lib/websocket'); // Adjust path if your file is located elsewhere

const getMessages = async (req, res) => {
    try {
        const userId = req.user.id;
        const otherUserId = Number(req.params.otherUserId);

        if (isNaN(otherUserId)) {
            return res.status(400).json({ error: "Invalid recipient ID." });
        }

        // Mark unread messages from this user as read
        await prisma.message.updateMany({
            where: {
                sender_id: otherUserId,
                receiver_id: userId,
                is_read: false
            },
            data: { is_read: true }
        });

        const messages = await prisma.message.findMany({
            where: {
                OR: [
                    { sender_id: userId, receiver_id: otherUserId },
                    { sender_id: otherUserId, receiver_id: userId }
                ]
            },
            orderBy: { created_at: 'asc' }
        });

        res.json(messages);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

const sendMessage = async (req, res) => {
    try {
        const sender_id = req.user.id;
        const { receiver_id, content, loan_id } = req.body;

        const parsedReceiverId = Number(receiver_id);
        if (!receiver_id || isNaN(parsedReceiverId)) {
            return res.status(400).json({ error: "Invalid recipient ID." });
        }

        const message = await prisma.message.create({
            data: {
                sender_id,
                receiver_id: parsedReceiverId,
                loan_id: loan_id ? Number(loan_id) : null,
                content
            }
        });

        sendToUser(parsedReceiverId, {
            type: "new_message",
            ...message
        });

        res.status(201).json(message);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

const getConversations = async (req, res) => {
    try {
        const userId = req.user.id;

        const messages = await prisma.message.findMany({
            where: {
                OR: [
                    { sender_id: userId },
                    { receiver_id: userId }
                ]
            },
            include: {
                sender: { select: { id: true, first_name: true, last_name: true } },
                receiver: { select: { id: true, first_name: true, last_name: true } }
            },
            orderBy: { created_at: 'desc' }
        });

        const conversationMap = new Map();
        for (const msg of messages) {
            const otherUser = msg.sender_id === userId ? msg.receiver : msg.sender;
            if (!otherUser) continue;

            if (!conversationMap.has(otherUser.id)) {
                conversationMap.set(otherUser.id, {
                    user: otherUser,
                    lastMessage: msg,
                    // True if the last message was sent TO the current user and is unread
                    unread: msg.receiver_id === userId && !msg.is_read
                });
            }
        }

        res.json(Array.from(conversationMap.values()));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

module.exports = { getMessages, sendMessage, getConversations };