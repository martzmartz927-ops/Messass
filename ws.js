const { WebSocketServer } = require('ws');
const { verifyToken } = require('./server_auth');
const db = require('./db_init');

// userId -> Set of ws connections
const clients = new Map();

function addClient(userId, ws) {
  if (!clients.has(userId)) clients.set(userId, new Set());
  clients.get(userId).add(ws);
}
function removeClient(userId, ws) {
  const set = clients.get(userId);
  if (!set) return;
  set.delete(ws);
  if (set.size === 0) clients.delete(userId);
}

function sendToUser(userId, payload) {
  const set = clients.get(userId);
  if (!set) return;
  const data = JSON.stringify(payload);
  for (const ws of set) {
    if (ws.readyState === ws.OPEN) ws.send(data);
  }
}

function broadcastToChat(chatId, payload, exceptUserId) {
  const members = db.prepare('SELECT user_id FROM chat_members WHERE chat_id = ?').all(chatId);
  for (const m of members) {
    if (exceptUserId && m.user_id === exceptUserId) continue;
    sendToUser(m.user_id, payload);
  }
}

function setupWebSocket(server) {
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws, req) => {
    let userId = null;
    try {
      const url = new URL(req.url, 'http://localhost');
      const token = url.searchParams.get('token');
      const payload = verifyToken(token);
      if (!payload) { ws.close(4001, 'unauthorized'); return; }
      userId = payload.uid;
    } catch (e) {
      ws.close(4001, 'unauthorized');
      return;
    }

    addClient(userId, ws);
    db.prepare('UPDATE users SET is_online = 1, last_seen = ? WHERE id = ?').run(Date.now(), userId);
    broadcastPresence(userId, true);

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }

      if (msg.type === 'typing' && msg.chatId) {
        broadcastToChat(msg.chatId, { type: 'typing', chatId: msg.chatId, userId }, userId);
      }
      if (msg.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong' }));
      }
    });

    ws.on('close', () => {
      removeClient(userId, ws);
      if (!clients.has(userId)) {
        db.prepare('UPDATE users SET is_online = 0, last_seen = ? WHERE id = ?').run(Date.now(), userId);
        broadcastPresence(userId, false);
      }
    });
  });

  return wss;
}

function broadcastPresence(userId, online) {
  // notify all chat partners of this user
  const chatIds = db.prepare('SELECT chat_id FROM chat_members WHERE user_id = ?').all(userId).map(r => r.chat_id);
  const notified = new Set();
  for (const chatId of chatIds) {
    const members = db.prepare('SELECT user_id FROM chat_members WHERE chat_id = ?').all(chatId);
    for (const m of members) {
      if (m.user_id === userId || notified.has(m.user_id)) continue;
      notified.add(m.user_id);
      sendToUser(m.user_id, { type: 'presence', userId, online });
    }
  }
}

module.exports = { setupWebSocket, sendToUser, broadcastToChat };
