const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'insecure_dev_secret_change_me';
const TOKEN_TTL = '30d';

function signToken(userId, sessionId) {
  return jwt.sign({ uid: userId, sid: sessionId }, JWT_SECRET, { expiresIn: TOKEN_TTL });
}

function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (e) {
    return null;
  }
}

function authMiddleware(req, res, next) {
  const header = req.headers['authorization'] || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : (req.cookies && req.cookies.token);
  if (!token) return res.status(401).json({ error: 'Не авторизован' });
  const payload = verifyToken(token);
  if (!payload) return res.status(401).json({ error: 'Недействительный токен' });
  req.userId = payload.uid;
  req.sessionId = payload.sid;
  next();
}

module.exports = { signToken, verifyToken, authMiddleware, JWT_SECRET };
