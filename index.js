require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const cors = require('cors');
const cookieParser = require('cookie-parser');

const { router: authRouter } = require('./routes_auth');
const usersRouter = require('./routes_users');
const chatsRouter = require('./routes_chats');
const settingsRouter = require('./routes_settings');
const { UPLOADS_DIR } = require('./upload');
const { setupWebSocket } = require('./ws');

const app = express();
const server = http.createServer(app);

app.use(cors());
app.use(cookieParser());
app.use(express.json({ limit: '5mb' }));

app.use('/uploads', express.static(UPLOADS_DIR));
app.use(express.static(__dirname));

app.use('/api/auth', authRouter);
app.use('/api/users', usersRouter);
app.use('/api/chats', chatsRouter);
app.use('/api/settings', settingsRouter);

app.get('/api/health', (req, res) => res.json({ ok: true, name: 'Nexo API' }));

// Fallback to SPA
app.get('*', (req, res) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/uploads')) {
    return res.status(404).json({ error: 'Not found' });
  }
  res.sendFile(path.join(__dirname, 'index.html'));
});

setupWebSocket(server);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Nexo server running on http://localhost:${PORT}`);
});
