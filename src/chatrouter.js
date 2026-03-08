const express = require('express');
const fs = require('fs');
const path = require('path');

var CHAT_FILE = path.join(__dirname, 'chat.json');
var MAX_MESSAGES = 100;

// Загружаем сообщения при старте
var messages = [];
try {
    if (fs.existsSync(CHAT_FILE)) {
        messages = JSON.parse(fs.readFileSync(CHAT_FILE, 'utf8'));
    }
} catch (err) {
    console.error('Error loading chat:', err);
}

// Функция сохранения
function saveMessages() {
    try {
        const toSave = messages.slice(-MAX_MESSAGES);
        fs.writeFileSync(CHAT_FILE, JSON.stringify(toSave, null, 2));
    } catch (err) {
        console.error('Error saving chat:', err);
    }
}

var chatRouter = express.Router();

// GET /api/chat/messages
chatRouter.get('/messages', (req, res) => {
    const limit = parseInt(req.query.limit) || 50;
    res.json(messages.slice(-limit));
});

// POST /api/chat/messages
chatRouter.post('/messages', (req, res) => {
    const { username, text } = req.body;

    if (!username?.trim() || !text?.trim()) {
        return res.status(400).json({ error: 'Username and text required' });
    }

    const message = {
        id: Date.now().toString(),
        username: username.trim(),
        text: text.trim(),
        timestamp: new Date().toISOString()
    };

    messages.push(message);

    if (messages.length > MAX_MESSAGES) {
        messages = messages.slice(-MAX_MESSAGES);
    }

    saveMessages();
    res.status(201).json(message);
});

// POST /api/chat/clear (опционально)
chatRouter.post('/clear', (req, res) => {
    if (req.body.secret === process.env.CHAT_SECRET) {
        messages = [];
        saveMessages();
        res.json({ success: true });
    } else {
        res.status(403).json({ error: 'Unauthorized' });
    }
});

module.exports = {
    chatRouter
}