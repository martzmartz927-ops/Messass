const express = require('express');
const path = require('path');
const db = require('./db_init');
const { authMiddleware } = require('./server_auth');
const { avatarUpload } = require('./upload');
const { publicUser } = require('./routes_auth');

const router = express.Router();

router.patch('/me', authMiddleware, (req, res) => {
  const { nickname, bio, username } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.userId);
  if (!user) return res.status(404).json({ error: 'Не найдено' });

  let newUsername = user.username;
  if (username) {
    const cleanUsername = username.startsWith('@') ? username : '@' + username;
    if (!/^@[a-zA-Z0-9_]{3,32}$/.test(cleanUsername)) {
      return res.status(400).json({ error: 'Username: только латиница, цифры и _ (3-32 символа)' });
    }
    const taken = db.prepare('SELECT id FROM users WHERE username = ? AND id != ?').get(cleanUsername, req.userId);
    if (taken) return res.status(409).json({ error: 'Этот username уже занят' });
    newUsername = cleanUsername;
  }

  db.prepare('UPDATE users SET nickname = COALESCE(?, nickname), bio = COALESCE(?, bio), username = ? WHERE id = ?')
    .run(nickname || null, (bio !== undefined ? bio : null), newUsername, req.userId);

  const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(req.userId);
  res.json({ user: publicUser(updated) });
});

router.post('/me/avatar', authMiddleware, avatarUpload.single('avatar'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Файл не получен' });
  const relPath = `/uploads/avatars/${req.file.filename}`;
  db.prepare('UPDATE users SET avatar_path = ? WHERE id = ?').run(relPath, req.userId);
  res.json({ avatarPath: relPath });
});

router.get('/search', authMiddleware, (req, res) => {
  const q = (req.query.q || '').toString().trim();
  if (!q) return res.json({ users: [] });
  const like = `%${q}%`;
  const rows = db.prepare(`
    SELECT * FROM users
    WHERE (username LIKE ? OR nickname LIKE ?) AND id != ?
    LIMIT 20
  `).all(like, like, req.userId);
  res.json({ users: rows.map(publicUser) });
});

router.get('/contacts', authMiddleware, (req, res) => {
  const rows = db.prepare(`
    SELECT u.* FROM contacts c
    JOIN users u ON u.id = c.contact_id
    WHERE c.user_id = ?
    ORDER BY u.nickname COLLATE NOCASE
  `).all(req.userId);
  res.json({ contacts: rows.map(publicUser) });
});

router.post('/contacts', authMiddleware, (req, res) => {
  const { username, userId } = req.body;
  let target;
  if (userId) target = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  else if (username) {
    const clean = username.startsWith('@') ? username : '@' + username;
    target = db.prepare('SELECT * FROM users WHERE username = ?').get(clean);
  }
  if (!target) return res.status(404).json({ error: 'Пользователь не найден' });
  if (target.id === req.userId) return res.status(400).json({ error: 'Нельзя добавить самого себя' });

  const now = Date.now();
  db.prepare('INSERT OR IGNORE INTO contacts (user_id, contact_id, created_at) VALUES (?, ?, ?)')
    .run(req.userId, target.id, now);
  res.json({ contact: publicUser(target) });
});

router.delete('/contacts/:id', authMiddleware, (req, res) => {
  db.prepare('DELETE FROM contacts WHERE user_id = ? AND contact_id = ?').run(req.userId, req.params.id);
  res.json({ ok: true });
});

module.exports = router;
