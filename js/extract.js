// Turns an uploaded file into a flat list of paragraphs: [{ t: text, h: isHeading }].
// Everything runs in the browser; heavy libraries are loaded only for the formats that need them.

const PDFJS = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.3.289/build/pdf.min.mjs';
const PDFJS_WORKER = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.3.289/build/pdf.worker.min.mjs';
const JSZIP = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
const MAMMOTH = 'https://cdn.jsdelivr.net/npm/mammoth@1.12.3/mammoth.browser.min.js';

export const ACCEPT = '.txt,.md,.markdown,.text,.html,.htm,.xhtml,.pdf,.epub,.docx,.fb2,.srt';

const scriptCache = {};
function loadScript(src) {
  return (scriptCache[src] ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Could not load ' + src));
    document.head.appendChild(s);
  }));
}

const HEADING_RE = new RegExp(
  '^(?:chapter|chapitre|kapitel|cap[ií]tulo|capitolo|hoofdstuk|rozdzia[łl]|kapitola|глава|book|livre|buch|libro|part|partie|teil|parte|section|act|acte|akt|scene|sc[eè]ne|canto|letter|lettre|brief)\\b[\\s.:]*\\S.{0,70}$' +
  '|^[\\p{L}\\d]+\\.?\\s+(?:kapitel|chapter|chapitre|cap[ií]tulo|capitolo|buch|book|livre|teil|part|partie|глава)\\.?$' +
  '|^第\\s*[0-9一二三四五六七八九十百千零〇]+\\s*[章回节節卷部]' +
  '|^[IVXLC]{1,7}\\.?$' +
  '|^#{1,6}\\s+\\S',
  'iu'
);

export function isHeadingLine(s) {
  return s.length <= 80 && !/[,;]$/.test(s) && HEADING_RE.test(s.trim());
}

const clean = (s) => s.replace(/[ \t ]+/g, ' ').trim();

// ---------- plain text ----------

function stripGutenberg(text) {
  const start = text.match(/\*\*\*\s*START OF (?:THE|THIS) PROJECT GUTENBERG[^\n]*\n/i);
  const end = text.match(/\*\*\*\s*END OF (?:THE|THIS) PROJECT GUTENBERG/i);
  if (start && end && end.index > start.index) return text.slice(start.index + start[0].length, end.index);
  return text;
}

export function paragraphsFromText(text) {
  text = stripGutenberg(text.replace(/\r\n?/g, '\n').replace(/^﻿/, ''));
  const out = [];
  for (const block of text.split(/\n[ \t]*\n+/)) {
    const lines = block.split('\n').map(clean).filter(Boolean);
    if (!lines.length || /^\[(?:illustration|image)[^\]]*\]$/i.test(lines.join(' '))) continue;
    const avg = lines.reduce((a, l) => a + l.length, 0) / lines.length;
    // Short-line blocks (verse, addresses) keep their line breaks; prose is unwrapped.
    const t = lines.length > 2 && avg < 42
      ? lines.join('\n')
      : lines.join(' ');
    const md = t.match(/^#{1,6}\s+(.*)$/);
    if (md) out.push({ t: md[1], h: 1 });
    // A heading may carry its title on the next line or two ("CHAPTER I." / "Down the Rabbit-Hole").
    else if (lines.length <= 3 && lines.join(' ').length <= 120 && isHeadingLine(lines[0])) out.push({ t: lines.join('\n'), h: 1 });
    else out.push({ t, h: 0 });
  }
  return out;
}

function paragraphsFromSrt(text) {
  const out = [];
  for (const block of text.replace(/\r\n?/g, '\n').split(/\n\s*\n/)) {
    const lines = block.split('\n').filter((l) => l && !/^\d+$/.test(l) && !/-->/.test(l));
    if (lines.length) out.push({ t: clean(lines.join(' ').replace(/<[^>]+>/g, '')), h: 0 });
  }
  return out;
}

// ---------- HTML-like documents (html, xhtml, epub chapters, docx via mammoth, fb2) ----------

const BLOCKS = 'h1,h2,h3,h4,h5,h6,p,li,pre,blockquote,dt,dd,td,th,div,section,article,title,subtitle,v,stanza,poem,epigraph,figcaption';

export function paragraphsFromDom(root) {
  const out = [];
  root.querySelectorAll('script,style,noscript,nav,head').forEach((n) => n.remove());
  for (const el of root.querySelectorAll(BLOCKS)) {
    if (el.querySelector(BLOCKS)) continue; // keep only leaf blocks so nothing is counted twice
    const tag = el.localName.toLowerCase();
    const t = tag === 'pre' ? el.textContent.trim() : clean(el.textContent.replace(/\s+/g, ' '));
    if (!t) continue;
    const h = /^h[1-6]$/.test(tag) || el.closest('title') || (t.length < 80 && isHeadingLine(t)) ? 1 : 0;
    out.push({ t, h });
  }
  if (!out.length && root.textContent) return paragraphsFromText(root.textContent);
  return out;
}

function parseMarkup(str, type) {
  const doc = new DOMParser().parseFromString(str, type);
  if (doc.querySelector('parsererror') && type !== 'text/html') return new DOMParser().parseFromString(str, 'text/html');
  return doc;
}

// ---------- EPUB ----------

