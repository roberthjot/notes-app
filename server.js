const express = require('express');
const path = require('path');
const { marked } = require('marked');
const sanitizeHtml = require('sanitize-html');
const notes = require('./lib/notes');
const { fetchMeta, readPage } = require('./lib/fetch-meta');
const { uploadImage } = require('./lib/upload');
const users = require('./lib/users');

const app = express();

app.use(express.json({ limit: '12mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const COOKIE = 'ns_session';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 7;

function readSession(req) {
  const raw = req.headers.cookie;
  if (!raw) return null;
  const m = String(raw).match(/(?:^|;\s*)ns_session=([^;]+)/);
  return m ? users.verifySession(decodeURIComponent(m[1])) : null;
}

function setSession(req, res, token) {
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  res.setHeader(
    'Set-Cookie',
    `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${COOKIE_MAX_AGE}${secure ? '; Secure' : ''}`
  );
}

function clearSession(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

const wrap = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

const PUBLIC_API = new Set(['/login', '/register', '/logout', '/auth']);

app.use('/api', (req, res, next) => {
  if (PUBLIC_API.has(req.path)) return next();
  if (!readSession(req)) return res.status(401).json({ error: 'No autorizado' });
  next();
});

app.get('/api/auth', (req, res) => {
  const s = readSession(req);
  res.json({ authed: Boolean(s), username: s ? s.u : null });
});

app.post('/api/register', wrap(async (req, res) => {
  const { username, password } = req.body || {};
  const user = await users.register(username, password);
  setSession(req, res, users.signSession(user.username));
  res.status(201).json({ ok: true, username: user.username });
}));

app.post('/api/login', wrap(async (req, res) => {
  const { username, password } = req.body || {};
  const user = await users.login(username, password);
  setSession(req, res, users.signSession(user.username));
  res.json({ ok: true, username: user.username });
}));

app.post('/api/logout', (req, res) => {
  clearSession(res);
  res.json({ ok: true });
});

app.get('/api/notes', wrap(async (req, res) => {
  res.json(await notes.getNotes());
}));

app.get('/api/notes/:id', wrap(async (req, res) => {
  const note = await notes.getNote(req.params.id);
  if (!note) return res.status(404).json({ error: 'Nota no encontrada' });
  res.json(note);
}));

app.post('/api/notes', wrap(async (req, res) => {
  res.status(201).json(await notes.createNote(req.body || {}));
}));

app.put('/api/notes/:id', wrap(async (req, res) => {
  res.json(await notes.updateNote(req.params.id, req.body || {}));
}));

app.delete('/api/notes/:id', wrap(async (req, res) => {
  await notes.deleteNote(req.params.id);
  res.json({ ok: true });
}));

app.get('/api/fetch-meta', wrap(async (req, res) => {
  if (!req.query.url) throw new Error('Falta el parámetro url');
  res.json(await fetchMeta(String(req.query.url)));
}));

app.get('/api/read', wrap(async (req, res) => {
  if (!req.query.url) throw new Error('Falta el parámetro url');
  res.json(await readPage(String(req.query.url)));
}));

app.post('/api/upload', wrap(async (req, res) => {
  const { name, data, mime } = req.body || {};
  if (!data) throw new Error('Falta la imagen');
  res.json(await uploadImage({ name, data, mime }));
}));

app.post('/api/render', (req, res) => {
  const raw = marked.parse(req.body?.content || '', { async: false });
  const html = sanitizeHtml(raw, {
    allowedTags: [
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'a', 'ul', 'ol', 'li',
      'strong', 'em', 'b', 'i', 'blockquote', 'code', 'pre', 'img',
      'br', 'hr', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'span', 'del',
    ],
    allowedAttributes: {
      a: ['href', 'target', 'rel'],
      img: ['src', 'alt', 'title'],
      code: ['class'],
      span: ['class'],
      th: ['align'],
      td: ['align'],
    },
    allowedSchemes: ['http', 'https', 'mailto'],
  });
  res.json({ html });
});

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  notes.init().then(() => {
    app.listen(PORT, () => {
      console.log(`Notas app corriendo en http://localhost:${PORT}`);
    });
  });
}

module.exports = app;