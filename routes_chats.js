const express = require('express');
const db = require('./db_init');
const { authMiddleware } = require('./server_auth');
const { mediaUpload, stickerUpload } = require('./upload');
const { sendToUser, broadcastToChat } = require('./ws');
const { publicUser } = require('./routes_auth');

const router = express.Router();

function getOrCreateDirectChat(userA, userB) {
  const existing = db.prepare(`
    SELECT cm1.chat_id AS chat_id FROM chat_members cm1
    JOIN chat_members cm2 ON cm1.chat_id = cm2.chat_id
    JOIN chats c ON c.id = cm1.chat_id
    WHERE cm1.user_id = ? AND cm2.user_id = ? AND c.is_group = 0
  `).get(userA, userB);
  if (existing) return existing.chat_id;

  const now = Date.now();
  const info = db.prepare('INSERT INTO chats (is_group, title, created_at) VALUES (0, NULL, ?)').run(now);
  const chatId = info.lastInsertRowid;
  db.prepare('INSERT INTO chat_members (chat_id, user_id) VALUES (?, ?)').run(chatId, userA);
  db.prepare('INSERT INTO chat_members (chat_id, user_id) VALUES (?, ?)').run(chatId, userB);
  return chatId;
}

function chatSummary(chatId, forUserId) {
  const chat = db.prepare('SELECT * FROM chats WHERE id = ?').get(chatId);
  const member = db.prepare('SELECT * FROM chat_members WHERE chat_id = ? AND user_id = ?').get(chatId, forUserId);
  const lastMsg = db.prepare('SELECT * FROM messages WHERE chat_id = ? AND deleted = 0 ORDER BY id DESC LIMIT 1').get(chatId);

  let peer = null;
  if (!chat.is_group) {
    const other = db.prepare(`
      SELECT u.* FROM chat_members cm JOIN users u ON u.id = cm.user_id
      WHERE cm.chat_id = ? AND cm.user_id != ?
    `).get(chatId, forUserId);
    peer = other ? publicUser(other) : null;
  }

  return {
    id: chat.id,
    isGroup: !!chat.is_group,
    title: chat.is_group ? chat.title : (peer ? peer.nickname : 'Чат'),
    peer,
    pinned: !!(member && member.pinned),
    unread: member ? member.unread_count : 0,
    lastMessage: lastMsg ? {
      id: lastMsg.id, type: lastMsg.type, content: lastMsg.content,
      senderId: lastMsg.sender_id, createdAt: lastMsg.created_at
    } : null
  };
}

router.get('/', authMiddleware, (req, res) => {
  const rows = db.prepare('SELECT chat_id FROM chat_members WHERE user_id = ?').all(req.userId);
  const chats = rows.map(r => chatSummary(r.chat_id, req.userId));
  chats.sort((a, b) => {
    if (a.pinned !== b.pinned) return b.pinned - a.pinned;
    const at = a.lastMessage ? a.lastMessage.createdAt : 0;
    const bt = b.lastMessage ? b.lastMessage.createdAt : 0;
    return bt - at;
  });
  res.json({ chats });
});

router.post('/direct', authMiddleware, (req, res) => {
  const { userId } = req.body;
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!target) return res.status(404).json({ error: 'Пользователь не найден' });
  const chatId = getOrCreateDirectChat(req.userId, userId);
  res.json({ chat: chatSummary(chatId, req.userId) });
});

router.post('/:id/pin', authMiddleware, (req, res) => {
  const { pinned } = req.body;
  db.prepare('UPDATE chat_members SET pinned = ? WHERE chat_id = ? AND user_id = ?')
    .run(pinned ? 1 : 0, req.params.id, req.userId);
  res.json({ ok: true });
});

function assertMember(chatId, userId) {
  return db.prepare('SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?').get(chatId, userId);
}

router.get('/:id/messages', authMiddleware, (req, res) => {
  const chatId = req.params.id;
  if (!assertMember(chatId, req.userId)) return res.status(403).json({ error: 'Нет доступа' });
  const before = req.query.before ? parseInt(req.query.before, 10) : null;
  const limit = Math.min(parseInt(req.query.limit || '50', 10), 200);

  let rows;
  if (before) {
    rows = db.prepare('SELECT * FROM messages WHERE chat_id = ? AND id < ? AND deleted = 0 ORDER BY id DESC LIMIT ?')
      .all(chatId, before, limit);
  } else {
    rows = db.prepare('SELECT * FROM messages WHERE chat_id = ? AND deleted = 0 ORDER BY id DESC LIMIT ?')
      .all(chatId, limit);
  }
  rows.reverse();

  // mark read
  const last = rows.length ? rows[rows.length - 1].id : 0;
  if (last) {
    db.prepare('UPDATE chat_members SET unread_count = 0, last_read_message_id = ? WHERE chat_id = ? AND user_id = ?')
      .run(last, chatId, req.userId);
  }

  res.json({
    messages: rows.map(m => ({
      id: m.id, chatId: m.chat_id, senderId: m.sender_id, type: m.type,
      content: m.content, mediaPath: m.media_path, mediaName: m.media_name,
      createdAt: m.created_at, editedAt: m.edited_at
    }))
  });
});

