import { ACCEPT, extract, paragraphsFromText, charCount } from './extract.js?v=f683cc6816';
import { collageMany } from './align.js?v=f683cc6816';
import { LANGUAGES, TRANSLATE_LIMIT, guessLanguage, engines, translate, keys, setKeys } from './translate.js?v=f683cc6816';
import { attachLookup, esc } from './dict.js?v=f683cc6816';
import { attachSentenceHover } from './sentences.js?v=f683cc6816';
import { maybeTour, runTour } from './tour.js?v=f683cc6816';
import { AIDS, RTL, annotate, prepare, ready } from './romanize.js?v=f683cc6816';
import { importLink } from './fetchurl.js?v=f683cc6816';

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
    linkForm: $('.link-form', el),
    linkInput: $('.link-input', el),
    lang: $('.lang', el),
    info: $('.info', el),
    title: '',
    paras: null,
    busy: false,
    loads: 0, // bumps on every new load or removal, so a late result is dropped
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
    s.linkForm.hidden = true;
    if (!s.paste.hidden) s.paste.focus();
  });
  $('.link-toggle', el).addEventListener('click', () => {
    s.linkForm.hidden = !s.linkForm.hidden;
    s.paste.hidden = true;
    if (!s.linkForm.hidden) s.linkInput.focus();
  });
  s.linkForm.addEventListener('submit', (e) => {
    e.preventDefault();
    loadLink(s, s.linkInput.value);
  });
  let timer;
  s.paste.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => loadPasted(s), 250); });
  s.lang.addEventListener('change', refresh);
  $('.clear-file', el).addEventListener('click', () => clearSide(s));
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

function clearSide(s) {
  s.loads++;
  s.busy = false;
  s.paras = null;
  s.title = '';
  s.input.value = '';
  s.paste.value = '';
  s.paste.hidden = true;
  s.linkInput.value = '';
  s.linkForm.hidden = true;
  $('.drop-title', s.drop).textContent = 'Choose a file';
  $('.drop-hint', s.drop).textContent = 'or drop it here';
  s.drop.classList.remove('filled');
  s.info.textContent = '';
  status('');
  refresh();
}

async function load(s, file) {
  const id = ++s.loads;
  s.paste.value = '';
  s.paste.hidden = true;
  s.busy = true;
  s.paras = null;
  s.title = file.name.replace(/\.[^.]+$/, '');
  $('.drop-title', s.drop).textContent = file.name;
  $('.drop-hint', s.drop).textContent = (file.size / 1048576).toFixed(file.size > 1048576 ? 1 : 2) + ' MB';
  s.drop.classList.add('filled');
  refresh();
  try {
    const paras = await extract(file, (msg, frac) => {
      if (id === s.loads) s.info.textContent = msg + (frac ? ` (${Math.round(frac * 100)}%)` : '');
    });
    if (id !== s.loads) return; // removed or replaced while reading
    s.paras = paras;
    if (!s.paras.length) throw new Error('No readable text found in ' + file.name + '. Scanned PDFs need OCR first.');
    s.lang.value = guessLanguage(s.paras.slice(0, 300).map((p) => p.t).join(' '));
    s.info.textContent = `${fmt(s.paras.length)} paragraphs · ${fmt(charCount(s.paras))} characters`;
    status('');
  } catch (err) {
    if (id !== s.loads) return;
    s.paras = null;
    s.info.textContent = '';
    status(err.message, true);
  }
  s.busy = false;
  refresh();
}

// An article or book from a web link (see fetchurl.js for how it is fetched).
async function loadLink(s, raw) {
  const id = ++s.loads;
  s.busy = true;
  s.paras = null;
  s.paste.value = '';
  s.paste.hidden = true;
  s.input.value = '';
  let host = raw.trim();
  try { host = new URL(/^https?:/i.test(host) ? host : 'https://' + host).hostname; } catch { /* reported below */ }
  $('.drop-title', s.drop).textContent = host || 'Link';
  $('.drop-hint', s.drop).textContent = 'from the web';
  s.drop.classList.add('filled');
  status('');
  refresh();
  try {
    const got = await importLink(raw, {
      progress: (msg, frac) => { if (id === s.loads) s.info.textContent = msg + (frac ? ` (${Math.round(frac * 100)}%)` : ''); },
    });
    if (id !== s.loads) return;
    s.paras = got.paras;
    s.title = got.title;
    $('.drop-title', s.drop).textContent = got.title;
    $('.drop-hint', s.drop).textContent = `from ${got.via}`;
    s.lang.value = LANGUAGES[got.lang] ? got.lang : guessLanguage(s.paras.slice(0, 300).map((p) => p.t).join(' '));
    s.info.textContent = `${fmt(s.paras.length)} paragraphs · ${fmt(charCount(s.paras))} characters`;
    s.linkForm.hidden = true;
  } catch (err) {
    if (id !== s.loads) return;
    s.paras = null;
    s.info.textContent = '';
    $('.drop-title', s.drop).textContent = 'Choose a file';
    $('.drop-hint', s.drop).textContent = 'or drop it here';
    s.drop.classList.remove('filled');
    status(err.message || String(err), true);
  }
  s.busy = false;
  refresh();
}

