require('dotenv').config();
const express = require('express');
const session = require('express-session');
const passport = require('./src/lib/passport');

const authRoutes = require('./src/routes/auth.routes');
const oauthRoutes = require('./src/routes/oauth.routes');

const app = express();

app.use(express.json());
app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
}));
app.use(passport.initialize());
app.use(passport.session());

app.use('/api/auth', authRoutes);
app.use('/api/auth', oauthRoutes);

app.get('/', (req, res) => {
    res.json({ message: 'Loanify API is running' });
});

app.listen(3000, () => console.log('Server running on http://localhost:3000'));