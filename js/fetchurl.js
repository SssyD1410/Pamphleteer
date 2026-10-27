// Import an article or book from a link. A web page cannot read other sites unless they
// allow it (CORS), so links are tried in this order:
//   1. Wikipedia, Wikisource and other Wikimedia sites, through their open API
//   2. the site itself, when it allows reading from other pages
//   3. the free r.jina.ai reader, which fetches the page on our behalf
// Web pages are then cut down to the article itself with Mozilla's Readability
// (the engine behind Firefox's Reader View), so menus, ads and comments are left out.

import { extract, paragraphsFromDom, paragraphsFromText } from './extract.js';

const READABILITY = 'https://cdn.jsdelivr.net/npm/@mozilla/readability@0.6.0/+esm';
const READER = 'https://r.jina.ai/';
export const READER_NAME = 'r.jina.ai';

export function normalizeUrl(raw) {
  let s = raw.trim();
  if (!s) throw new Error('Paste a link first.');
  if (/\s/.test(s)) throw new Error('That doesn’t look like a link. Copy it from the browser’s address bar.');
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  const url = new URL(s); // throws on nonsense
  if (!/^https?:$/.test(url.protocol)) throw new Error('Only http and https links can be read.');
  if (!url.hostname.includes('.')) throw new Error('That doesn’t look like a link. Copy it from the browser’s address bar.');
  return url;
}

// ---------- Wikimedia ----------

const WIKI = /^([a-z][a-z-]*)\.(?:m\.)?(wikipedia|wikisource|wikibooks|wikinews|wikivoyage)\.org$/i;

async function fromWikimedia(url) {
  const host = url.hostname.match(WIKI);
  const m = url.pathname.match(/^\/wiki\/(.+)$/);
  if (!host || !m) return null;
  const [, lang, project] = host;
  const title = decodeURIComponent(m[1]);
  const res = await fetch(`https://${lang}.${project}.org/api/rest_v1/page/html/${encodeURIComponent(title)}?redirect=true`);
  if (!res.ok) throw new Error(`${project[0].toUpperCase() + project.slice(1)} has no page “${title.replace(/_/g, ' ')}”.`);
  const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
  // Keep the prose: drop references, infoboxes, tables, image captions and edit links,
  // and the closing sections that are lists of sources rather than text.
  doc.querySelectorAll('sup.reference, .mw-ref, .reference, .reflist, .references, .infobox, .navbox, .vertical-navbox, '
    + 'table, figure, .thumb, .gallery, .hatnote, .mw-editsection, .noprint, .metadata, style, link, [role=note], .ws-noexport')
    .forEach((n) => n.remove());
  const endings = /^(references|notes|external links|see also|further reading|bibliography|sources|footnotes|citations|notes and references|références|notes et références|liens externes|voir aussi|bibliographie|einzelnachweise|weblinks|literatur|siehe auch|anmerkungen|referencias|enlaces externos|véase también|bibliografía|note|bibliografia|collegamenti esterni|voci correlate|参考文献|外部链接|外部連結|参见|脚注|関連項目|外部リンク|примечания|литература|ссылки|см\. также)$/i;
  for (const h of doc.querySelectorAll('h2')) {
    if (endings.test(h.textContent.trim())) (h.closest('section') || h).remove();
  }
  const paras = paragraphsFromDom(doc.body);
  const name = doc.querySelector('title')?.textContent || title.replace(/_/g, ' ');
  return { paras: [{ t: name, h: 1 }, ...paras], title: name, lang, via: project[0].toUpperCase() + project.slice(1) };
}

// ---------- general pages ----------

