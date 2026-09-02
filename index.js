require('dotenv').config();
const express = require('express');
const cors = require('cors');
const session = require('express-session');
const passport = require('./src/lib/passport');
const http = require('http');
const { initWebSocket } = require('./src/lib/websocket');

const apiRoutes = require('./route/api');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;
const isProduction = process.env.NODE_ENV === 'production';
const useSecureCookies = isProduction && process.env.COOKIE_SECURE !== 'false';

// Initialize native WebSocket server on the HTTP server
initWebSocket(server);

// CORS must be registered before your routes — and before session/passport,
// so preflight OPTIONS requests get the right headers even before auth runs.
app.use(cors({
    origin: process.env.CLIENT_URL, // exact origin, not "*" — required when credentials: true
    credentials: true,
}));

app.use(express.json());
app.use(session({
    secret: process.env.SESSION_SECRET || 'loanify-dev-secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true, // default true already, explicit here for clarity
        secure: useSecureCookies,
        sameSite: 'lax', // localhost:3000 and localhost:5173 count as "same site" (same domain, different port) — lax works here
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
});