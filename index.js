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

// Trust proxy if running behind reverse proxies or ngrok/tunnels during webhook testing
app.set('trust proxy', 1);

// Initialize native WebSocket server on the HTTP server
initWebSocket(server);

// CORS configuration supporting credentials from frontend
const allowedOrigins = [
    process.env.CLIENT_URL || 'http://localhost:5173',
    'http://localhost:5173'
];

app.use(cors({
    origin: (origin, callback) => {
        // Allow requests with no origin (like mobile apps, curl, or server-to-server webhooks)
        if (!origin || allowedOrigins.includes(origin)) {
            return callback(null, true);
        }
        return callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
}));

app.use(express.json());

// Session configuration optimized for cross-site redirects (PayMongo -> Localhost)
app.use(session({
    name: 'loanify_sid',
    secret: process.env.SESSION_SECRET || 'loanify_fallback_secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        secure: useSecureCookies,
        // 'lax' allows session cookie persistence on top-level GET redirects from external sites (PayMongo)
        sameSite: 'lax',
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
    },
}));

app.use(passport.initialize());
app.use(passport.session());

app.use('/api', apiRoutes);

app.get('/', (req, res) => {
    res.json({ message: 'Loanify API is running' });
});

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    initCronJobs();
});