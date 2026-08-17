const cheerio = require('cheerio');

const TIMEOUT_MS = 12000;

const MONTHS = {
  january: '01', february: '02', march: '03', april: '04', may: '05', june: '06',
  july: '07', august: '08', september: '09', october: '10', november: '11', december: '12',
};
const MONTHS_SHORT = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};

async function fetchText(url, headers = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'user-agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'accept-language': 'en,es;q=0.8',
        ...headers,
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const type = res.headers.get('content-type') || '';
    if (!/html|xml|json|text/.test(type)) throw new Error('Contenido no textual');
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

function parseDate(text) {
  const s = (text || '').trim();
  const long = s.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (long && MONTHS[long[1].toLowerCase()]) {
    const mm = MONTHS[long[1].toLowerCase()];
    const dd = String(long[2]).padStart(2, '0');
    return `${long[3]}-${mm}-${dd}`;
  }
  const rfc = s.match(/\b(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})\b/);
  if (rfc && MONTHS_SHORT[rfc[2].toLowerCase()]) {
    const mm = MONTHS_SHORT[rfc[2].toLowerCase()];
    const dd = String(rfc[1]).padStart(2, '0');
    return `${rfc[3]}-${mm}-${dd}`;
  }
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  return '';
}

function truncate(str, n) {
  const s = str || '';
  return s.length > n ? `${s.slice(0, n).trimEnd()}…` : s;
}

function looksBlocked(text) {
  const s = (text || '').toLowerCase();
  return [
    'there was a problem providing the content',
    'reference number',
    'access denied',
    'just a moment',
    'checking your browser',
    'recaptcha',
    'verify you are human',
    'attention required',
    'enable javascript and cookies to continue',
    'please enable js',
    'your request has been blocked',
    'we are sorry',
    'no se pudo cargar',
  ].some((m) => s.includes(m));
}

function bodyToSummary(body) {
  return body
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/[*_>`#|-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 400);
}

function blockedText(title, body) {
  return looksBlocked(`${title || ''} ${(body || '').slice(0, 3000)}`);
}

/* ---------- Jina AI Reader: lee páginas bloqueadas/JS-only ---------- */
function parseJina(text) {
  const lines = text.split(/\r?\n/);
  const get = (label) => {
    const re = new RegExp(`^${label}:\\s*(.*)$`);
    for (const line of lines) {
      const m = line.match(re);
      if (m) return m[1].trim();
    }
    return '';
  };
  const title = get('Title');
  const author = get('Author');
  const date = parseDate(get('Published Time'));
  const idx = text.indexOf('Markdown Content:');
  let body = '';
  if (idx >= 0) {
    body = text.slice(idx + 'Markdown Content:'.length);
  } else {
    const keys = /^(Title|URL Source|Published Time|Author|Markdown Content):/;
    const start = lines.findIndex((l, i) => i > 0 && l.trim() !== '' && !keys.test(l));
    body = start >= 0 ? lines.slice(start).join('\n') : '';
  }
  return { title, author, date, body: body.trim() };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchViaJina(url) {
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(`https://r.jina.ai/${encodeURIComponent(url)}`, {
        signal: controller.signal,
        headers: {
          'user-agent': 'Mozilla/5.0 Chrome/124.0',
          accept: 'text/plain,text/markdown,*/*;q=0.9',
        },
      });
      if (!res.ok) throw new Error(`Jina HTTP ${res.status}`);
      return parseJina(await res.text());
    } catch (err) {
      lastErr = err.message;
      if (attempt === 0) await sleep(900);
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(lastErr || 'Jina sin respuesta');
}

