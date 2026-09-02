const WebSocket = require('ws');
const jwt = require('jsonwebtoken');

const activeClients = new Map(); // userId -> WebSocket instance

function initWebSocket(server) {
    const wss = new WebSocket.Server({ server });

    wss.on('connection', (ws, req) => {
        try {
            const urlParams = new URLSearchParams(req.url.split('?')[1]);
            const token = urlParams.get('token');

            if (!token) {
                ws.close(4001, "Missing authentication token");
                return;
            }

            // Ensure this matches the secret used in your auth controller/middleware
            const secret = process.env.JWT_SECRET || process.env.ACCESS_TOKEN_SECRET || "loanify-dev-secret";
            const decoded = jwt.verify(token, secret);

            // Adjust 'id' if your token payload stores user ID under a different key (e.g., decoded.userId)
            const userId = decoded.id || decoded.userId;

            if (!userId) {
                ws.close(4002, "Invalid token payload structure");
                return;
            }

            activeClients.set(userId, ws);
            ws.send(JSON.stringify({ type: "connected", userId }));

            ws.on('close', () => {
                activeClients.delete(userId);
            });
        } catch (err) {
            console.error("WebSocket Authentication Failed:", err.message);
            ws.close(4003, "Invalid or expired token");
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

module.exports = { initWebSocket, sendToUser };