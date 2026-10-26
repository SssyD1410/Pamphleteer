import { ACCEPT, extract, paragraphsFromText, charCount } from './extract.js';
import { collage, pairOneToOne } from './align.js';
import { LANGUAGES, TRANSLATE_LIMIT, guessLanguage, engines, translate } from './translate.js';

const $ = (s, root = document) => root.querySelector(s);
const BATCH = 120; // rows added to the page per scroll step

const sides = {};
for (const el of document.querySelectorAll('.side')) {
  const name = el.dataset.side;
  sides[name] = {
    el,
    input: $('input[type=file]', el),
    drop: $('.drop', el),
    paste: $('.paste', el),
    lang: $('.lang', el),
    info: $('.info', el),
    title: '',
    paras: null,
    busy: false,
  };
}

// ---------- setup view ----------

const langOptions = Object.entries(LANGUAGES).map(([c, n]) => `<option value="${c}">${n}</option>`).join('');
for (const s of Object.values(sides)) {
  s.lang.innerHTML = langOptions;
  s.input.accept = ACCEPT;
}
sides.right.lang.value = 'fr';
$('#limit').textContent = TRANSLATE_LIMIT.toLocaleString();

const status = (msg, isError = false) => {
  const el = $('#status');
  el.textContent = msg;
  el.classList.toggle('error', isError);
};

const fmt = (n) => n.toLocaleString();

async function load(side, file) {
  const s = sides[side];
  s.busy = true;
  s.paras = null;
  s.title = file.name.replace(/\.[^.]+$/, '');
  $('.drop-title', s.drop).textContent = file.name;
  $('.drop-hint', s.drop).textContent = (file.size / 1048576).toFixed(file.size > 1048576 ? 1 : 2) + ' MB';
  s.drop.classList.add('filled');
  refresh();
  try {
    s.paras = await extract(file, (msg, frac) => {
      s.info.textContent = msg + (frac ? ` (${Math.round(frac * 100)}%)` : '');
    });
    if (!s.paras.length) throw new Error('No readable text found in ' + file.name + '. Scanned PDFs need OCR first.');
    s.lang.value = guessLanguage(s.paras.slice(0, 300).map((p) => p.t).join(' '));
    s.info.textContent = `${fmt(s.paras.length)} paragraphs · ${fmt(charCount(s.paras))} characters`;
    status('');
  } catch (err) {
    s.paras = null;
    s.info.textContent = '';
    status(err.message, true);
  }
  s.busy = false;
  refresh();
}

function loadPasted(side) {
  const s = sides[side];
  const text = s.paste.value.trim();
  s.paras = text ? paragraphsFromText(text) : null;
  s.title = text ? (side === 'left' ? 'Original' : 'Translation') : '';
  if (s.paras) {
    s.lang.value = guessLanguage(text);
    s.info.textContent = `${fmt(s.paras.length)} paragraphs · ${fmt(text.length)} characters`;
  } else s.info.textContent = '';
  refresh();
}

function refresh() {
  const L = sides.left, R = sides.right;
  const translating = L.paras && !R.paras && !R.busy;
  $('#translate-opts').hidden = !translating;
  let ok = !!L.paras && !L.busy && !R.busy;
  if (translating) {
    const n = charCount(L.paras);
    if (n > TRANSLATE_LIMIT) {
      ok = false;
      status(`This text has ${fmt(n)} characters — too long to translate here. Upload its translation on the right.`);
    } else if ($('#engine').value === 'claude' && !$('#api-key').value.trim()) {
      ok = false;
    }
  }
  $('#go').disabled = !ok;
  $('#go').textContent = translating ? 'Translate & set in type' : 'Set in type';
}

function updateEngineNote() {
  const e = $('#engine').value;
  $('#key-wrap').hidden = e !== 'claude';
  $('#engine-note').textContent = {
    browser: engines().browser
      ? 'Uses the translation model built into your browser. Free and private; the first run may download a language pack.'
      : 'Your browser has no built-in translator (it needs a recent desktop Chrome). Pick another engine.',
    claude: 'Calls Claude directly from this page with your key. The key is kept only in this tab and is never stored.',
    mymemory: 'Sends the text to the public MyMemory service. Free, but limited to about 5,000 characters a day.',
  }[e];
  refresh();
}

if (!engines().browser) $('#engine').value = 'claude';
$('#engine').addEventListener('change', updateEngineNote);
$('#api-key').addEventListener('input', refresh);
updateEngineNote();

for (const [name, s] of Object.entries(sides)) {
  s.input.addEventListener('change', () => s.input.files[0] && load(name, s.input.files[0]));
  s.drop.addEventListener('dragover', (e) => { e.preventDefault(); s.drop.classList.add('over'); });
  s.drop.addEventListener('dragleave', () => s.drop.classList.remove('over'));
  s.drop.addEventListener('drop', (e) => {
    e.preventDefault();
    s.drop.classList.remove('over');
    if (e.dataTransfer.files[0]) load(name, e.dataTransfer.files[0]);
  });
  $('.paste-toggle', s.el).addEventListener('click', () => {
    s.paste.hidden = !s.paste.hidden;
    if (!s.paste.hidden) s.paste.focus();
  });
  let timer;
  s.paste.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => loadPasted(name), 250); });
}

$('#sample').addEventListener('click', async () => {
  status('Fetching the sample…');
  const files = await Promise.all(['alice-en.txt', 'alice-fr.txt'].map(async (f, i) => {
    const blob = await fetch('samples/' + f).then((r) => r.blob());
    return new File([blob], i ? 'Aventures d’Alice au pays des merveilles.txt' : 'Alice’s Adventures in Wonderland.txt');
  }));
  await Promise.all([load('left', files[0]), load('right', files[1])]);
  if (sides.left.paras && sides.right.paras) $('#go').click();
});