function parseArxivId(url) {
  const m = url.match(/arxiv\.org\/(?:abs|pdf)\/([^/?#]+)/);
  if (!m) return null;
  const id = m[1].replace(/\.pdf$/, '');
  if (!/^\d{4}\.\d{4,5}(v\d+)?$/.test(id)) return null;
  return id;
}

async function fetchArxiv(url) {
  const id = parseArxivId(url);
  const raw = id || url.match(/arxiv\.org\/(?:abs|pdf)\/([^/?#]+)/)?.[1];
  if (!raw) return null;
  const apiUrl = `https://export.arxiv.org/api/query?id_list=${encodeURIComponent(raw)}`;
  const xml = await fetchText(apiUrl, { accept: 'application/atom+xml' });
  const $ = cheerio.load(xml, { xmlMode: true });
  const entry = $('entry').first();
  if (!entry.length) return null;
  const title = entry.find('title').first().text().replace(/\s+/g, ' ').trim();
  const summary = entry.find('summary').first().text().replace(/\s+/g, ' ').trim();
  const authors = [...entry.find('author name')].map((a) =>
    $(a).text().replace(/\s+/g, ' ').trim()
  );
  const pub = entry.find('published').first().text().slice(0, 10);
  return {
    type: 'paper',
    title,
    author: authors.join(', '),
    summary,
    url: `https://arxiv.org/abs/${raw}`,
    date: pub,
  };
}

async function fetchTwitter(url) {
  const m =
    url.match(/twitter\.com\/[^/]+\/status\/(\d+)/) ||
    url.match(/x\.com\/[^/]+\/status\/(\d+)/);
  if (!m) return null;
  const oembedUrl = `https://publish.twitter.com/oembed?url=${encodeURIComponent(url)}`;
  const data = JSON.parse(await fetchText(oembedUrl, { accept: 'application/json' }));
  const $ = cheerio.load(data.html || '');
  const tweetText = $('p').first().text().replace(/\s+/g, ' ').trim();
  const dateStr = parseDate($('blockquote a').last().text());
  const authorName = (data.author_name || '').trim();
  const title = tweetText
    ? `${authorName ? `${authorName}: ` : ''}${truncate(tweetText, 70)}`
    : authorName || 'Tweet';
  return {
    type: 'tweet',
    title,
    author: authorName,
    summary: tweetText,
    url: data.url || url,
    date: dateStr,
  };
}

async function fetchCrossrefByPii(url) {
  const m = url.match(/sciencedirect\.com\/science\/article\/(?:abs\/|pii\/)?pii\/([A-Za-z0-9]+)/);
  if (!m) return null;
  const pii = m[1];
  const issnRaw = pii.slice(1, 9);
  if (!/^\d{8}$/.test(issnRaw)) return null;
  const issn = `${issnRaw.slice(0, 4)}-${issnRaw.slice(4)}`;
  try {
    const r = await fetch(
      `https://api.crossref.org/works?query=${encodeURIComponent(pii)}&filter=issn:${issn}&rows=1`,
      { headers: { 'user-agent': 'Mozilla/5.0 Chrome/124.0' } }
    );
    if (!r.ok) return null;
    const j = await r.json();
    const item = (j.message && j.message.items && j.message.items[0]) || null;
    if (!item || !item.title || !item.title[0]) return null;

    const authors = (item.author || [])
      .map((a) => [a.given, a.family].filter(Boolean).join(' '))
      .join(', ');

    let abstract = item.abstract ? item.abstract.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : '';
    const doi = item.DOI || '';
    let oaPdf = '';

    if (!abstract && doi) {
      try {
        const oa = await fetch(`https://api.openalex.org/works/https://doi.org/${encodeURIComponent(doi)}`, {
          headers: { 'user-agent': 'Mozilla/5.0 Chrome/124.0' },
        });
        const oaJson = await oa.json();
        const inv = oaJson.abstract_inverted_index;
        if (inv) {
          const words = [];
          for (const [w, pos] of Object.entries(inv)) for (const p of pos) words[p] = w;
          abstract = words.join(' ').trim();
        }
      } catch {
        /* sin abstract de OpenAlex */
      }
    }

    if (doi) {
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          const s2 = await fetch(
            `https://api.semanticscholar.org/graph/v1/paper/DOI:${encodeURIComponent(doi)}?fields=abstract,openAccessPdf`,
            { headers: { 'user-agent': 'Mozilla/5.0 Chrome/124.0' } }
          );
          if (s2.status === 429) {
            await sleep(2500);
            continue;
          }
          if (s2.ok) {
            const s2j = await s2.json();
            if (!abstract && s2j.abstract) abstract = s2j.abstract;
            if (!oaPdf && s2j.openAccessPdf && s2j.openAccessPdf.url) oaPdf = s2j.openAccessPdf.url;
          }
          break;
        } catch {
          break;
        }
      }
    }

    if (!oaPdf && doi) {
      try {
        const up = await fetch(
          `https://api.unpaywall.org/v2/${encodeURIComponent(doi)}?email=notas@app.local`,
          { headers: { 'user-agent': 'Mozilla/5.0 Chrome/124.0' } }
        );
        if (up.ok) {
          const upj = await up.json();
          const bo = upj.best_oa_location;
          if (bo && (bo.url_for_pdf || bo.url)) oaPdf = bo.url_for_pdf || bo.url;
        }
      } catch {
        /* Unpaywall sin respuesta */
      }
    }

    const dp = (item.issued && item.issued['date-parts'] && item.issued['date-parts'][0]) || [];
    let date = '';
    if (dp[0]) {
      date = `${dp[0]}-${String(dp[1] || 1).padStart(2, '0')}-${String(dp[2] || 1).padStart(2, '0')}`;
    }

    return {
      type: 'article',
      title: item.title[0].replace(/\s+/g, ' ').trim() || 'Sin título',
      author: authors,
      summary: abstract,
      date,
      url,
      doi,
      journal: (item['container-title'] && item['container-title'][0]) || '',
      oaPdf,
    };
  } catch {
    return null;
  }
}

function buildCrossrefContent(meta) {
  const parts = [];
  if (meta.journal) parts.push(`*Revista:* ${meta.journal}`);
  if (meta.date) parts.push(`*Fecha:* ${meta.date}`);
  if (meta.author) parts.push(`*Autores:* ${meta.author}`);
  if (meta.doi) parts.push(`*DOI:* https://doi.org/${meta.doi}`);
  if (meta.oaPdf) parts.push(`*PDF abierto:* [${meta.oaPdf}](${meta.oaPdf})`);
  if (meta.summary) parts.push(`**Resumen (fuente oficial):**\n\n${meta.summary}`);
  return parts.join('\n\n');
}

async function fetchGeneric(url) {
  let html = null;
  let directErr = '';
  try {
    html = await fetchText(url);
  } catch (err) {
    directErr = err.message;
  }

  let $ = null;
  if (html) {
    $ = cheerio.load(html);
    const titleTxt = $('title').first().text();
    const bodyTxt = $('body').first().text().slice(0, 600);
    if (looksBlocked(`${titleTxt} ${bodyTxt}`)) {
      html = null;
      $ = null;
      directErr = 'la página devolvió una página de bloqueo';
    }
  }

  if (!html) {
    try {
      const jina = await fetchViaJina(url);
      if (blockedText(jina.title, jina.body)) {
        throw new Error('el lector devolvió una página de bloqueo');
      }
      return {
        type: 'article',
        title: jina.title || 'Sin título',
        author: jina.author || '',
        summary: bodyToSummary(jina.body),
        date: jina.date || '',
        url,
      };
    } catch (jErr) {
      if (/sciencedirect\.com/i.test(url)) {
        const cr = await fetchCrossrefByPii(url);
        if (cr && cr.title) return cr;
      }
      throw new Error(
        `No se pudo leer la página (${directErr || 'bloqueada'} · ${jErr.message}). Pega el contenido manualmente.`
      );
    }
  }

  const metaContent = (selectors) => {
    for (const sel of selectors) {
      const el = $(sel).first();
      const v = (el.attr('content') || '').trim();
      if (v) return v;
    }
    return '';
  };

  let title =
    metaContent(['meta[property="og:title"]', 'meta[name="twitter:title"]']) ||
    $('title').first().text().trim();
  title = title.replace(/\s+/g, ' ');

  let description =
    metaContent([
      'meta[property="og:description"]',
      'meta[name="twitter:description"]',
      'meta[name="description"]',
    ]) || '';
  description = description.replace(/\s+/g, ' ');

  let author =
    metaContent(['meta[property="og:site_name"]', 'meta[name="author"]', 'meta[property="article:author"]']) ||
    '';
  author = author.replace(/\s+/g, ' ');

  let date =
    metaContent([
      'meta[property="article:published_time"]',
      'meta[property="og:published_time"]',
      'meta[name="date"]',
      'meta[name="publishdate"]',
    ]) || '';

  const jsonLd = $('script[type="application/ld+json"]').first().text();
  if (jsonLd) {
    try {
      const parsed = JSON.parse(jsonLd);
      const find = (node, key) => {
        if (!node || typeof node !== 'object') return '';
        if (Array.isArray(node)) {
          for (const item of node) {
            const v = find(item, key);
            if (v) return v;
          }
          return '';
        }
        if (node[key]) return String(node[key]);
        for (const k of Object.keys(node)) {
          const v = find(node[k], key);
          if (v) return v;
        }
        return '';
      };
      if (!title) title = find(parsed, 'headline');
      if (!author) {
        const a = find(parsed, 'author');
        if (a && typeof a === 'object' && a.name) author = a.name;
        else if (a && typeof a === 'string') author = a;
      }
      if (!date) date = find(parsed, 'datePublished');
    } catch {
      /* JSON-LD inválido: ignorar */
    }
  }

  if (!title) title = 'Sin título';
  return {
    type: 'article',
    title,
    author,
    summary: description,
    date: parseDate(date),
    url,
  };
}

const OEMBED_MATCHERS = [
  { type: 'video', match: /tiktok\.com\//, oembed: (u) => `https://www.tiktok.com/oembed?url=${encodeURIComponent(u)}` },
  { type: 'video', match: /instagram\.com\/(p|reel|tv)\//, oembed: (u) => `https://api.instagram.com/oembed?url=${encodeURIComponent(u)}` },
  { type: 'video', match: /(?:youtube\.com\/watch|youtu\.be\/)/, oembed: (u) => `https://www.youtube.com/oembed?url=${encodeURIComponent(u)}&format=json` },
];

async function fetchOEmbed(url) {
  for (const m of OEMBED_MATCHERS) {
    if (!m.match.test(url)) continue;
    try {
      const data = JSON.parse(await fetchText(m.oembed(url), { accept: 'application/json' }));
      if (data && (data.title || data.author_name)) {
        return {
          type: m.type,
          title: data.title || data.author_name || 'Video',
          author: data.author_name || '',
          summary: data.title || '',
          url: data.url || url,
          date: '',
        };
      }
    } catch {
      /* probar el siguiente proveedor */
    }
  }
  return null;
}

async function fetchMeta(url) {
  if (!/^https?:\/\//i.test(url)) throw new Error('URL inválida');
  if (/arxiv\.org/i.test(url)) {
    const meta = await fetchArxiv(url);
    if (meta) return meta;
  }
  if (/twitter\.com|^https?:\/\/x\.com/i.test(url)) {
    try {
      const meta = await fetchTwitter(url);
      if (meta) return meta;
    } catch {
      /* si oEmbed falla, seguir con el genérico */
    }
  }
  if (/tiktok\.com|instagram\.com|youtube\.com|youtu\.be/i.test(url)) {
    const meta = await fetchOEmbed(url);
    if (meta) return meta;
  }
  return fetchGeneric(url);
}

function htmlToText($) {
  const main = $('article, main, .content, #content, .article-body').first();
  const root = main.length ? main : $('body');
  root.find('script, style, nav, footer, header, aside').remove();
  return root
    .text()
    .replace(/\r?\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 12000);
}

async function readPage(url) {
  if (!/^https?:\/\//i.test(url)) throw new Error('URL inválida');

  try {
    const jina = await fetchViaJina(url);
    if (jina.body && !blockedText(jina.title, jina.body)) {
      return {
        url,
        title: jina.title || 'Sin título',
        author: jina.author || '',
        date: jina.date || '',
        content: jina.body,
      };
    }
  } catch {
    /* seguir al siguiente intento */
  }

  try {
    const html = await fetchText(url);
    const $ = cheerio.load(html);
    const titleTxt = $('title').first().text();
    const bodyTxt = $('body').first().text().slice(0, 600);
    if (looksBlocked(`${titleTxt} ${bodyTxt}`)) throw new Error('página de bloqueo');
    return {
      url,
      title: titleTxt.replace(/\s+/g, ' ').trim() || 'Sin título',
      author: '',
      date: '',
      content: htmlToText($),
    };
  } catch {
    /* último recurso: solo los metadatos */
  }

  let meta;
  try {
    meta = await fetchMeta(url);
  } catch {
    meta = null;
  }

  if (meta && !blockedText(meta.title, meta.summary) && meta.title) {
    if (meta.doi || meta.journal) {
      return {
        url,
        title: meta.title,
        author: meta.author || '',
        date: meta.date || '',
        doi: meta.doi || '',
        oaPdf: meta.oaPdf || '',
        content: buildCrossrefContent(meta),
      };
    }
    return {
      url,
      title: meta.title,
      author: meta.author || '',
      date: meta.date || '',
      content: meta.summary ? `> ${meta.summary}` : 'No se pudo leer esta página.',
    };
  }

  throw new Error(
    'Esta página bloquea el acceso (reCAPTCHA/Cloudflare) y no se puede leer automáticamente. ' +
      'Prueba con el botón "Buscar" o pega el contenido manualmente.'
  );
}

module.exports = { fetchMeta, readPage };