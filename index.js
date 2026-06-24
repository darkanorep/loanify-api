const express = require('express');
require('dotenv').config();

const authRoutes = require('./src/routes/auth.routes');

const app = express();
app.use(express.json());

app.use('/api/auth', authRoutes);

app.get('/', (req, res) => {
    res.json({ message: 'Loanify API is running' });
});

app.listen(3000, () => console.log('Server running on http://localhost:3000'));