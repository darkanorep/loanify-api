const express = require('express');
const router = express.Router();
const { getMessages, sendMessage, getConversations } = require('../controllers/chat.controller');

// IMPORTANT: Place static routes before dynamic parameters (/:otherUserId)
router.get('/conversations/list', getConversations);
router.get('/:otherUserId', getMessages);
router.post('/', sendMessage);

module.exports = router;