const crypto = require('crypto');
const storage = require('./storage');

const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-secret-change-me';
const SESSION_TTL = 7 * 24 * 60 * 60 * 1000;
const USERNAME_RE = /^[a-zA-Z0-9_.-]{3,30}$/;

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const candidate = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
}

async function register(username, password) {
  username = String(username || '').trim();
  password = String(password || '');
  if (!USERNAME_RE.test(username)) {
    throw new Error('Usuario: 3-30 caracteres (letras, números, . _ -)');
  }
  if (password.length < 6) throw new Error('La contraseña debe tener al menos 6 caracteres');
  const existing = await storage.getUser(username);
  if (existing) throw new Error('Ese usuario ya existe');
  const user = {
    username,
    password_hash: hashPassword(password),
    created_at: new Date().toISOString(),
  };
  await storage.createUser(user);
  return { username: user.username };
}

const attempts = new Map();

async function login(username, password) {
  username = String(username || '').trim();
  password = String(password || '');
  const rec = attempts.get(username);
  if (rec && rec.count >= 5 && Date.now() - rec.last < 15 * 60 * 1000) {
    throw new Error('Demasiados intentos. Espera 15 minutos');
  }
  const user = await storage.getUser(username);
  const ok = Boolean(user) && verifyPassword(password, user.password_hash);
  if (!ok) {
    attempts.set(username, { count: (rec?.count || 0) + 1, last: Date.now() });
    throw new Error('Usuario o contraseña incorrectos');
  }
  attempts.delete(username);
  return { username: user.username };
}

function signSession(username) {
  const payload = { u: username, exp: Date.now() + SESSION_TTL };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verifySession(token) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(body).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

module.exports = { register, login, signSession, verifySession };