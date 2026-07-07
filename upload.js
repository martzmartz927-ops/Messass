const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, 'uploads');
const AVATARS_DIR = path.join(UPLOADS_DIR, 'avatars');
const MEDIA_DIR = path.join(UPLOADS_DIR, 'media');
const STICKERS_DIR = path.join(UPLOADS_DIR, 'stickers');

[UPLOADS_DIR, AVATARS_DIR, MEDIA_DIR, STICKERS_DIR].forEach(d => fs.mkdirSync(d, { recursive: true }));

const MAX_MB = parseInt(process.env.MAX_UPLOAD_MB || '25', 10);

function makeStorage(dir) {
  return multer.diskStorage({
    destination: (req, file, cb) => cb(null, dir),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname) || '';
      cb(null, `${Date.now()}_${uuidv4()}${ext}`);
    }
  });
}

const avatarUpload = multer({
  storage: makeStorage(AVATARS_DIR),
  limits: { fileSize: MAX_MB * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) return cb(new Error('Только изображения'));
    cb(null, true);
  }
});

const mediaUpload = multer({
  storage: makeStorage(MEDIA_DIR),
  limits: { fileSize: MAX_MB * 1024 * 1024 }
});

const stickerUpload = multer({
  storage: makeStorage(STICKERS_DIR),
  limits: { fileSize: MAX_MB * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) return cb(new Error('Только изображения'));
    cb(null, true);
  }
});

module.exports = {
  UPLOADS_DIR, AVATARS_DIR, MEDIA_DIR, STICKERS_DIR,
  avatarUpload, mediaUpload, stickerUpload
};
