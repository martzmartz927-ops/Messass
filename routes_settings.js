const express = require('express');
const db = require('./db_init');
const { authMiddleware } = require('./server_auth');

const router = express.Router();

const FIELDS = [
  'theme', 'accent_color',
  'notif_messages', 'notif_sound', 'notif_preview',
  'privacy_last_seen', 'privacy_avatar', 'privacy_add_by_username',
  'chat_wallpaper', 'chat_font_size', 'chat_enter_to_send',
  'data_autodownload_photos', 'data_autodownload_files',
  'language', 'read_receipts'
];

function toCamel(row) {
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    const camel = k.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    out[camel] = v;
  }
  return out;
}

router.get('/', authMiddleware, (req, res) => {
  let row = db.prepare('SELECT * FROM settings WHERE user_id = ?').get(req.userId);
  if (!row) {
    db.prepare('INSERT INTO settings (user_id) VALUES (?)').run(req.userId);
    row = db.prepare('SELECT * FROM settings WHERE user_id = ?').get(req.userId);
  }
  res.json({ settings: toCamel(row) });
});

router.patch('/', authMiddleware, (req, res) => {
  const updates = req.body || {};
  const setClauses = [];
  const values = [];
  for (const field of FIELDS) {
    const camel = field.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    if (Object.prototype.hasOwnProperty.call(updates, camel)) {
      setClauses.push(`${field} = ?`);
      values.push(updates[camel]);
    }
  }
  if (setClauses.length === 0) return res.status(400).json({ error: 'Нет полей для обновления' });
  values.push(req.userId);
  db.prepare(`UPDATE settings SET ${setClauses.join(', ')} WHERE user_id = ?`).run(...values);
  const row = db.prepare('SELECT * FROM settings WHERE user_id = ?').get(req.userId);
  res.json({ settings: toCamel(row) });
});

// Change password
const bcrypt = require('bcryptjs');
router.post('/password', authMiddleware, (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!newPassword || newPassword.length < 6) {
    return res.status(400).json({ error: 'Новый пароль должен быть не менее 6 символов' });
  }
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.userId);
  const ok = bcrypt.compareSync(currentPassword || '', user.password_hash);
  if (!ok) return res.status(401).json({ error: 'Неверный текущий пароль' });
  const hash = bcrypt.hashSync(newPassword, 10);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, req.userId);
  res.json({ ok: true });
});

// Account deletion
router.delete('/account', authMiddleware, (req, res) => {
  db.prepare('DELETE FROM users WHERE id = ?').run(req.userId);
  res.json({ ok: true });
});

module.exports = router;
