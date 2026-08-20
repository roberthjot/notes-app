const fs = require('fs');
const path = require('path');
const matter = require('gray-matter');

const NOTES_DIR = path.join(__dirname, '..', '..', 'notes');
const INDEX_FILE = path.join(NOTES_DIR, '.index.json');
const USERS_FILE = path.join(NOTES_DIR, 'users.json');

function init() {
  if (!fs.existsSync(NOTES_DIR)) fs.mkdirSync(NOTES_DIR, { recursive: true });
}

function normalizeDate(date) {
  return date || new Date().toISOString().slice(0, 10);
}

function rowToNote(id, data) {
  return {
    id,
    title: data.title || 'Sin título',
    type: data.type || 'idea',
    tags: Array.isArray(data.tags) ? data.tags : [],
    source: data.source || '',
    author: data.author || '',
    date: normalizeDate(data.date),
    status: data.status || 'por-leer',
    fav: Boolean(data.fav),
    content: (data.content || '').trim(),
  };
}

function writeFile(note) {
  const body = matter.stringify(note.content || '', {
    title: note.title,
    type: note.type,
    tags: note.tags || [],
    source: note.source || '',
    author: note.author || '',
    date: note.date || '',
    status: note.status || 'por-leer',
    fav: Boolean(note.fav),
  });
  fs.writeFileSync(path.join(NOTES_DIR, `${note.id}.md`), body, 'utf8');
}

function readFile(id) {
  const file = path.join(NOTES_DIR, `${id}.md`);
  if (!fs.existsSync(file)) return null;
  const { data, content } = matter.read(file);
  return rowToNote(id, { ...data, content });
}

function scan() {
  init();
  const files = fs.readdirSync(NOTES_DIR).filter((f) => f.endsWith('.md'));
  return files
    .map((f) => readFile(f.replace(/\.md$/, '')))
    .filter(Boolean)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.id < b.id ? 1 : -1));
}

async function getAll() {
  if (fs.existsSync(INDEX_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8'));
    } catch {
      /* índice corrupto: reescanear */
    }
  }
  return scan();
}

async function saveAll(notes) {
  init();
  for (const file of fs.readdirSync(NOTES_DIR)) {
    if (file.endsWith('.md')) fs.unlinkSync(path.join(NOTES_DIR, file));
  }
  for (const note of notes) writeFile(note);
  fs.writeFileSync(INDEX_FILE, JSON.stringify(notes, null, 2), 'utf8');
}

async function getById(id) {
  return readFile(id);
}

async function insert(note) {
  init();
  writeFile(note);
  fs.writeFileSync(INDEX_FILE, JSON.stringify(scan(), null, 2), 'utf8');
}

async function update(id, note) {
  writeFile(note);
  fs.writeFileSync(INDEX_FILE, JSON.stringify(scan(), null, 2), 'utf8');
}

async function remove(id) {
  const file = path.join(NOTES_DIR, `${id}.md`);
  if (!fs.existsSync(file)) throw new Error('Nota no encontrada');
  fs.unlinkSync(file);
  fs.writeFileSync(INDEX_FILE, JSON.stringify(scan(), null, 2), 'utf8');
}

function readUsers() {
  if (!fs.existsSync(USERS_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function writeUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf8');
}

async function getUser(username) {
  return readUsers().find((u) => u.username === username) || null;
}

async function createUser(user) {
  const users = readUsers();
  if (users.some((u) => u.username === user.username)) throw new Error('Ese usuario ya existe');
  users.push(user);
  writeUsers(users);
  return user;
}

module.exports = { init, getAll, getById, insert, update, remove, getUser, createUser };