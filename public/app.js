(() => {
  const TYPE_LABELS = {
    tweet: '🐦 Tweet',
    paper: '📄 Paper',
    article: '📰 Artículo',
    idea: '💡 Idea',
    quote: '💬 Cita',
  };
  const TYPE_ORDER = ['tweet', 'paper', 'article', 'idea', 'quote'];
  const STATUS_LABELS = { 'por-leer': '📌 Por leer', leyendo: '⏳ Leyendo', leido: '✅ Leído' };
  const STATUS_SHORT = { 'por-leer': 'Por leer', leyendo: 'Leyendo', leido: 'Leído' };
  const STATUS_ORDER = ['leyendo', 'por-leer', 'leido'];

  const state = {
    notes: [],
    typeFilter: 'all',
    tagFilter: '',
    statusFilter: 'all',
    search: '',
    editingId: null,
    detailId: null,
  };

  const $ = (sel) => document.querySelector(sel);
  const grid = $('#grid');
  const empty = $('#empty');
  const modal = $('#modal');
  const detail = $('#detail');
  const reader = $('#reader');
  const statusFilters = $('#status-filters');
  const typeFilters = $('#type-filters');
  const tagFilters = $('#tag-filters');

  function escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function escapeAttr(str) {
    return escapeHtml(str).replace(/'/g, '&#39;');
  }

  const stripMarkdown = (md) =>
    md
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/`([^`]*)`/g, '$1')
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/^#{1,6}\s+/gm, '')
      .replace(/[*_>~#-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

  async function api(path, opts = {}) {
    const res = await fetch(path, {
      headers: { 'Content-Type': 'application/json' },
      ...opts,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Error del servidor');
    return data;
  }

  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.classList.add('hidden'), 2400);
  }

  /* ---------- Filtros ---------- */
  function renderStatusFilters() {
    const counts = { all: state.notes.length, 'por-leer': 0, leyendo: 0, leido: 0 };
    for (const n of state.notes) counts[n.status || 'por-leer']++;
    const tabs = [
      { k: 'all', label: `Todo` },
      ...STATUS_ORDER.map((s) => ({ k: s, label: STATUS_LABELS[s] })),
    ];
    statusFilters.innerHTML = tabs
      .map(
        ({ k, label }) =>
          `<button class="chip ${state.statusFilter === k ? 'active' : ''}" data-status="${k}">${label} <span class="chip-count">${counts[k]}</span></button>`
      )
      .join('');
    statusFilters.querySelectorAll('.chip').forEach((c) =>
      c.addEventListener('click', () => {
        state.statusFilter = c.dataset.status;
        renderStatusFilters();
        renderGrid();
      })
    );
  }

  function renderTypeFilters() {
    const all = ['all', ...TYPE_ORDER];
    typeFilters.innerHTML = all
      .map(
        (t) =>
          `<button class="chip ${state.typeFilter === t ? 'active' : ''}" data-type="${t}">${
            t === 'all' ? 'Todos' : TYPE_LABELS[t]
          }</button>`
      )
      .join('');
    typeFilters.querySelectorAll('.chip').forEach((c) =>
      c.addEventListener('click', () => {
        state.typeFilter = c.dataset.type;
        renderTypeFilters();
        renderGrid();
      })
    );
  }

  function renderTagFilters() {
    const tags = [...new Set(state.notes.flatMap((n) => n.tags))].sort();
    if (!tags.length) {
      tagFilters.classList.add('hidden');
      return;
    }
    tagFilters.classList.remove('hidden');
    tagFilters.innerHTML =
      `<span class="chip ${state.tagFilter === '' ? 'active' : ''}" data-tag=""># todos</span>` +
      tags
        .map(
          (t) =>
            `<span class="chip ${state.tagFilter === t ? 'active' : ''}" data-tag="${t}">#${t}</span>`
        )
        .join('');
    tagFilters.querySelectorAll('.chip').forEach((c) =>
      c.addEventListener('click', () => {
        state.tagFilter = c.dataset.tag;
        renderTagFilters();
        renderGrid();
      })
    );
  }

  /* ---------- Grid ---------- */
  function filtered() {
    const q = state.search.toLowerCase();
    return state.notes.filter((n) => {
      if (state.typeFilter !== 'all' && n.type !== state.typeFilter) return false;
      if (state.statusFilter !== 'all' && (n.status || 'por-leer') !== state.statusFilter) return false;
      if (state.tagFilter && !n.tags.includes(state.tagFilter)) return false;
      if (q) {
        const hay = `${n.title} ${n.content} ${n.author} ${n.tags.join(' ')}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }

  function statusOf(n) {
    return n.status || 'por-leer';
  }

  function cardHtml(n) {
    const excerpt = stripMarkdown(n.content).slice(0, 180);
    const tags = n.tags
      .slice(0, 3)
      .map((t) => `<span class="tag">#${escapeHtml(t)}</span>`)
      .join('');
    const st = statusOf(n);
    return `
      <article class="card" data-id="${n.id}">
        <div class="card-top">
          <span class="type-badge type-${n.type}">${TYPE_LABELS[n.type]}</span>
          <span class="status-chip status-${st}">${STATUS_SHORT[st]}</span>
        </div>
        <h3 class="card-title">${escapeHtml(n.title)}</h3>
        ${excerpt ? `<p class="card-excerpt">${escapeHtml(excerpt)}</p>` : ''}
        <div class="card-meta">
          ${tags}
          <span class="card-actions">
            ${
              n.source
                ? `<button class="act" data-read="${escapeAttr(n.source)}" title="Leer en la app">📖</button>
                   <a class="act" href="${escapeAttr(n.source)}" target="_blank" rel="noopener" title="Fuente oficial">🔗</a>`
                : ''
            }
            ${
              st !== 'leido'
                ? `<button class="act act-mark" data-mark="${n.id}" title="Marcar como leído">✔</button>`
                : ''
            }
          </span>
        </div>
      </article>`;
  }

  function renderGrid() {
    const list = filtered();
    empty.classList.toggle('hidden', list.length > 0);
    if (state.statusFilter === 'all') {
      let html = '';
      for (const s of STATUS_ORDER) {
        const items = list.filter((n) => statusOf(n) === s);
        if (!items.length) continue;
        html += `
          <section class="group">
            <h2 class="group-title">${STATUS_SHORT[s]} <span class="group-count">${items.length}</span></h2>
            <div class="grid">${items.map(cardHtml).join('')}</div>
          </section>`;
      }
      grid.innerHTML = html;
    } else {
      grid.innerHTML = list.map(cardHtml).join('');
    }
  }

  /* ---------- Editor ---------- */
  function today() {
    return new Date().toISOString().slice(0, 10);
  }

  function openEditor(note = null) {
    state.editingId = note ? note.id : null;
    $('#modal-title').textContent = note ? 'Editar nota' : 'Nueva nota';
    $('#f-title').value = note ? note.title : '';
    $('#f-type').value = note ? note.type : 'idea';
    $('#f-source').value = note ? note.source : '';
    $('#f-author').value = note ? note.author : '';
    $('#f-date').value = note ? note.date : today();
    $('#f-tags').value = note ? note.tags.join(', ') : '';
    $('#f-status').value = note ? note.status || 'por-leer' : 'por-leer';
    $('#f-content').value = note ? note.content : '';
    $('#form-error').textContent = '';
    const status = $('#import-status');
    status.textContent = '';
    status.className = 'import-status';
    detail.classList.add('hidden');
    modal.classList.remove('hidden');
    $('#f-title').focus();
  }

  function closeEditor() {
    modal.classList.add('hidden');
  }

  async function handleImport() {
    const url = $('#f-source').value.trim();
    const status = $('#import-status');
    const btn = $('#btn-import');
    if (!url) {
      status.textContent = 'Ingresa una URL primero';
      status.className = 'import-status err';
      return;
    }
    btn.disabled = true;
    status.textContent = 'Obteniendo metadatos…';
    status.className = 'import-status';
    try {
      const meta = await api(`/api/fetch-meta?url=${encodeURIComponent(url)}`);
      if (meta.title) $('#f-title').value = meta.title;
      if (meta.author) $('#f-author').value = meta.author;
      if (meta.type && TYPE_LABELS[meta.type]) $('#f-type').value = meta.type;
      $('#f-source').value = meta.url || url;
      if (meta.date) $('#f-date').value = meta.date;
      if (meta.summary && !$('#f-content').value.trim()) {
        $('#f-content').value = `> ${meta.summary}`;
      }
      status.textContent = '✓ Metadatos importados';
      status.className = 'import-status ok';
    } catch (err) {
      status.textContent = `No se pudieron obtener: ${err.message}`;
      status.className = 'import-status err';
    } finally {
      btn.disabled = false;
    }
  }

  function collectForm() {
    return {
      title: $('#f-title').value.trim(),
      type: $('#f-type').value,
      source: $('#f-source').value.trim(),
      author: $('#f-author').value.trim(),
      date: $('#f-date').value || today(),
      tags: $('#f-tags').value.split(',').map((t) => t.trim()).filter(Boolean),
      status: $('#f-status').value,
      content: $('#f-content').value,
    };
  }

  async function saveNote(e) {
    e.preventDefault();
    const data = collectForm();
    if (!data.title) {
      $('#form-error').textContent = 'El título es obligatorio';
      return;
    }
    try {
      if (state.editingId) {
        await api(`/api/notes/${state.editingId}`, {
          method: 'PUT',
          body: JSON.stringify(data),
        });
        toast('Nota actualizada');
      } else {
        await api('/api/notes', {
          method: 'POST',
          body: JSON.stringify(data),
        });
        toast('Nota guardada');
      }
      closeEditor();
      await refresh();
    } catch (err) {
      $('#form-error').textContent = err.message;
    }
  }

  /* ---------- Detalle ---------- */
  async function openDetail(id) {
    try {
      state.detailId = id;
      const note = await api(`/api/notes/${id}`);
      const rendered = await api('/api/render', {
        method: 'POST',
        body: JSON.stringify({ content: note.content }),
      });
      const tags = note.tags.map((t) => `<span class="tag">#${escapeHtml(t)}</span>`).join('');
      const links = note.source
        ? `<div class="detail-sub" style="margin-bottom:0">
            <a class="link" data-read="${escapeAttr(note.source)}">📄 Abrir</a>
            · <a class="link" href="${escapeAttr(note.source)}" target="_blank" rel="noopener">🔗 fuente oficial</a>
            · <a class="link" href="https://t.me/iv?url=${encodeURIComponent(note.source)}" target="_blank" rel="noopener">⚡ vía Telegram</a>
          </div>`
        : '';
      $('#detail-badge').textContent = TYPE_LABELS[note.type];
      $('#detail-badge').className = `type-badge type-${note.type}`;
      $('#btn-read').style.display = note.source ? '' : 'none';
      const statusSet = `
        <div class="status-set">
          ${STATUS_ORDER.map(
            (s) =>
              `<button class="chip status-opt ${statusOf(note) === s ? 'active' : ''}" data-set-status="${s}">${STATUS_SHORT[s]}</button>`
          ).join('')}
        </div>`;
      $('#detail-body').innerHTML = `
        <h2 class="detail-title">${escapeHtml(note.title)}</h2>
        <div class="detail-sub">
          ${note.date}
          ${note.author ? ` · ${escapeHtml(note.author)}` : ''}
        </div>
        ${statusSet}
        ${links}
        <div class="detail-tags">${tags}</div>
        <div class="md-body">${rendered.html}</div>`;
      detail.classList.remove('hidden');
      $('#detail-body').querySelectorAll('[data-set-status]').forEach((b) =>
        b.addEventListener('click', () => setStatus(state.detailId, b.dataset.setStatus))
      );
    } catch (err) {
      toast(err.message);
    }
  }

  function closeDetail() {
    detail.classList.add('hidden');
    state.detailId = null;
  }

  async function deleteNote(id) {
    if (!confirm('¿Eliminar esta nota?')) return;
    try {
      await api(`/api/notes/${id}`, { method: 'DELETE' });
      toast('Nota eliminada');
      closeDetail();
      await refresh();
    } catch (err) {
      toast(err.message);
    }
  }

  async function setStatus(id, status) {
    try {
      await api(`/api/notes/${id}`, { method: 'PUT', body: JSON.stringify({ status }) });
      toast(`Marcada: ${STATUS_LABELS[status]}`);
      await refresh();
      if (state.detailId === id) openDetail(id);
    } catch (err) {
      toast(err.message);
    }
  }

  /* ---------- Lector ---------- */
  async function openReader(url) {
    reader.classList.remove('hidden');
    $('#reader-title').textContent = 'Leyendo…';
    $('#reader-original').href = `https://scholar.google.com/scholar?q=${encodeURIComponent(url)}`;
    $('#reader-body').innerHTML = '<p class="reader-loading">Cargando contenido…</p>';
    closeDetail();
    try {
      const page = await api(`/api/read?url=${encodeURIComponent(url)}`);
      $('#reader-title').textContent = page.title || 'Sin título';
      const meta = [
        page.date ? escapeHtml(page.date) : '',
        page.author ? escapeHtml(page.author) : '',
      ].filter(Boolean).join(' · ');
      const rendered = await api('/api/render', {
        method: 'POST',
        body: JSON.stringify({ content: page.content }),
      });
      $('#reader-body').innerHTML = `
        <div class="detail-sub" style="margin-bottom:10px">
          <a class="link" href="${escapeAttr(page.url)}" target="_blank" rel="noopener">🔗 fuente oficial ↗</a>
          <span style="margin:0 6px;opacity:.4">·</span>
          <a class="link" href="https://t.me/iv?url=${encodeURIComponent(page.url)}" target="_blank" rel="noopener">⚡ abrir vía Telegram ↗</a>
        </div>
        ${meta ? `<div class="detail-sub">${meta}</div>` : ''}
        ${page.oaPdf ? `<div style="margin-bottom:14px"><a class="btn btn-primary" target="_blank" rel="noopener" href="${escapeAttr(page.oaPdf)}">📄 PDF abierto del artículo</a></div>` : ''}
        <div class="md-body">${rendered.html}</div>`;
    } catch (err) {
      $('#reader-body').innerHTML = `
        <p class="reader-loading">${escapeHtml(err.message)}</p>
        <div style="text-align:center;margin-top:18px;display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
          <a class="btn btn-ghost" target="_blank" rel="noopener" href="https://t.me/iv?url=${encodeURIComponent(url)}">⚡ Abrir vía Telegram</a>
          <a class="btn btn-primary" target="_blank" rel="noopener" href="https://scholar.google.com/scholar?q=${encodeURIComponent(url)}">🔍 Buscar en Google Scholar</a>
          <a class="btn btn-ghost" target="_blank" rel="noopener" href="https://www.google.com/search?q=${encodeURIComponent(url)}">🔎 Google</a>
        </div>
        <p class="reader-loading" style="margin-top:14px;font-size:12.5px">Si el enlace se abre en Telegram pero no aquí, el sitio bloquea tu navegador (anti-bot). Prueba en incógnito o desactivando extensiones.</p>`;
    }
  }

  function closeReader() {
    reader.classList.add('hidden');
  }

  /* ---------- Carga ---------- */
  async function refresh() {
    state.notes = await api('/api/notes');
    renderStatusFilters();
    renderTypeFilters();
    renderTagFilters();
    renderGrid();
  }

  async function init() {
    await refresh();
  }

  /* ---------- Eventos ---------- */
  $('#btn-new').addEventListener('click', () => openEditor());
  $('#btn-empty-new').addEventListener('click', () => openEditor());
  $('#modal-close').addEventListener('click', closeEditor);
  $('#btn-cancel').addEventListener('click', closeEditor);
  $('#note-form').addEventListener('submit', saveNote);
  $('#btn-import').addEventListener('click', handleImport);
  $('#detail-close').addEventListener('click', closeDetail);
  $('#btn-read').addEventListener('click', () => {
    const note = state.notes.find((n) => n.id === state.detailId);
    if (note && note.source) openReader(note.source);
  });
  $('#reader-close').addEventListener('click', closeReader);
  document.addEventListener('click', (e) => {
    const readEl = e.target.closest('[data-read]');
    if (readEl) {
      e.preventDefault();
      openReader(readEl.dataset.read);
      return;
    }
    const markEl = e.target.closest('[data-mark]');
    if (markEl) {
      setStatus(markEl.dataset.mark, 'leido');
      return;
    }
    const card = e.target.closest('.card');
    if (card && !e.target.closest('a') && !e.target.closest('[data-read]') && !e.target.closest('[data-mark]')) {
      openDetail(card.dataset.id);
    }
  });
  $('#btn-edit').addEventListener('click', () => {
    const note = state.notes.find((n) => n.id === state.detailId);
    if (note) openEditor(note);
  });
  $('#btn-delete').addEventListener('click', () => {
    if (state.detailId) deleteNote(state.detailId);
  });
  $('#search').addEventListener('input', (e) => {
    state.search = e.target.value;
    renderGrid();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!reader.classList.contains('hidden')) return closeReader();
      if (!modal.classList.contains('hidden')) closeEditor();
      if (!detail.classList.contains('hidden')) closeDetail();
    }
  });
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeEditor();
  });
  detail.addEventListener('click', (e) => {
    if (e.target === detail) closeDetail();
  });
  reader.addEventListener('click', (e) => {
    if (e.target === reader) closeReader();
  });

  init().catch((err) => toast(err.message));
})();