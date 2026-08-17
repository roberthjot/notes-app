const storage = require('./storage');

const TYPES = ['tweet', 'paper', 'article', 'idea', 'quote', 'video'];
const STATUSES = ['por-leer', 'leyendo', 'leido'];

function slugify(text) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'nota';
}

function safeId(id) {
  if (!/^[a-z0-9-]+$/.test(id)) throw new Error('ID inválido');
  return id;
}

function uniqueId(base, used) {
  let id = base;
  let i = 1;
  while (used.has(id)) {
    id = `${base}-${i}`;
    i++;
  }
  return id;
}

function normalize(data, existing = null) {
  const note = {
    ...(existing || {}),
    title: String(data.title !== undefined ? data.title : existing?.title || '').trim(),
    type: TYPES.includes(data.type) ? data.type : existing?.type || 'idea',
    tags: Array.isArray(data.tags)
      ? data.tags.map((t) => String(t).trim()).filter(Boolean)
      : existing?.tags || [],
    source: String(data.source !== undefined ? data.source : existing?.source || '').trim(),
    author: String(data.author !== undefined ? data.author : existing?.author || '').trim(),
    date: data.date || existing?.date || new Date().toISOString().slice(0, 10),
    status: STATUSES.includes(data.status) ? data.status : existing?.status || 'por-leer',
    content: String(data.content !== undefined ? data.content : existing?.content || '').trim(),
  };
  if (!note.title) throw new Error('El título es obligatorio');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(note.date)) note.date = new Date().toISOString().slice(0, 10);
  return note;
}

async function init() {
  await storage.init();
}

async function getNotes() {
  return storage.getAll();
}

async function getNote(id) {
  safeId(id);
  return storage.getById(id);
}

async function createNote(data) {
  const all = await storage.getAll();
  const base = slugify(data.title || 'nota');
  const id = uniqueId(base, new Set(all.map((n) => n.id)));
  const note = normalize(data);
  await storage.insert({ ...note, id });
  return { ...note, id };
}

async function updateNote(id, data) {
  safeId(id);
  const existing = await storage.getById(id);
  if (!existing) throw new Error('Nota no encontrada');
  const note = normalize(data, existing);
  await storage.update(id, note);
  return note;
}

async function deleteNote(id) {
  safeId(id);
  await storage.remove(id);
  return { ok: true };
}

module.exports = { getNotes, getNote, createNote, updateNote, deleteNote, init, TYPES, STATUSES };