async function article(html, url) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const base = doc.createElement('base');
  base.href = url.href;
  doc.head?.prepend(base);
  const lang = (doc.documentElement.lang || '').slice(0, 2).toLowerCase();
  const { Readability } = await import(READABILITY);
  const found = new Readability(doc.cloneNode(true)).parse();
  if (found?.content && found.textContent.trim().length > 200) {
    const body = new DOMParser().parseFromString(found.content, 'text/html').body;
    const paras = paragraphsFromDom(body);
    const title = (found.title || doc.title || url.hostname).trim();
    // Start with the headline unless the article body already does.
    if (paras.length && paras[0].t !== title) paras.unshift({ t: title, h: 1 });
    return { paras, title, lang: found.lang?.slice(0, 2).toLowerCase() || lang };
  }
  // Not an article page (a book in HTML, a plain document): take all of it.
  return { paras: paragraphsFromDom(doc.body), title: (doc.title || url.hostname).trim(), lang };
}

const fileName = (url, type) => {
  const last = decodeURIComponent(url.pathname.split('/').filter(Boolean).pop() || url.hostname);
  const ext = { 'application/pdf': '.pdf', 'application/epub+zip': '.epub', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx', 'text/plain': '.txt' }[type] || '';
  return /\.[a-z0-9]{2,5}$/i.test(last) ? last : last + ext;
};

// A response that is a whole file (PDF, EPUB, Word, plain text) goes through the file readers.
async function fromResponse(res, url, progress) {
  const type = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  const isFile = /pdf|epub|officedocument|msword|octet-stream/.test(type) || /\.(pdf|epub|docx|txt|fb2|srt|md)$/i.test(url.pathname);
  if (isFile) {
    const blob = await res.blob();
    const name = fileName(url, type);
    const paras = await extract(new File([blob], name), progress);
    const own = type === 'text/plain' ? (await blob.text()).slice(0, 5000).match(/^Title:[ \t]*(\S.*)$/m)?.[1].trim() : '';
    return { paras, title: own || name.replace(/\.[^.]+$/, ''), lang: '' };
  }
  return article(await res.text(), url);
}

async function fromSite(url, progress) {
  let res;
  try {
    res = await fetch(url.href, { mode: 'cors', credentials: 'omit' });
  } catch {
    return null; // the site does not allow reading from other pages
  }
  if (!res.ok) throw new Error(`The site answered “${res.status} ${res.statusText}”. Check the link.`);
  return { ...(await fromResponse(res, url, progress)), via: url.hostname };
}

async function fromReader(url, progress) {
  progress(`Fetching through ${READER_NAME}…`);
  // Plain-text books come back as text; web pages as HTML for Readability to clean up.
  const plain = /\.txt$/i.test(url.pathname);
  const res = await fetch(READER + url.href, { headers: { 'X-Return-Format': plain ? 'text' : 'html' } });
  if (res.status === 429) throw new Error(`${READER_NAME} is busy (it allows 20 links a minute). Wait a moment and try again.`);
  if (!res.ok) throw new Error(`${READER_NAME} could not read that page (${res.status}).`);
  const body = await res.text();
  if (plain) {
    const text = body.replace(/^Title:[\s\S]*?\n(?:Markdown|Text) Content:\n/, '');
    const name = text.match(/^Title:[ \t]*(\S.*)$/m)?.[1].trim() || fileName(url, 'text/plain').replace(/\.[^.]+$/, '');
    return { paras: paragraphsFromText(text), title: name, lang: '', via: READER_NAME };
  }
  return { ...(await article(body, url)), via: READER_NAME };
}

// Returns { paras, title, lang, via }. `allowReader` permits the third-party fallback.
export async function importLink(raw, { allowReader = true, progress = () => {} } = {}) {
  const url = normalizeUrl(raw);
  progress('Fetching ' + url.hostname + '…');
  const result = (await fromWikimedia(url)) || (await fromSite(url, progress))
    || (allowReader ? await fromReader(url, progress) : null);
  if (!result) throw new Error(`${url.hostname} doesn’t let other pages read it. Allow the ${READER_NAME} reader, or save the page and upload the file.`);
  if (!result.paras.length) throw new Error('No readable text found at that link.');
  return result;
}
