require('dotenv').config();
const express = require('express');
const cors = require('cors');
const session = require('express-session');
const passport = require('./src/lib/passport');

const authRoutes = require('./src/routes/auth.routes');
const oauthRoutes = require('./src/routes/oauth.routes');
const authenticate = require('./src/middlewares/auth');

const app = express();

// CORS must be registered before your routes — and before session/passport,
// so preflight OPTIONS requests get the right headers even before auth runs.
app.use(cors({
    origin: process.env.CLIENT_URL || 'http://localhost:5173', // exact origin, not "*" — required when credentials: true
    credentials: true,
}));

app.use(express.json());
app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true, // default true already, explicit here for clarity
        secure: process.env.NODE_ENV === 'production', // HTTPS-only in prod; must stay false for local http dev
        sameSite: 'lax', // localhost:3000 and localhost:5173 count as "same site" (same domain, different port) — lax works here
    },
}));
app.use(passport.initialize());
app.use(passport.session());

app.use('/api/auth', authRoutes);
app.use('/api/auth', oauthRoutes);

app.get('/', (req, res) => {
    res.json({ message: 'Loanify API is running' });
});

app.listen(3000, () => console.log('Server running on http://localhost:3000'));