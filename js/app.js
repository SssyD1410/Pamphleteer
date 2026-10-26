import { ACCEPT, extract, paragraphsFromText, charCount } from './extract.js';
import { collageMany } from './align.js';
import { LANGUAGES, TRANSLATE_LIMIT, guessLanguage, engines, translate } from './translate.js';
import { attachLookup, esc } from './dict.js';

const $ = (s, root = document) => root.querySelector(s);
const BATCH = 120; // rows added to the page per scroll step
const MAX_SIDES = 4;
const SIDE_NAMES = ['Original', 'Translation', 'Third language', 'Fourth language'];
const DEFAULT_LANGS = ['en', 'fr', 'de', 'es'];

const FONTS = {
  garamond: { label: 'EB Garamond', css: "'EB Garamond'", url: null },
  cormorant: { label: 'Cormorant', css: "'Cormorant Garamond'", url: 'Cormorant+Garamond:ital,wght@0,400;0,600;1,400' },
  baskerville: { label: 'Libre Baskerville', css: "'Libre Baskerville'", url: 'Libre+Baskerville:ital,wght@0,400;0,700;1,400' },
  crimson: { label: 'Crimson Pro', css: "'Crimson Pro'", url: 'Crimson+Pro:ital,wght@0,400;0,600;1,400' },
  oldstandard: { label: 'Old Standard', css: "'Old Standard TT'", url: 'Old+Standard+TT:ital,wght@0,400;0,700;1,400' },
  noto: { label: 'Noto Serif (all scripts)', css: "'Noto Serif', 'Noto Serif SC', 'Noto Serif JP'", url: 'Noto+Serif:ital,wght@0,400;0,600;1,400&family=Noto+Serif+SC:wght@400;600&family=Noto+Serif+JP:wght@400;600' },
  system: { label: 'System serif', css: 'Georgia, "Times New Roman"', url: null },
};

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};

// ---------- setup view: 2 to 4 sides ----------

const sides = [];
const langOptions = Object.entries(LANGUAGES).map(([c, n]) => `<option value="${c}">${n}</option>`).join('');

function addSide() {
  if (sides.length >= MAX_SIDES) return;
  const el = $('#side-template').content.firstElementChild.cloneNode(true);
  const s = {
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
  s.lang.innerHTML = langOptions;
  s.lang.value = DEFAULT_LANGS.find((l) => !sides.some((o) => o.lang.value === l)) || 'en';
  s.input.accept = ACCEPT;
  $('#sides').appendChild(el);
  sides.push(s);

  s.input.addEventListener('change', () => s.input.files[0] && load(s, s.input.files[0]));
  s.drop.addEventListener('dragover', (e) => { e.preventDefault(); s.drop.classList.add('over'); });
  s.drop.addEventListener('dragleave', () => s.drop.classList.remove('over'));
  s.drop.addEventListener('drop', (e) => {
    e.preventDefault();
    s.drop.classList.remove('over');
    if (e.dataTransfer.files[0]) load(s, e.dataTransfer.files[0]);
  });
  $('.paste-toggle', el).addEventListener('click', () => {
    s.paste.hidden = !s.paste.hidden;
    if (!s.paste.hidden) s.paste.focus();
  });
  let timer;
  s.paste.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => loadPasted(s), 250); });
  s.lang.addEventListener('change', refresh);
  $('.remove-side', el).addEventListener('click', () => {
    sides.splice(sides.indexOf(s), 1);
    el.remove();
    relabel();
  });
  relabel();
}

function relabel() {
  sides.forEach((s, k) => {
    $('.side-name', s.el).textContent = SIDE_NAMES[k];
    $('.remove-side', s.el).hidden = k < 2;
  });
  $('#sides').dataset.count = sides.length;
  $('#add-side').hidden = sides.length >= MAX_SIDES;
  refresh();
}

addSide();
addSide();
$('#add-side').addEventListener('click', addSide);
$('#limit').textContent = TRANSLATE_LIMIT.toLocaleString();

const status = (msg, isError = false) => {
  const el = $('#status');
  el.textContent = msg;
  el.classList.toggle('error', isError);
};

const fmt = (n) => n.toLocaleString();

