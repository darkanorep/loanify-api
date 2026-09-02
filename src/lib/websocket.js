const WebSocket = require('ws');
const jwt = require('jsonwebtoken');
const prisma = require('./prisma');

const activeClients = new Map(); // userId -> WebSocket instance

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

            // Verify that the token session exists in the database to prevent logged-out use
            const session = await prisma.session.findUnique({
                where: { token }
            });

            if (!session) {
                ws.close(4003, "Session expired or logged out");
                return;
            }

            activeClients.set(userId, ws);
            ws.send(JSON.stringify({ type: "connected", userId }));

            ws.on('close', () => {
                activeClients.delete(userId);
            });
        } catch (err) {
            console.error("WebSocket Authentication Failed:", err.message);
            ws.close(4004, "Invalid or expired token");
        }
    });

    return wss;
}

function sendToUser(userId, data) {
    const clientWs = activeClients.get(userId);
    if (clientWs && clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(JSON.stringify(data));
        return true;
    }
    return false;
}

// Broadcast to ALL connected clients
function broadcast(data) {
    for (const [userId, clientWs] of activeClients.entries()) {
        if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(JSON.stringify(data));
        }
    }
}

module.exports = { initWebSocket, sendToUser, broadcast };