// Word lookups for the reader: what word is under the pointer, its translation, and its
// dictionary entry. Words are found from the pointer position on demand, so the page
// never wraps each word of a book in its own element.

import { LANGUAGES, translateWord } from './translate.js';

const segmenters = {};
const segmenter = (lang) => (segmenters[lang] ||= new Intl.Segmenter(lang, { granularity: 'word' }));

function caretAt(x, y) {
  if (document.caretPositionFromPoint) {
    const p = document.caretPositionFromPoint(x, y);
    return p && { node: p.offsetNode, offset: p.offset };
  }
  const r = document.caretRangeFromPoint?.(x, y);
  return r && { node: r.startContainer, offset: r.startOffset };
}

// Returns { word, lang, col, rect } for the word under (x, y), or null.
export function wordAt(x, y) {
  const c = caretAt(x, y);
  if (!c || c.node.nodeType !== Node.TEXT_NODE) return null;
  const col = c.node.parentElement.closest('.col');
  if (!col) return null;
  const lang = col.lang;
  const text = c.node.data;
  for (const seg of segmenter(lang).segment(text)) {
    const end = seg.index + seg.segment.length;
    if (seg.index > c.offset) break;
    if (!seg.isWordLike || c.offset > end) continue;
    const range = document.createRange();
    range.setStart(c.node, seg.index);
    range.setEnd(c.node, end);
    // The caret snaps to the nearest character, so make sure the pointer is really on the word.
    for (const rect of range.getClientRects()) {
      if (x >= rect.left - 1 && x <= rect.right + 1 && y >= rect.top - 1 && y <= rect.bottom + 1) {
        return { word: seg.segment, lang, col: +col.dataset.k, rect };
      }
    }
    return null;
  }
  return null;
}

// ---------- Wiktionary ----------

const defCache = new Map();

// Definitions from English Wiktionary for `word` in language `lang`: [{ pos, defs: [html] }].
export function definitions(word, lang) {
  const key = lang + ':' + word;
  if (!defCache.has(key)) defCache.set(key, fetchDefinitions(word, lang));
  return defCache.get(key);
}

async function fetchDefinitions(word, lang) {
  for (const w of new Set([word, word.toLowerCase()])) {
    const res = await fetch(`https://en.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(w)}?redirect=true`);
    if (!res.ok) continue;
    const data = await res.json();
    const entries = data[lang] || [];
    if (entries.length) {
      return entries.map((e) => ({
        pos: e.partOfSpeech,
        defs: e.definitions.map((d) => clean(d.definition)).filter(Boolean).slice(0, 6),
      }));
    }
  }
  return [];
}