async function paragraphsFromEpub(file, progress) {
  await loadScript(JSZIP);
  const zip = await window.JSZip.loadAsync(await file.arrayBuffer());
  const container = parseMarkup(await zip.file('META-INF/container.xml').async('string'), 'application/xml');
  const opfPath = container.querySelector('rootfile').getAttribute('full-path');
  const base = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
  const opf = parseMarkup(await zip.file(opfPath).async('string'), 'application/xml');
  const manifest = {};
  for (const item of opf.querySelectorAll('manifest > item')) manifest[item.getAttribute('id')] = item.getAttribute('href');
  const spine = [...opf.querySelectorAll('spine > itemref')].map((r) => manifest[r.getAttribute('idref')]).filter(Boolean);
  const out = [];
  for (let i = 0; i < spine.length; i++) {
    const path = decodeURIComponent(base + spine[i]).replace(/[^/]+\/\.\.\//g, '');
    const entry = zip.file(path);
    if (!entry) continue;
    const doc = parseMarkup(await entry.async('string'), 'application/xhtml+xml');
    out.push(...paragraphsFromDom(doc.body || doc.documentElement));
    progress(`Reading chapter ${i + 1} / ${spine.length}`, (i + 1) / spine.length);
  }
  return out;
}

// ---------- DOCX ----------

async function paragraphsFromDocx(file) {
  await loadScript(MAMMOTH);
  const { value } = await window.mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() });
  return paragraphsFromDom(parseMarkup(value, 'text/html').body);
}

// ---------- PDF ----------

async function paragraphsFromPdf(file, progress) {
  const pdfjs = await import(PDFJS);
  pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
  const task = pdfjs.getDocument({ data: await file.arrayBuffer() });
  const pdf = await task.promise;
  const out = [];
  let open = ''; // paragraph carried over a page break

  const flush = () => {
    const t = clean(open);
    if (t) out.push({ t, h: t.length < 80 && isHeadingLine(t) ? 1 : 0 });
    open = '';
  };
  const append = (line) => {
    if (!open) open = line;
    else if (/[A-Za-zÀ-ÿ]-$/.test(open)) open = open.slice(0, -1) + line;
    else open += ' ' + line;
  };

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const { items } = await page.getTextContent();
    page.cleanup();

    // Group text runs into lines by baseline.
    const lines = [];
    let cur = null;
    for (const it of items) {
      if (!('str' in it)) continue;
      const x = it.transform[4], y = it.transform[5];
      if (!cur || Math.abs(y - cur.y) > Math.max(2, (it.height || 10) * 0.4)) {
        if (cur) lines.push(cur);
        cur = { x, y, s: '', size: it.height || 10 };
      }
      cur.s += it.str;
      if (it.hasEOL) { lines.push(cur); cur = null; }
    }
    if (cur) lines.push(cur);
    const real = lines.map((l) => ({ ...l, s: clean(l.s) })).filter((l) => l.s && !/^[-–—\s]*\d{1,4}[-–—\s]*$/.test(l.s));
    if (!real.length) continue;

    const gaps = [];
    for (let i = 1; i < real.length; i++) gaps.push(Math.abs(real[i - 1].y - real[i].y));
    const sorted = gaps.filter((g) => g > 0).sort((a, b) => a - b);
    const typical = sorted[Math.floor(sorted.length / 2)] || 12;
    const left = Math.min(...real.map((l) => l.x));

    for (let i = 0; i < real.length; i++) {
      const l = real[i];
      const gap = i ? Math.abs(real[i - 1].y - l.y) : 0;
      const indented = l.x > left + l.size * 1.2;
      const isHead = l.s.length < 80 && isHeadingLine(l.s);
      if (i === 0) {
        // Continue the previous page's paragraph unless it clearly ended.
        if (/[.!?:"”»)]$/.test(open) || indented || isHead) flush();
      } else if (gap > typical * 1.45 || indented || isHead) {
        flush();
      }
      append(l.s);
      if (isHead) flush();
    }
    if (p % 5 === 0 || p === pdf.numPages) {
      progress(`Reading page ${p} / ${pdf.numPages}`, p / pdf.numPages);
      await new Promise((r) => setTimeout(r)); // let the UI breathe on long books
    }
  }
  flush();
  task.destroy();
  return out;
}

// ---------- entry ----------

async function readText(file) {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf, 0, Math.min(4, buf.byteLength));
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(buf);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(buf);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder('windows-1252').decode(buf);
  }
}

// Same idea as stripGutenberg, for formats that arrive already split into paragraphs.
function trimBoilerplate(paras) {
  const s = paras.findIndex((p) => /\*\*\*\s*START OF (?:THE|THIS) PROJECT GUTENBERG/i.test(p.t));
  const e = paras.findIndex((p) => /\*\*\*\s*END OF (?:THE|THIS) PROJECT GUTENBERG/i.test(p.t));
  return s >= 0 && e > s ? paras.slice(s + 1, e) : paras;
}

export async function extract(file, progress = () => {}) {
  return trimBoilerplate(await extractRaw(file, progress));
}

async function extractRaw(file, progress) {
  const ext = (file.name.match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase();
  progress('Opening ' + file.name, 0);
  switch (ext) {
    case 'pdf': return paragraphsFromPdf(file, progress);
    case 'epub': return paragraphsFromEpub(file, progress);
    case 'docx': return paragraphsFromDocx(file);
    case 'html': case 'htm': case 'xhtml':
      return paragraphsFromDom(parseMarkup(await readText(file), 'text/html').body);
    case 'fb2':
      return paragraphsFromDom(parseMarkup(await readText(file), 'application/xml').documentElement);
    case 'srt': return paragraphsFromSrt(await readText(file));
    default: return paragraphsFromText(await readText(file));
  }
}

export const charCount = (paras) => paras.reduce((a, p) => a + p.t.length, 0);
