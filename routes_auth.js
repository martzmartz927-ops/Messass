const express = require('express');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const db = require('./db_init');
const { signToken, authMiddleware } = require('./server_auth');

const router = express.Router();

function publicUser(u) {
  return {
    id: u.id,
    login: u.login,
    username: u.username,
    nickname: u.nickname,
    bio: u.bio,
    avatarPath: u.avatar_path,
    isOnline: !!u.is_online,
    lastSeen: u.last_seen
  };
}

router.post('/register', (req, res) => {
  const { login, password, nickname, username } = req.body;
  if (!login || !password || !nickname || !username) {
    return res.status(400).json({ error: 'Заполните все поля' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Пароль должен быть не менее 6 символов' });
  }
  const cleanUsername = username.startsWith('@') ? username : '@' + username;
  const uNameOk = /^@[a-zA-Z0-9_]{3,32}$/.test(cleanUsername);
  if (!uNameOk) {
    return res.status(400).json({ error: 'Username: только латиница, цифры и _ (3-32 символа)' });
  }

  const existingLogin = db.prepare('SELECT id FROM users WHERE login = ?').get(login);
  if (existingLogin) return res.status(409).json({ error: 'Этот логин уже занят' });
  const existingUsername = db.prepare('SELECT id FROM users WHERE username = ?').get(cleanUsername);
  if (existingUsername) return res.status(409).json({ error: 'Этот username уже занят' });

  const hash = bcrypt.hashSync(password, 10);
  const now = Date.now();
  const info = db.prepare(`
    INSERT INTO users (login, username, nickname, password_hash, bio, created_at, last_seen, is_online)
    VALUES (?, ?, ?, ?, '', ?, ?, 0)
  `).run(login, cleanUsername, nickname, hash, now, now);

  const userId = info.lastInsertRowid;
  db.prepare('INSERT INTO settings (user_id) VALUES (?)').run(userId);

  const sessionId = uuidv4();
  db.prepare('INSERT INTO sessions (id, user_id, user_agent, created_at, last_active) VALUES (?, ?, ?, ?, ?)')
    .run(sessionId, userId, req.headers['user-agent'] || '', now, now);

  const token = signToken(userId, sessionId);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  res.json({ token, user: publicUser(user) });
});

router.post('/login', (req, res) => {
  const { login, password } = req.body;
  if (!login || !password) return res.status(400).json({ error: 'Введите логин и пароль' });

  const user = db.prepare('SELECT * FROM users WHERE login = ?').get(login);
  if (!user) return res.status(401).json({ error: 'Неверный логин или пароль' });
  const ok = bcrypt.compareSync(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: 'Неверный логин или пароль' });

  const now = Date.now();
  const sessionId = uuidv4();
  db.prepare('INSERT INTO sessions (id, user_id, user_agent, created_at, last_active) VALUES (?, ?, ?, ?, ?)')
    .run(sessionId, user.id, req.headers['user-agent'] || '', now, now);
  db.prepare('UPDATE users SET last_seen = ? WHERE id = ?').run(now, user.id);

  const token = signToken(user.id, sessionId);
  res.json({ token, user: publicUser(user) });
});

router.post('/logout', authMiddleware, (req, res) => {
  db.prepare('DELETE FROM sessions WHERE id = ?').run(req.sessionId);
  res.json({ ok: true });
});

router.get('/me', authMiddleware, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.userId);
  if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
  res.json({ user: publicUser(user) });
});

router.get('/sessions', authMiddleware, (req, res) => {
  const rows = db.prepare('SELECT id, user_agent, created_at, last_active FROM sessions WHERE user_id = ? ORDER BY last_active DESC').all(req.userId);
  res.json({ sessions: rows.map(r => ({ ...r, current: r.id === req.sessionId })) });
});

router.delete('/sessions/:id', authMiddleware, (req, res) => {
  db.prepare('DELETE FROM sessions WHERE id = ? AND user_id = ?').run(req.params.id, req.userId);
  res.json({ ok: true });
});

module.exports = { router, publicUser };