function loadPasted(s) {
  const text = s.paste.value.trim();
  if (text && s.drop.classList.contains('filled')) { // pasting replaces an uploaded file
    s.loads++;
    s.busy = false;
    s.input.value = '';
    $('.drop-title', s.drop).textContent = 'Choose a file';
    $('.drop-hint', s.drop).textContent = 'or drop it here';
    s.drop.classList.remove('filled');
  }
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
  for (const s of sides) $('.clear-file', s.el).hidden = !(s.paras || s.busy || s.paste.value.trim());
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
    } else if (['claude', 'google'].includes($('#engine').value) && !keys[$('#engine').value]) {
      ok = false;
    }
  }
  $('#go').disabled = !ok;
  $('#go').textContent = translating ? 'Translate & set in type' : 'Set in type';
}

function updateEngineNote() {
  const e = $('#engine').value;
  for (const f of document.querySelectorAll('#translate-opts .key-field')) f.hidden = f.dataset.for !== e;
  $('#engine-note').textContent = {
    claude: 'Best quality: Claude translates like a literary translator, keeping tone, idiom and dialogue. Uses your Anthropic key, called straight from this page.',
    google: 'Google Cloud Translation with your own API key (first 500,000 characters a month are free). Same quality as translate.google.com.',
    browser: engines().browser
      ? 'Uses the translation model built into your browser. Free and private, but rougher than Google or Claude; the first run may download a language pack.'
      : 'Your browser has no built-in translator (it needs a recent desktop Chrome). Pick another engine.',
    mymemory: 'Sends the text to the public MyMemory service. Free but basic, and limited to about 5,000 characters a day.',
  }[e];
  try { localStorage.setItem('pamphleteer.engine', e); } catch { /* storage blocked */ }
  refresh();
}

// Key fields: the setup form and the dictionary panel share the same keys.
function syncKeyFields() {
  for (const i of document.querySelectorAll('.key-input')) if (document.activeElement !== i) i.value = keys[i.dataset.key] || '';
  for (const c of document.querySelectorAll('.key-remember')) c.checked = !!keys.remember;
}
document.addEventListener('input', (e) => {
  if (e.target.matches('.key-input')) { setKeys({ [e.target.dataset.key]: e.target.value.trim() }); syncKeyFields(); refresh(); }
});
document.addEventListener('change', (e) => {
  if (e.target.matches('.key-remember')) { setKeys({ remember: e.target.checked }); syncKeyFields(); }
});
syncKeyFields();

{
  let saved = null;
  try { saved = localStorage.getItem('pamphleteer.engine'); } catch { /* storage blocked */ }
  $('#engine').value = saved || (keys.claude ? 'claude' : keys.google ? 'google' : engines().browser ? 'browser' : 'mymemory');
}
$('#engine').addEventListener('change', updateEngineNote);
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
        progress: (msg, frac) => status(`${LANGUAGES[to]}: ${msg}` + (frac ? ` — ${Math.round(frac * 100)}%` : '')),
      });
      others.push({ paras, title: `${LANGUAGES[to]} translation`, lang: to, exact: true });
    }
    status('Collaging…');
    await new Promise((r) => setTimeout(r)); // let the status paint before the alignment pass
    const { rows, reports } = collageMany(first.paras, others);
    status('');
    const columns = [{ title: first.title, lang: first.lang.value }, ...others.map(({ title, lang }) => ({ title, lang }))];
    openReader(rows, columns);
    showMismatch(mismatchNotes(columns, reports));
  } catch (err) {
    const friendly = { 401: 'That Anthropic API key was rejected. Check it and try again.', 429: 'Claude is rate-limiting this key; wait a minute and try again.' };
    status(friendly[err.status] || err.message || String(err), true);
  }
  refresh();
});

// ---------- reader ----------

