const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'nexo.sqlite3');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  login TEXT UNIQUE NOT NULL,
  username TEXT UNIQUE NOT NULL,
  nickname TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  bio TEXT DEFAULT '',
  avatar_path TEXT DEFAULT NULL,
  created_at INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  is_online INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS settings (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  theme TEXT DEFAULT 'dark',
  accent_color TEXT DEFAULT '#5b8cff',
  notif_messages INTEGER DEFAULT 1,
  notif_sound INTEGER DEFAULT 1,
  notif_preview INTEGER DEFAULT 1,
  privacy_last_seen TEXT DEFAULT 'everyone',
  privacy_avatar TEXT DEFAULT 'everyone',
  privacy_add_by_username TEXT DEFAULT 'everyone',
  chat_wallpaper TEXT DEFAULT NULL,
  chat_font_size INTEGER DEFAULT 15,
  chat_enter_to_send INTEGER DEFAULT 1,
  data_autodownload_photos INTEGER DEFAULT 1,
  data_autodownload_files INTEGER DEFAULT 0,
  language TEXT DEFAULT 'ru',
  read_receipts INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS contacts (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  contact_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, contact_id)
);

CREATE TABLE IF NOT EXISTS chats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  is_group INTEGER NOT NULL DEFAULT 0,
  title TEXT DEFAULT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS chat_members (
  chat_id INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pinned INTEGER DEFAULT 0,
  unread_count INTEGER DEFAULT 0,
  last_read_message_id INTEGER DEFAULT 0,
  PRIMARY KEY (chat_id, user_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL DEFAULT 'text', -- text | image | sticker | gif | file
  content TEXT DEFAULT NULL,          -- text content or sticker emoji
  media_path TEXT DEFAULT NULL,       -- path for image/gif/file
  media_name TEXT DEFAULT NULL,
  created_at INTEGER NOT NULL,
  edited_at INTEGER DEFAULT NULL,
  deleted INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS stickers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL, -- sticker | gif
  media_path TEXT DEFAULT NULL,
  emoji TEXT DEFAULT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_agent TEXT DEFAULT '',
  created_at INTEGER NOT NULL,
  last_active INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id, created_at);
CREATE INDEX IF NOT EXISTS idx_chat_members_user ON chat_members(user_id);
`);

module.exports = db;
