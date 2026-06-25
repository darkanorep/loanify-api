const jwt = require('jsonwebtoken');

const googleCallback = (req, res) => {
    try {
        const user = req.user;
        const token = jwt.sign(
            { id: user.id, username: user.username, email: user.email },
            process.env.JWT_SECRET,
            { expiresIn: '1d' }
        );

        // You can redirect to frontend with token or just return it
        res.json({ message: 'Google login successful', token });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

module.exports = { googleCallback };