$('#go').addEventListener('click', async () => {
  const L = sides.left, R = sides.right;
  $('#go').disabled = true;
  try {
    let result, right = R, rightLang = R.lang.value;
    if (!R.paras) {
      const to = R.lang.value;
      status(`Translating into ${LANGUAGES[to]}…`);
      const translated = await translate($('#engine').value, L.paras, L.lang.value, to, {
        apiKey: $('#api-key').value.trim(),
        progress: (msg, frac) => status(msg + (frac ? ` — ${Math.round(frac * 100)}%` : '')),
      });
      right = { title: `${LANGUAGES[to]} translation`, paras: translated };
      result = pairOneToOne(L.paras, translated);
    } else {
      status('Collaging…');
      result = collage(L.paras, R.paras);
    }
    status('');
    openReader(result.rows, { title: L.title, lang: L.lang.value }, { title: right.title, lang: rightLang });
  } catch (err) {
    status(err.message || String(err), true);
  }
  refresh();
});

// ---------- reader ----------

const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// _underscores_ are the plain-text convention for italics (Project Gutenberg, Markdown).
const prose = (s) => esc(s).replace(/(^|[\s(“"«])_([^_\n]+)_(?=$|[\s.,;:!?)”"»—-])/g, '$1<em>$2</em>');
const parasHtml = (ps) => ps.map((p) => {
  const cls = p.h ? ' class="h"' : p.t.includes('\n') ? ' class="v"' : '';
  return `<p${cls}>${prose(p.t)}</p>`;
}).join('');

function rowHtml([a, b], k, left, right) {
  const chapter = k > 0 && (a[0]?.h || b[0]?.h) ? ' chapter' : '';
  return `<div class="row${chapter}"><div class="col col-l" lang="${left.lang}">${parasHtml(a)}</div><div class="col col-r" lang="${right.lang}">${parasHtml(b)}</div></div>`;
}

let current = null;
let observer = null;

function openReader(rows, left, right) {
  current = { rows, left, right, shown: 0 };
  $('#setup').hidden = true;
  $('.masthead').hidden = true;
  $('#reader').hidden = false;
  $('#titles').textContent = `${left.title}  ·  ${right.title}`;
  document.title = `${left.title} — Pamphleteer`;
  $('#pages').innerHTML = '';
  window.scrollTo(0, 0);
  fill();
  observer?.disconnect();
  observer = new IntersectionObserver((entries) => entries[0].isIntersecting && fill(), { rootMargin: '1500px' });
  observer.observe($('#sentinel'));
}

// Keep roughly two screens of rows ready below the viewport.
function fill() {
  while (current && current.shown < current.rows.length && $('#sentinel').getBoundingClientRect().top < innerHeight + 1500) more();
}

function more() {
  const c = current;
  if (!c || c.shown >= c.rows.length) return;
  const end = Math.min(c.rows.length, c.shown + BATCH);
  let html = '';
  for (let k = c.shown; k < end; k++) html += rowHtml(c.rows[k], k, c.left, c.right);
  $('#pages').insertAdjacentHTML('beforeend', html);
  c.shown = end;
}

window.addEventListener('scroll', () => {
  if (!current) return;
  fill();
  const max = document.documentElement.scrollHeight - innerHeight;
  // Progress is measured against all rows, not just the ones rendered so far.
  const frac = max > 0 ? (scrollY / max) * (current.shown / current.rows.length) : 0;
  $('#progress').style.width = (frac * 100).toFixed(2) + '%';
}, { passive: true });

let size = 19;
const setSize = (d) => {
  size = Math.min(30, Math.max(13, size + d));
  document.body.style.setProperty('--size', size + 'px');
};
$('#smaller').addEventListener('click', () => setSize(-1));
$('#larger').addEventListener('click', () => setSize(1));
$('#swap').addEventListener('click', () => $('#pages').classList.toggle('swap'));
$('#view').addEventListener('change', (e) => {
  const p = $('#pages');
  p.classList.remove('view-left', 'view-right');
  if (e.target.value !== 'both') p.classList.add('view-' + e.target.value);
});
$('#back').addEventListener('click', () => {
  observer?.disconnect();
  current = null;
  $('#pages').innerHTML = '';
  $('#reader').hidden = true;
  $('#setup').hidden = false;
  $('.masthead').hidden = false;
  document.title = 'Pamphleteer';
});

$('#download').addEventListener('click', async () => {
  const c = current;
  if (!c) return;
  const css = await fetch('css/style.css').then((r) => r.text());
  const parts = [];
  for (let k = 0; k < c.rows.length; k++) parts.push(rowHtml(c.rows[k], k, c.left, c.right));
  const title = esc(`${c.left.title} · ${c.right.title}`);
  const doc = `<!doctype html><html lang="${c.left.lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>`
    + `<link href="https://fonts.googleapis.com/css2?family=EB+Garamond:ital,wght@0,400;0,500;1,400&family=IM+Fell+English+SC&display=swap" rel="stylesheet"><style>${css}</style></head>`
    + `<body><nav class="toolbar"><span class="titles">${title}</span></nav><article class="pages">${parts.join('')}</article><p class="colophon">Set by Pamphleteer.</p></body></html>`;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([doc], { type: 'text/html' }));
  a.download = (c.left.title || 'pamphlet').replace(/[^\p{L}\p{N} _-]+/gu, '').trim() + ' — parallel.html';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
});