async function load(s, file) {
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

function loadPasted(s) {
  const text = s.paste.value.trim();
  s.paras = text ? paragraphsFromText(text) : null;
  s.title = text ? SIDE_NAMES[sides.indexOf(s)] : '';
  if (s.paras) {
    s.lang.value = guessLanguage(text);
    s.info.textContent = `${fmt(s.paras.length)} paragraphs · ${fmt(text.length)} characters`;
  } else s.info.textContent = '';
  refresh();
}

function refresh() {
  if (!sides.length) return;
  const first = sides[0];
  const busy = sides.some((s) => s.busy);
  const empty = sides.slice(1).filter((s) => !s.paras);
  const translating = first.paras && empty.length && !busy;
  $('#translate-opts').hidden = !translating;
  let ok = !!first.paras && !busy;
  if (translating) {
    const n = charCount(first.paras);
    if (n > TRANSLATE_LIMIT) {
      ok = false;
      status(`The first text has ${fmt(n)} characters — too long to translate here. Upload its translations instead.`);
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

const SAMPLES = {
  en: ['alice-en.txt', 'Alice’s Adventures in Wonderland'],
  fr: ['alice-fr.txt', 'Aventures d’Alice au pays des merveilles'],
  de: ['alice-de.txt', 'Alice’s Abenteuer im Wunderland'],
};
for (const btn of document.querySelectorAll('[data-sample]')) {
  btn.addEventListener('click', async () => {
    const langs = btn.dataset.sample.split(',');
    while (sides.length < langs.length) addSide();
    while (sides.length > langs.length) { sides.at(-1).el.remove(); sides.pop(); }
    relabel();
    status('Fetching the sample…');
    await Promise.all(langs.map(async (l, k) => {
      const blob = await fetch('samples/' + SAMPLES[l][0]).then((r) => r.blob());
      await load(sides[k], new File([blob], SAMPLES[l][1] + '.txt'));
    }));
    if (sides.every((s) => s.paras)) $('#go').click();
  });
}

$('#go').addEventListener('click', async () => {
  const [first, ...rest] = sides;
  $('#go').disabled = true;
  try {
    const others = [];
    for (const s of rest) {
      if (s.paras) {
        others.push({ paras: s.paras, title: s.title, lang: s.lang.value });
        continue;
      }
      const to = s.lang.value;
      status(`Translating into ${LANGUAGES[to]}…`);
      const paras = await translate($('#engine').value, first.paras, first.lang.value, to, {
        apiKey: $('#api-key').value.trim(),
        progress: (msg, frac) => status(`${LANGUAGES[to]}: ${msg}` + (frac ? ` — ${Math.round(frac * 100)}%` : '')),
      });
      others.push({ paras, title: `${LANGUAGES[to]} translation`, lang: to, exact: true });
    }
    status('Collaging…');
    await new Promise((r) => setTimeout(r)); // let the status paint before the alignment pass
    const { rows } = collageMany(first.paras, others);
    status('');
    openReader(rows, [{ title: first.title, lang: first.lang.value }, ...others.map(({ title, lang }) => ({ title, lang }))]);
  } catch (err) {
    status(err.message || String(err), true);
  }
  refresh();
});

// ---------- reader ----------

// _underscores_ are the plain-text convention for italics (Project Gutenberg, Markdown).
const prose = (s) => esc(s).replace(/(^|[\s(“"«»])_([^_\n]+)_(?=$|[\s.,;:!?)”"»«—-])/g, '$1<em>$2</em>');
const parasHtml = (ps) => ps.map((p) => {
  const cls = p.h ? ' class="h"' : p.t.includes('\n') ? ' class="v"' : '';
  return `<p${cls}>${prose(p.t)}</p>`;
}).join('');

let current = null;
let observer = null;

// Columns in display order, skipping hidden ones.
const shownColumns = () => current.order.filter((k) => !current.hidden.has(k));

function rowHtml(row, k) {
  const chapter = k > 0 && row.some((col) => col[0]?.h) ? ' chapter' : '';
  const cols = shownColumns().map((c) => `<div class="col" data-k="${c}" lang="${current.columns[c].lang}">${parasHtml(row[c])}</div>`);
  return `<div class="row${chapter}">${cols.join('')}</div>`;
}

function openReader(rows, columns) {
  current = { rows, columns, order: columns.map((_, k) => k), hidden: new Set(), shown: 0 };
  $('#setup').hidden = true;
  $('.masthead').hidden = true;
  $('#reader').hidden = false;
  document.title = `${columns[0].title} — Pamphleteer`;
  $('#gloss-lang').innerHTML = [...new Set(columns.map((c) => c.lang))].map((l) => `<option value="${l}">${LANGUAGES[l] || l}</option>`).join('');
  $('#gloss-lang').value = columns[0].lang;
  $('#col-toggles').innerHTML = columns.map((c, k) => `<button class="tool chip on" data-k="${k}" title="${esc(c.title)}">${c.lang.toUpperCase()}</button>`).join('');
  $('#rotate').hidden = columns.length < 2;
  rerender();
  window.scrollTo(0, 0);
  observer?.disconnect();
  observer = new IntersectionObserver((entries) => entries[0].isIntersecting && fill(), { rootMargin: '1500px' });
  observer.observe($('#sentinel'));
}

// Redraw after a column change, keeping the reader near the same row.
function rerender() {
  const c = current;
  const anchor = [...document.querySelectorAll('#pages .row')].findIndex((r) => r.getBoundingClientRect().bottom > 60);
  const shown = shownColumns();
  $('#titles').textContent = shown.map((k) => c.columns[k].title).join('  ·  ');
  $('#pages').style.setProperty('--cols', shown.length);
  $('#pages').dataset.cols = shown.length;
  $('#pages').innerHTML = '';
  c.shown = 0;
  while (c.shown < Math.max(anchor + 1, 1)) more();
  fill();
  if (anchor > 0) document.querySelectorAll('#pages .row')[anchor].scrollIntoView();
}

function fill() {
  while (current && current.shown < current.rows.length && $('#sentinel').getBoundingClientRect().top < innerHeight + 1500) more();
}

function more() {
  const c = current;
  if (!c || c.shown >= c.rows.length) return;
  const end = Math.min(c.rows.length, c.shown + BATCH);
  let html = '';
  for (let k = c.shown; k < end; k++) html += rowHtml(c.rows[k], k);
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

attachLookup({
  pages: $('#pages'),
  gloss: $('#gloss'),
  panel: $('#dict'),
  columns: () => (current ? shownColumns().map((k) => current.columns[k]) : []),
  glossTarget: () => $('#gloss-lang').value,
});

let size = +store.get('pamphleteer.size') || 19;
const setSize = (d) => {
  size = Math.min(30, Math.max(12, size + d));
  document.body.style.setProperty('--size', size + 'px');
  store.set('pamphleteer.size', size);
};
setSize(0);
$('#smaller').addEventListener('click', () => setSize(-1));
$('#larger').addEventListener('click', () => setSize(1));

$('#font').innerHTML = Object.entries(FONTS).map(([k, f]) => `<option value="${k}">${f.label}</option>`).join('');
function setFont(key) {
  const f = FONTS[key] || FONTS.garamond;
  if (f.url && !document.querySelector(`link[data-font="${key}"]`)) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.dataset.font = key;
    link.href = `https://fonts.googleapis.com/css2?family=${f.url}&display=swap`;
    document.head.appendChild(link);
  }
  document.body.style.setProperty('--text', `${f.css}, 'EB Garamond', 'Noto Serif', serif`);
  $('#font').value = key in FONTS ? key : 'garamond';
  store.set('pamphleteer.font', key);
}
setFont(store.get('pamphleteer.font') || 'garamond');
$('#font').addEventListener('change', (e) => setFont(e.target.value));

$('#rotate').addEventListener('click', () => {
  current.order.push(current.order.shift());
  rerender();
});
$('#col-toggles').addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  const k = +chip.dataset.k;
  if (current.hidden.has(k)) current.hidden.delete(k);
  else if (current.hidden.size < current.columns.length - 1) current.hidden.add(k); // keep at least one
  chip.classList.toggle('on', !current.hidden.has(k));
  rerender();
});

$('#back').addEventListener('click', () => {
  observer?.disconnect();
  current = null;
  $('#pages').innerHTML = '';
  $('#dict').hidden = true;
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
  for (let k = 0; k < c.rows.length; k++) parts.push(rowHtml(c.rows[k], k));
  const title = esc($('#titles').textContent);
  const fontLinks = [...document.querySelectorAll('link[rel=stylesheet][href*="fonts.googleapis"]')].map((l) => l.outerHTML).join('');
  const n = shownColumns().length;
  const doc = `<!doctype html><html lang="${c.columns[c.order[0]].lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>`
    + `${fontLinks}<style>${css}</style></head>`
    + `<body style="--size:${size}px;--text:${document.body.style.getPropertyValue('--text')}"><nav class="toolbar"><span class="titles">${title}</span></nav>`
    + `<article class="pages" data-cols="${n}" style="--cols:${n}">${parts.join('')}</article><p class="colophon">Set by Pamphleteer.</p></body></html>`;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([doc], { type: 'text/html' }));
  a.download = (c.columns[0].title || 'pamphlet').replace(/[^\p{L}\p{N} _-]+/gu, '').trim() + ' — parallel.html';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
});

// PDF: lay out every row, then hand the page to the browser's print engine ("Save as PDF").
// It typesets real text with the chosen font, so the PDF stays searchable and small.
$('#pdf').addEventListener('click', async () => {
  const c = current;
  if (!c) return;
  const btn = $('#pdf');
  btn.textContent = 'Setting…';
  await new Promise((r) => setTimeout(r, 30));
  while (c.shown < c.rows.length) more();
  await document.fonts.ready;
  const n = shownColumns().length;
  const page = document.createElement('style');
  page.id = 'page-size';
  page.textContent = `@page { size: A4 ${n >= 3 ? 'landscape' : 'portrait'}; margin: 16mm 14mm; }`;
  document.head.appendChild(page);
  const before = document.title;
  document.title = $('#titles').textContent.replace(/\s+·\s+/g, ' · ');
  btn.textContent = 'PDF';
  print();
  document.title = before;
  page.remove();
});
