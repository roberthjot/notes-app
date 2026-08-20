const { Pool } = require('pg');

const CONN = process.env.POSTGRES_URL || process.env.DATABASE_URL;

let pool;
let initPromise;

function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: CONN,
      ssl: { rejectUnauthorized: false },
      max: 1,
      idleTimeoutMillis: 0,
      connectionTimeoutMillis: 8000,
    });
  }
  return pool;
}

function ensureInit() {
  if (!initPromise) {
    initPromise = getPool().query(`
      CREATE TABLE IF NOT EXISTS notes (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        type TEXT NOT NULL,
        tags TEXT[] NOT NULL DEFAULT '{}',
        source TEXT NOT NULL DEFAULT '',
        author TEXT NOT NULL DEFAULT '',
        date TEXT NOT NULL,
        content TEXT NOT NULL DEFAULT ''
      )
    `).then(() => getPool().query(
      `ALTER TABLE notes ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'por-leer'`
    )).then(() => getPool().query(
      `ALTER TABLE notes ADD COLUMN IF NOT EXISTS fav BOOLEAN NOT NULL DEFAULT false`
    )).then(() => getPool().query(
      `CREATE TABLE IF NOT EXISTS users (
        username TEXT PRIMARY KEY,
        password_hash TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`
    )).then(() => true);
  }
  return initPromise;
}

function rowToNote(r) {
  return {
    id: r.id,
    title: r.title,
    type: r.type,
    tags: r.tags || [],
    source: r.source || '',
    author: r.author || '',
    date: r.date,
    status: r.status || 'por-leer',
    fav: Boolean(r.fav),
    content: r.content || '',
  };
}

async function init() {
  await ensureInit();
}

async function getAll() {
  await ensureInit();
  const { rows } = await getPool().query('SELECT * FROM notes ORDER BY date DESC, id DESC');
  return rows.map(rowToNote);
}

async function getById(id) {
  await ensureInit();
  const { rows } = await getPool().query('SELECT * FROM notes WHERE id = $1', [id]);
  return rows.length ? rowToNote(rows[0]) : null;
}

async function insert(note) {
  await ensureInit();
  await getPool().query(
    `INSERT INTO notes (id, title, type, tags, source, author, date, status, fav, content)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [note.id, note.title, note.type, note.tags, note.source, note.author, note.date, note.status, note.fav, note.content]
  );
}

async function update(id, note) {
  await ensureInit();
  await getPool().query(
    `UPDATE notes SET title = $2, type = $3, tags = $4, source = $5, author = $6, date = $7, status = $8, fav = $9, content = $10
     WHERE id = $1`,
    [id, note.title, note.type, note.tags, note.source, note.author, note.date, note.status, note.fav, note.content]
  );
}

async function remove(id) {
  await ensureInit();
  const { rowCount } = await getPool().query('DELETE FROM notes WHERE id = $1', [id]);
  if (!rowCount) throw new Error('Nota no encontrada');
}

async function getUser(username) {
  await ensureInit();
  const { rows } = await getPool().query('SELECT * FROM users WHERE username = $1', [username]);
  return rows.length ? rows[0] : null;
}

async function createUser(user) {
  await ensureInit();
  try {
    await getPool().query(
      'INSERT INTO users (username, password_hash, created_at) VALUES ($1, $2, $3)',
      [user.username, user.password_hash, user.created_at]
    );
  } catch (err) {
    if (err.code === '23505') throw new Error('Ese usuario ya existe');
    throw err;
  }
  return user;
}

module.exports = { init, getAll, getById, insert, update, remove, getUser, createUser, usesPg: true };