function insertMessage(chatId, senderId, type, content, mediaPath, mediaName) {
  const now = Date.now();
  const info = db.prepare(`
    INSERT INTO messages (chat_id, sender_id, type, content, media_path, media_name, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(chatId, senderId, type, content || null, mediaPath || null, mediaName || null, now);

  // bump unread for everyone else
  const members = db.prepare('SELECT user_id FROM chat_members WHERE chat_id = ?').all(chatId);
  for (const m of members) {
    if (m.user_id !== senderId) {
      db.prepare('UPDATE chat_members SET unread_count = unread_count + 1 WHERE chat_id = ? AND user_id = ?')
        .run(chatId, m.user_id);
    }
  }

  const msg = {
    id: info.lastInsertRowid, chatId, senderId, type, content,
    mediaPath, mediaName, createdAt: now
  };

  broadcastToChat(chatId, { type: 'message', message: msg }, null);
  return msg;
}

router.post('/:id/messages', authMiddleware, (req, res) => {
  const chatId = req.params.id;
  if (!assertMember(chatId, req.userId)) return res.status(403).json({ error: 'Нет доступа' });
  const { text, sticker } = req.body;
  if (sticker) {
    const msg = insertMessage(chatId, req.userId, 'sticker', sticker, null, null);
    return res.json({ message: msg });
  }
  if (!text || !text.trim()) return res.status(400).json({ error: 'Пустое сообщение' });
  const msg = insertMessage(chatId, req.userId, 'text', text.trim(), null, null);
  res.json({ message: msg });
});

// Post an already-uploaded sticker/gif (from personal library) as a chat message
router.post('/:id/library-message', authMiddleware, (req, res) => {
  const chatId = req.params.id;
  if (!assertMember(chatId, req.userId)) return res.status(403).json({ error: 'Нет доступа' });
  const { mediaPath, kind } = req.body;
  if (!mediaPath) return res.status(400).json({ error: 'mediaPath обязателен' });
  const validKind = kind === 'gif' ? 'gif' : 'image';
  // ensure the path belongs to this user's stickers library for safety
  const owned = db.prepare('SELECT 1 FROM stickers WHERE user_id = ? AND media_path = ?').get(req.userId, mediaPath);
  if (!owned) return res.status(403).json({ error: 'Файл не найден в вашей библиотеке' });
  const msg = insertMessage(chatId, req.userId, validKind, null, mediaPath, null);
  res.json({ message: msg });
});

router.post('/:id/media', authMiddleware, mediaUpload.single('file'), (req, res) => {
  const chatId = req.params.id;
  if (!assertMember(chatId, req.userId)) return res.status(403).json({ error: 'Нет доступа' });
  if (!req.file) return res.status(400).json({ error: 'Файл не получен' });

  const kind = (req.body.kind || 'image'); // image | gif | file
  const relPath = `/uploads/media/${req.file.filename}`;
  const msg = insertMessage(chatId, req.userId, kind, null, relPath, req.file.originalname);
  res.json({ message: msg });
});

router.delete('/:chatId/messages/:msgId', authMiddleware, (req, res) => {
  const { chatId, msgId } = req.params;
  const msg = db.prepare('SELECT * FROM messages WHERE id = ? AND chat_id = ?').get(msgId, chatId);
  if (!msg) return res.status(404).json({ error: 'Сообщение не найдено' });
  if (msg.sender_id !== req.userId) return res.status(403).json({ error: 'Нельзя удалить чужое сообщение' });
  db.prepare('UPDATE messages SET deleted = 1 WHERE id = ?').run(msgId);
  broadcastToChat(chatId, { type: 'message_deleted', chatId: Number(chatId), messageId: Number(msgId) }, null);
  res.json({ ok: true });
});

router.post('/:id/typing', authMiddleware, (req, res) => {
  broadcastToChat(req.params.id, { type: 'typing', chatId: Number(req.params.id), userId: req.userId }, req.userId);
  res.json({ ok: true });
});

// Personal stickers/gifs library
router.get('/library/stickers', authMiddleware, (req, res) => {
  const rows = db.prepare('SELECT * FROM stickers WHERE user_id = ? ORDER BY id DESC').all(req.userId);
  res.json({ stickers: rows.filter(r => r.kind === 'sticker'), gifs: rows.filter(r => r.kind === 'gif') });
});

router.post('/library/stickers', authMiddleware, stickerUpload.single('file'), (req, res) => {
  const kind = req.body.kind === 'gif' ? 'gif' : 'sticker';
  if (!req.file) return res.status(400).json({ error: 'Файл не получен' });
  const relPath = `/uploads/stickers/${req.file.filename}`;
  const now = Date.now();
  const info = db.prepare('INSERT INTO stickers (user_id, kind, media_path, created_at) VALUES (?, ?, ?, ?)')
    .run(req.userId, kind, relPath, now);
  res.json({ id: info.lastInsertRowid, kind, mediaPath: relPath });
});

router.delete('/library/stickers/:id', authMiddleware, (req, res) => {
  db.prepare('DELETE FROM stickers WHERE id = ? AND user_id = ?').run(req.params.id, req.userId);
  res.json({ ok: true });
});

module.exports = router;