// _underscores_ are the plain-text convention for italics (Project Gutenberg, Markdown).
const prose = (s) => esc(s).replace(/(^|[\s(“"«»])_([^_\n]+)_(?=$|[\s.,;:!?)”"»«—-])/g, '$1<em>$2</em>');
// `aid` is a reading aid to draw above the text (pinyin, furigana, romanization), or ''.
const parasHtml = (ps, lang, aid) => ps.map((p) => {
  const cls = p.h ? ' class="h"' : p.t.includes('\n') ? ' class="v"' : '';
  return `<p${cls}>${aid ? annotate(p.t, lang, aid) : prose(p.t)}</p>`;
}).join('');

// Reading aids switched on, per language, remembered between visits: { zh: 'pinyin', ja: 'furigana' }.
const aids = (() => { try { return JSON.parse(localStorage.getItem('pamphleteer.aids') || '{}'); } catch { return {}; } })();
const aidFor = (lang) => (aids[lang] && ready(lang) ? aids[lang] : '');

let current = null;
let observer = null;

// Columns in display order, skipping hidden ones.
const shownColumns = () => current.order.filter((k) => !current.hidden.has(k));

function rowHtml(row, k) {
  const chapter = k > 0 && row.some((col) => col[0]?.h) ? ' chapter' : '';
  const cols = shownColumns().map((c) => {
    const lang = current.columns[c].lang;
    const aid = aidFor(lang);
    return `<div class="col${aid ? ' aided' : ''}" data-k="${c}" lang="${lang}"${RTL.has(lang) ? ' dir="rtl"' : ''}>${parasHtml(row[c], lang, aid)}</div>`;
  });
  return `<div class="row${chapter}">${cols.join('')}</div>`;
}

// Big books are split into pages: a new page at every chapter, and long chapters are
// cut at a row boundary once a page holds about PAGE_CHARS characters per language.
const PAGE_CHARS = 30000;

function paginate(rows, ncols) {
  const size = (row) => row.reduce((s, col) => s + col.reduce((t, p) => t + p.t.length, 0), 0) / ncols;
  const pages = [];
  let start = 0, chars = 0;
  rows.forEach((row, k) => {
    const isChapter = k > 0 && row.some((col) => col[0]?.h);
    if (k > start && (isChapter || chars + size(row) > PAGE_CHARS)) {
      pages.push([start, k]);
      start = k;
      chars = 0;
    }
    chars += size(row);
  });
  pages.push([start, rows.length]);
  // Small texts stay on one page.
  const total = rows.reduce((s, r) => s + size(r), 0);
  return total <= PAGE_CHARS * 1.5 ? [[0, rows.length]] : pages;
}

function pageLabel(c, [start], i) {
  const head = c.rows[start].map((col) => col[0]).find((p) => p?.h);
  const name = head ? head.t.replace(/\s*\n\s*/g, ' — ') : (i ? `continued` : 'Opening');
  return `${i + 1}. ${name}`.slice(0, 80);
}

// Plain-language reasons the uploaded texts may not be the same work.
function mismatchNotes(columns, reports) {
  const notes = [];
  const name = (c) => `<em>${esc(c.title)}</em> (${esc(LANGUAGES[c.lang] || c.lang)})`;
  reports.forEach((r, k) => {
    if (!r) return; // translated here, so it matches by construction
    const a = columns[0], b = columns[k + 1];
    for (const why of r.reasons) {
      if (why.kind === 'fit') notes.push(`Only about ${Math.round((1 - why.share) * 100)}% of ${name(b)} lines up with ${name(a)}. Paragraphs don’t correspond, so the columns will drift apart.`);
      if (why.kind === 'length') {
        const [long, short, x] = why.ratio > 1 ? [b, a, why.ratio] : [a, b, 1 / why.ratio];
        notes.push(`${name(long)} is ${x.toFixed(1)}× as long as ${name(short)}. One may be abridged, or only part of the book.`);
      }
      if (why.kind === 'chapters') notes.push(`The chapter headings of ${name(a)} and ${name(b)} don’t correspond.`);
    }
  });
  const seen = new Map();
  for (const c of columns) {
    if (seen.has(c.lang)) notes.push(`${name(seen.get(c.lang))} and ${name(c)} are both set to ${esc(LANGUAGES[c.lang] || c.lang)}. Check the language, or whether the same file was uploaded twice.`);
    else seen.set(c.lang, c);
  }
  return notes;
}

function showMismatch(notes) {
  const box = $('#notice');
  box.hidden = !notes.length;
  if (!notes.length) return;
  box.innerHTML = `<p class="notice-title">These texts may not match</p><ul>${notes.map((n) => `<li>${n}</li>`).join('')}</ul>
    <p class="notice-actions"><button type="button" class="tool notice-back">Choose other files</button> <button type="button" class="link notice-close">Read anyway</button></p>`;
}

$('#notice').addEventListener('click', (e) => {
  if (e.target.closest('.notice-close')) $('#notice').hidden = true;
  if (e.target.closest('.notice-back')) $('#back').click();
});

function openReader(rows, columns) {
  $('#notice').hidden = true;
  setTimeout(() => maybeTour('reader'), 400); // after the first rows are laid out
  setTimeout(() => { buildAidsMenu(); restoreAids(); });
  current = { rows, columns, order: columns.map((_, k) => k), hidden: new Set(), shown: 0, page: 0 };
  current.pages = paginate(rows, columns.length);
  $('#setup').hidden = true;
  $('.masthead').hidden = true;
  $('#reader').hidden = false;
  document.title = `${columns[0].title} — Pamphleteer`;
  $('#gloss-lang').innerHTML = [...new Set(columns.map((c) => c.lang))].map((l) => `<option value="${l}">${LANGUAGES[l] || l}</option>`).join('');
  $('#gloss-lang').value = columns[0].lang;
  $('#col-toggles').innerHTML = columns.map((c, k) => `<button class="tool chip on" data-k="${k}" title="${esc(c.title)}">${c.lang.toUpperCase()}</button>`).join('');
  $('#rotate').hidden = columns.length < 2;
  const many = current.pages.length > 1;
  document.querySelectorAll('.pager').forEach((el) => { el.hidden = !many; });
  $('.page-pick').innerHTML = current.pages.map((pg, i) => `<option value="${i}">${esc(pageLabel(current, pg, i))}</option>`).join('');
  observer?.disconnect();
  observer = new IntersectionObserver((entries) => entries[0].isIntersecting && fill(), { rootMargin: '1500px' });
  observer.observe($('#sentinel'));
  goToPage(+(location.hash.match(/^#p=(\d+)/)?.[1] || 1) - 1, false);
}

function goToPage(i, push = true) {
  const c = current;
  c.page = Math.max(0, Math.min(c.pages.length - 1, i || 0));
  if (c.pages.length > 1) {
    const hash = `#p=${c.page + 1}`;
    if (push && location.hash !== hash) history.pushState(null, '', hash);
    else if (!push) history.replaceState(null, '', hash);
  }
  $('.page-pick').value = c.page;
  document.querySelectorAll('.page-prev').forEach((b) => { b.disabled = c.page === 0; });
  document.querySelectorAll('.page-next').forEach((b) => { b.disabled = c.page === c.pages.length - 1; });
  const next = c.pages[c.page + 1];
  $('.page-of').textContent = `Page ${c.page + 1} of ${c.pages.length}` + (next ? ` · next: ${pageLabel(c, next, c.page + 1).replace(/^\d+\.\s*/, '')}` : '');
  $('#pages').innerHTML = '';
  window.scrollTo(0, 0);
  rerender();
}

const pageRange = () => current.pages[current.page];

// Redraw after a column change, keeping the reader near the same row.
function rerender() {
  const c = current;
  const anchor = [...document.querySelectorAll('#pages .row')].findIndex((r) => r.getBoundingClientRect().bottom > 60);
  const shown = shownColumns();
  $('#titles').textContent = shown.map((k) => c.columns[k].title).join('  ·  ');
  $('#pages').style.setProperty('--cols', shown.length);
  $('#pages').dataset.cols = shown.length;
  $('#pages').innerHTML = '';
  c.shown = pageRange()[0];
  while (c.shown < pageRange()[0] + Math.max(anchor + 1, 1)) more();
  fill();
  if (anchor > 0) document.querySelectorAll('#pages .row')[anchor].scrollIntoView();
}

function fill() {
  while (current && current.shown < pageRange()[1] && $('#sentinel').getBoundingClientRect().top < innerHeight + 1500) more();
}

function more(end = pageRange()[1]) {
  const c = current;
  if (!c || c.shown >= end) return;
  const stop = Math.min(end, c.shown + BATCH);
  let html = '';
  for (let k = c.shown; k < stop; k++) html += rowHtml(c.rows[k], k);
  $('#pages').insertAdjacentHTML('beforeend', html);
  c.shown = stop;
}

for (const b of document.querySelectorAll('.page-prev')) b.addEventListener('click', () => goToPage(current.page - 1));
for (const b of document.querySelectorAll('.page-next')) b.addEventListener('click', () => goToPage(current.page + 1));
$('.page-pick').addEventListener('change', (e) => goToPage(+e.target.value));
addEventListener('popstate', () => {
  if (!current) return;
  const p = +(location.hash.match(/^#p=(\d+)/)?.[1] || 1) - 1;
  if (p !== current.page) goToPage(p, false);
});
addEventListener('keydown', (e) => {
  if (!current || e.target.closest('input, select, textarea') || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === 'ArrowRight' && current.page < current.pages.length - 1) goToPage(current.page + 1);
  if (e.key === 'ArrowLeft' && current.page > 0) goToPage(current.page - 1);
});

window.addEventListener('scroll', () => {
  if (!current) return;
  fill();
  const [a, b] = pageRange();
  const max = document.documentElement.scrollHeight - innerHeight;
  // Progress through the whole book: rows before this page plus the part of this page read.
  const within = max > 0 ? (scrollY / max) * ((current.shown - a) / (b - a)) : 0;
  $('#progress').style.width = (((a + within * (b - a)) / current.rows.length) * 100).toFixed(2) + '%';
}, { passive: true });

attachSentenceHover($('#pages'));

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
  history.replaceState(null, '', location.pathname + location.search);
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
  const css = await fetch('css/style.css?v=f683cc6816').then((r) => r.text());
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

// PDF: lay out every row of every page in a print-only copy, then hand it to the browser's
// print engine ("Save as PDF"). Real text in the chosen font keeps the PDF searchable and small.
$('#pdf').addEventListener('click', async () => {
  const c = current;
  if (!c) return;
  const btn = $('#pdf');
  btn.textContent = 'Setting…';
  await new Promise((r) => setTimeout(r, 30));
  const n = shownColumns().length;
  const book = document.createElement('article');
  book.id = 'print-book';
  book.className = 'pages';
  book.dataset.cols = n;
  book.style.setProperty('--cols', n);
  const parts = [];
  for (let k = 0; k < c.rows.length; k++) parts.push(rowHtml(c.rows[k], k));
  book.innerHTML = parts.join('');
  $('#pages').after(book);
  await document.fonts.ready;
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
  book.remove();
});

$('#help').addEventListener('click', () => runTour('reader'));

// ---------- reading aids menu ----------

function buildAidsMenu() {
  const langs = [...new Set(current.columns.map((c) => c.lang))].filter((l) => AIDS[l]);
  $('#aids').hidden = !langs.length;
  $('#aids-menu').innerHTML = langs.map((l) => `
    <fieldset><legend>${esc(LANGUAGES[l] || l)}</legend>
      <label><input type="radio" name="aid-${l}" value="" ${!aids[l] ? 'checked' : ''}> Off</label>
      ${AIDS[l].map(([mode, label]) => `<label><input type="radio" name="aid-${l}" value="${mode}" ${aids[l] === mode ? 'checked' : ''}> ${esc(label)}</label>`).join('')}
    </fieldset>`).join('') + `<p class="fine aids-status">${langs.includes('ja') ? 'Japanese aids download a dictionary (about 18 MB) the first time.' : ''}</p>`;
}

$('#aids').addEventListener('click', (e) => {
  e.stopPropagation();
  $('#aids-menu').hidden = !$('#aids-menu').hidden;
});
document.addEventListener('click', (e) => {
  if (!e.target.closest('#aids-menu, #aids')) $('#aids-menu').hidden = true;
});
$('#aids-menu').addEventListener('change', async (e) => {
  const lang = e.target.name?.replace(/^aid-/, '');
  if (!lang) return;
  aids[lang] = e.target.value;
  try { localStorage.setItem('pamphleteer.aids', JSON.stringify(aids)); } catch { /* storage blocked */ }
  if (aids[lang] && !ready(lang)) {
    const note = $('.aids-status');
    note.textContent = `Loading ${LANGUAGES[lang]} reading aids…`;
    try { await prepare(lang); note.textContent = ''; } catch { note.textContent = 'Could not load the reading aids. Check your connection.'; return; }
  }
  rerender();
});

// Aids remembered from an earlier visit: load what they need, then redraw.
async function restoreAids() {
  const want = [...new Set(current.columns.map((c) => c.lang))].filter((l) => aids[l] && !ready(l));
  if (!want.length) return;
  await Promise.all(want.map((l) => prepare(l).catch(() => {})));
  if (current) rerender();
}
$('#setup-help').addEventListener('click', () => runTour('setup'));
maybeTour('setup');
