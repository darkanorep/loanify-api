require('dotenv').config();
const express = require('express');
const cors = require('cors');
const session = require('express-session');
const passport = require('./src/lib/passport');
const http = require('http');
const { initWebSocket } = require('./src/lib/websocket');
const { initCronJobs } = require("./src/services/cron.service");

const apiRoutes = require('./route/api');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;
const isProduction = process.env.NODE_ENV === 'production';
const useSecureCookies = isProduction && process.env.COOKIE_SECURE !== 'false';

// Initialize native WebSocket server on the HTTP server
initWebSocket(server);

// Dynamic CORS configuration allowing localhost, local network IPs, and configured CLIENT_URL
app.use(cors({
    origin: (origin, callback) => {
        // Allow requests with no origin (like mobile apps, Postman, or server-to-server calls)
        if (!origin) return callback(null, true);

        // Allow configured CLIENT_URL, localhost, or any local IP network address (192.168.x.x, 10.x.x.x, 172.x.x.x)
        const allowedOrigins = [process.env.CLIENT_URL, 'http://localhost:5173', 'http://localhost:3000'];
        const isLocalNetwork = /^http:\/\/(192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}):(5173|3000)$/.test(origin);

        if (allowedOrigins.includes(origin) || isLocalNetwork || !isProduction) {
            return callback(null, true);
        }

        return callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

app.use(express.json());
app.use(session({
    secret: process.env.SESSION_SECRET || 'dev_secret_key',
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        secure: useSecureCookies,
        sameSite: 'lax',
    },
}));

app.use(passport.initialize());
app.use(passport.session());

app.use('/api', apiRoutes);

app.get('/', (req, res) => {
    res.json({ message: 'Loanify API is running' });
});

// Start HTTP + WebSocket server together on 0.0.0.0
server.listen(PORT,
    '0.0.0.0',
    () => {
    // console.log(`🚀 Loanify API & WebSockets running on http://0.0.0.0:${PORT}`);
    console.log(`🚀 Loanify API & WebSockets running on http://localhost:${PORT}`);
    initCronJobs();
});