// Keep the text of a definition; turn its wiki links into in-panel lookups.
function clean(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const walk = (node) => {
    let out = '';
    for (const n of node.childNodes) {
      if (n.nodeType === Node.TEXT_NODE) out += esc(n.data);
      else if (n.localName === 'a' && /^\/wiki\/[^:]+$/.test(n.getAttribute('href') || '')) {
        const target = decodeURIComponent(n.getAttribute('href').slice(6)).replace(/_/g, ' ').replace(/#.*/, '');
        out += `<button class="xref" data-w="${esc(target)}">${walk(n)}</button>`;
      } else if (n.nodeType === Node.ELEMENT_NODE && !['sup', 'style', 'script'].includes(n.localName)) out += walk(n);
    }
    return out;
  };
  return walk(doc.body).trim();
}

export const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---------- hover gloss and dictionary panel ----------

export function attachLookup({ pages, gloss, panel, columns, glossTarget }) {
  let hoverKey = '', timer = 0, frame = 0;

  const targetFor = (lang) => {
    const want = glossTarget();
    if (want && want !== lang) return want;
    return columns().map((c) => c.lang).find((l) => l !== lang) || 'en';
  };

  const hideGloss = () => { gloss.hidden = true; hoverKey = ''; clearTimeout(timer); };

  async function showGloss(hit) {
    const to = targetFor(hit.lang);
    const key = `${hit.lang}:${hit.word}:${to}`;
    gloss.innerHTML = `<b lang="${hit.lang}">${esc(hit.word)}</b><span class="g-tr">…</span><span class="g-def"></span>`;
    gloss.hidden = false;
    const r = hit.rect;
    const top = r.bottom + 8 + gloss.offsetHeight > innerHeight ? r.top - gloss.offsetHeight - 8 : r.bottom + 8;
    gloss.style.top = Math.max(4, top) + 'px';
    gloss.style.left = Math.min(Math.max(4, r.left), innerWidth - gloss.offsetWidth - 8) + 'px';
    translateWord(hit.word, hit.lang, to).then((t) => {
      if (hoverKey === key) gloss.querySelector('.g-tr').textContent = t ? `${LANGUAGES[to] || to}: ${t}` : '';
    });
    definitions(hit.word, hit.lang).then((d) => {
      if (hoverKey !== key || !d.length) return;
      const tmp = document.createElement('div');
      tmp.innerHTML = d[0].defs[0] || '';
      gloss.querySelector('.g-def').textContent = `${d[0].pos.toLowerCase()} · ${tmp.textContent}`.slice(0, 140);
    }).catch(() => {});
  }

  pages.addEventListener('mousemove', (e) => {
    if (e.buttons) return; // selecting text
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      const hit = wordAt(e.clientX, e.clientY);
      if (!hit) return hideGloss();
      const key = `${hit.lang}:${hit.word}:${targetFor(hit.lang)}`;
      if (key === hoverKey) return;
      hideGloss();
      hoverKey = key;
      timer = setTimeout(() => hoverKey === key && showGloss(hit), 350);
    });
  });
  pages.addEventListener('mouseleave', hideGloss);
  addEventListener('scroll', hideGloss, { passive: true });

  pages.addEventListener('click', (e) => {
    if (!getSelection().isCollapsed) return; // the reader was selecting, not looking up
    const hit = wordAt(e.clientX, e.clientY);
    if (hit) { hideGloss(); openPanel(hit.word, hit.lang); }
  });

  panel.addEventListener('click', (e) => {
    const x = e.target.closest('.xref');
    if (x) openPanel(x.dataset.w, panel.dataset.lang);
    if (e.target.closest('.dict-close')) panel.hidden = true;
  });
  addEventListener('keydown', (e) => { if (e.key === 'Escape') panel.hidden = true; });

  async function openPanel(word, lang) {
    panel.dataset.lang = lang;
    const others = [...new Set(columns().map((c) => c.lang).filter((l) => l !== lang))];
    if (!others.length) others.push(lang === 'en' ? 'fr' : 'en');
    const wikt = (sub) => `https://${sub}.wiktionary.org/wiki/${encodeURIComponent(word.toLowerCase())}`;
    panel.innerHTML = `
      <button class="dict-close tool" aria-label="Close">×</button>
      <p class="dict-lang">${esc(LANGUAGES[lang] || lang)}</p>
      <h2 class="dict-word" lang="${lang}">${esc(word)}</h2>
      <section><h3>Translation</h3><dl class="dict-tr">${others.map((l) =>
        `<dt>${esc(LANGUAGES[l] || l)}</dt><dd data-l="${l}" lang="${l}">…</dd>`).join('')}</dl></section>
      <section><h3>Definitions <span class="src">Wiktionary</span></h3><div class="dict-defs">Looking up…</div></section>
      <p class="dict-links">
        <a href="${wikt('en')}#${encodeURIComponent(LANGUAGES[lang] || '')}" target="_blank" rel="noopener">English Wiktionary</a>
        ${others.filter((l) => l !== 'en').map((l) => `· <a href="${wikt(l)}" target="_blank" rel="noopener">${esc(LANGUAGES[l] || l)} Wiktionary</a>`).join(' ')}
        ${lang !== 'en' ? `· <a href="${wikt(lang)}" target="_blank" rel="noopener">${esc(LANGUAGES[lang] || lang)} Wiktionary</a>` : ''}
      </p>`;
    panel.hidden = false;
    panel.scrollTop = 0;

    for (const l of others) {
      translateWord(word, lang, l, { allowDownload: true }).then((t) => {
        const dd = panel.querySelector(`dd[data-l="${l}"]`);
        if (dd && panel.dataset.lang === lang) dd.textContent = t || '—';
      });
    }
    try {
      const entries = await definitions(word, lang);
      const box = panel.querySelector('.dict-defs');
      if (!box) return;
      box.innerHTML = entries.length
        ? entries.map((e) => `<h4>${esc(e.pos)}</h4><ol>${e.defs.map((d) => `<li>${d}</li>`).join('')}</ol>`).join('')
        : `<p class="fine">No entry for “${esc(word)}” in ${esc(LANGUAGES[lang] || lang)}. Try the links below.</p>`;
    } catch {
      const box = panel.querySelector('.dict-defs');
      if (box) box.innerHTML = '<p class="fine">Wiktionary could not be reached.</p>';
    }
  }
}
