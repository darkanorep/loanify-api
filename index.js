require('dotenv').config();
const express = require('express');
const cors = require('cors');
const session = require('express-session');
const passport = require('./src/lib/passport');
const http = require('http');
const { Server } = require('socket.io');

const apiRoutes = require('./route/api');

const app = express();
const PORT = process.env.PORT;
const isProduction = process.env.NODE_ENV === 'production';
const useSecureCookies = isProduction && process.env.COOKIE_SECURE !== 'false';
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: process.env.CLIENT_URL, methods: ["GET", "POST"] } // Match your Vite frontend URL
});
app.set('io', io);

io.on('connection', (socket) => {
  socket.on('identify', (userId) => {
    socket.join(`user_${userId}`); // e.g., joins room 'user_5'
  });
});

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