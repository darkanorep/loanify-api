const WebSocket = require('ws');
const jwt = require('jsonwebtoken');
const prisma = require('./prisma');

const activeClients = new Map(); // userId -> Set of WebSocket instances

function initWebSocket(server) {
    const wss = new WebSocket.Server({ server });

    wss.on('connection', async (ws, req) => {
        try {
            const urlParams = new URLSearchParams(req.url.split('?')[1]);
            const token = urlParams.get('token');

            if (!token) {
                ws.close(4001, "Missing authentication token");
                return;
            }

            const secret = process.env.JWT_SECRET || process.env.ACCESS_TOKEN_SECRET || "loanify-dev-secret";
            const decoded = jwt.verify(token, secret);
            const userId = decoded.id || decoded.userId;

            if (!userId) {
                ws.close(4002, "Invalid token payload structure");
                return;
            }

            const session = await prisma.session.findUnique({ where: { token } });
            if (!session) {
                ws.close(4003, "Session expired or logged out");
                return;
            }

            // Register socket into user's connection set (supports multiple tabs)
            if (!activeClients.has(userId)) {
                activeClients.set(userId, new Set());
            }
            activeClients.get(userId).add(ws);

            ws.send(JSON.stringify({ type: "connected", userId }));

            ws.on('close', () => {
                const userSockets = activeClients.get(userId);
                if (userSockets) {
                    userSockets.delete(ws);
                    if (userSockets.size === 0) {
                        activeClients.delete(userId);
                    }
                }
            });
        } catch (err) {
            console.error("WebSocket Authentication Failed:", err.message);
            ws.close(4004, "Invalid or expired token");
        }
    });

    return wss;
}

function sendToUser(userId, data) {
    const userSockets = activeClients.get(userId);
    if (userSockets) {
        for (const clientWs of userSockets) {
            if (clientWs.readyState === WebSocket.OPEN) {
                clientWs.send(JSON.stringify(data));
            }
        }
        return true;
    }
    return false;
}

function broadcast(data) {
    for (const [userId, userSockets] of activeClients.entries()) {
        for (const clientWs of userSockets) {
            if (clientWs.readyState === WebSocket.OPEN) {
                clientWs.send(JSON.stringify(data));
            }
        }
    }
}

module.exports = { initWebSocket, sendToUser, broadcast };