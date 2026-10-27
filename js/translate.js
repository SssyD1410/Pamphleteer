// Translation for short texts. Three engines, cheapest first:
//   browser  – Chrome's on-device Translator API (free, nothing leaves the machine)
//   claude   – Claude via the reader's own Anthropic API key (best quality)
//   mymemory – MyMemory's free public API (no key, ~5,000 characters a day)

export const TRANSLATE_LIMIT = 60000; // characters; larger works should be uploaded in both languages

export const LANGUAGES = {
  en: 'English', fr: 'French', de: 'German', es: 'Spanish', it: 'Italian', pt: 'Portuguese',
  nl: 'Dutch', sv: 'Swedish', pl: 'Polish', cs: 'Czech', ru: 'Russian', uk: 'Ukrainian',
  el: 'Greek', tr: 'Turkish', ar: 'Arabic', he: 'Hebrew', hi: 'Hindi', zh: 'Chinese',
  ja: 'Japanese', ko: 'Korean', la: 'Latin',
};

const STOPWORDS = {
  en: 'the and of to that is was he she it with for his her you not but',
  fr: 'le la les et des est une que qui dans pas pour elle il sur au du',
  de: 'der die das und ist nicht sie ein eine zu mit sich den auf ich es',
  es: 'el la los las y que de en un una es por con se del no su',
  it: 'il la le e che di un una per non sono con del della si è',
  pt: 'o a os as e que de em um uma não por com do da se é',
  nl: 'de het een en van is dat niet ik zij op te met zijn er',
  sv: 'och att det som en är på av för med inte jag han hon till',
  pl: 'i w nie na się że to z jest do jak co ale o tak',
  cs: 'a se na je že to v s z do by jak ale jsem si',
  la: 'et in est non ad cum quod qui sed ut esse enim',
  tr: 've bir bu da de için ile ne çok gibi ama o ben',
};

export function guessLanguage(sample) {
  const s = sample.slice(0, 20000);
  const scripts = [
    ['ja', /[぀-ヿ]/g], ['ko', /[가-힯]/g], ['zh', /[一-鿿]/g],
    ['ar', /[\u0600-ۿ]/g], ['he', /[֐-׿]/g], ['el', /[Ͱ-Ͽ]/g],
    ['hi', /[\u0900-ॿ]/g], ['ru', /[Ѐ-ӿ]/g],
  ];
  for (const [code, re] of scripts) if ((s.match(re) || []).length > s.length * 0.15) {
    if (code === 'ru' && /[їєі]/i.test(s)) return 'uk';
    return code;
  }
  const words = s.toLowerCase().match(/[\p{L}']+/gu) || [];
  let best = 'en', top = 0;
  for (const [code, list] of Object.entries(STOPWORDS)) {
    const set = new Set(list.split(' '));
    const score = words.reduce((a, w) => a + set.has(w), 0);
    if (score > top) { top = score; best = code; }
  }
  return best;
}

export function engines() {
  return {
    google: true,
    claude: true,
    browser: 'Translator' in self,
    mymemory: true,
  };
}

// ---------- API keys (the reader's own; sent only to the provider they belong to) ----------

const KEY_STORE = 'pamphleteer.keys';
export const keys = { google: '', claude: '', remember: false };
try {
  Object.assign(keys, JSON.parse(localStorage.getItem(KEY_STORE) || '{}'));
} catch { /* storage blocked */ }

export function setKeys(next) {
  Object.assign(keys, next);
  try {
    if (keys.remember) localStorage.setItem(KEY_STORE, JSON.stringify(keys));
    else localStorage.removeItem(KEY_STORE);
  } catch { /* storage blocked */ }
  wordCache.clear();
}

// The best engine available for the reader's word lookups.
export function wordEngine() {
  if (keys.claude) return 'claude';
  if (keys.google) return 'google';
  return 'free';
}

export const ENGINE_NAMES = {
  claude: 'Claude, reading the whole sentence',
  google: 'Google Translate',
  free: 'free engines (basic quality)',
};

// Packs paragraphs into batches so each request stays small.
function batches(paras, maxChars) {
  const out = [];
  let cur = [], size = 0;
  for (const p of paras) {
    if (cur.length && size + p.t.length > maxChars) { out.push(cur); cur = []; size = 0; }
    cur.push(p); size += p.t.length;
  }
  if (cur.length) out.push(cur);
  return out;
}

const withTimeout = (promise, ms) => Promise.race([
  promise,
  new Promise((_, reject) => setTimeout(() => reject(new Error('timed out')), ms)),
]);

async function viaBrowser(paras, from, to, progress) {
  const availability = await withTimeout(Translator.availability({ sourceLanguage: from, targetLanguage: to }), 5000)
    .catch(() => { throw new Error('Your browser’s built-in translator is not responding. Pick another engine.'); });
  if (availability === 'unavailable') throw new Error(`Your browser can't translate ${LANGUAGES[from]} → ${LANGUAGES[to]} on-device.`);
  const t = await Translator.create({
    sourceLanguage: from,
    targetLanguage: to,
    monitor(m) { m.addEventListener('downloadprogress', (e) => progress('Downloading language model', e.loaded)); },
  });
  const out = [];
  for (let i = 0; i < paras.length; i++) {
    out.push({ t: await t.translate(paras[i].t), h: paras[i].h });
    progress(`Translating paragraph ${i + 1} / ${paras.length}`, (i + 1) / paras.length);
  }
  t.destroy?.();
  return out;
}

let claudeClient = null;
async function claude(apiKey) {
  if (claudeClient?.apiKey !== apiKey) {
    const { default: Anthropic } = await import('https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@0.133.0/+esm');
    claudeClient = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  }
  return claudeClient;
}

// Google Cloud Translation (v2) with the reader's API key, sent as a header rather than in the URL.
async function google(texts, from, to, apiKey) {
  const res = await fetch('https://translation.googleapis.com/language/translate/v2', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': apiKey },
    body: JSON.stringify({ q: texts, source: from, target: to, format: 'text' }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error('Google Translate: ' + (data.error?.message || `HTTP ${res.status}`));
  return data.data.translations.map((t) => t.translatedText);
}

async function viaGoogle(paras, from, to, apiKey, progress) {
  if (!apiKey) throw new Error('Add a Google Cloud API key first.');
  const out = [];
  // Google suggests at most ~5,000 characters and 128 segments per request.
  const groups = batches(paras, 5000).flatMap((g) => {
    const parts = [];
    for (let i = 0; i < g.length; i += 100) parts.push(g.slice(i, i + 100));
    return parts;
  });
  for (const group of groups) {
    const list = await google(group.map((p) => p.t), from, to, apiKey);
    group.forEach((p, k) => out.push({ t: list[k] ?? '', h: p.h }));
    progress(`Translated ${out.length} / ${paras.length} paragraphs`, out.length / paras.length);
  }
  return out;
}

async function viaClaude(paras, from, to, apiKey, progress) {
  if (!apiKey) throw new Error('Add an Anthropic API key first.');
  const client = await claude(apiKey);
  const out = [];
  const groups = batches(paras, 8000);
  for (let g = 0; g < groups.length; g++) {
    const group = groups[g];
    const response = await client.beta.messages.create({
      model: 'claude-opus-5-5',
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: {
        effort: 'low',
        format: {
          type: 'json_schema',
          schema: {
            type: 'object',
            properties: { translations: { type: 'array', items: { type: 'string' } } },
            required: ['translations'],
            additionalProperties: false,
          },
        },
      },
      system: `You are a literary translator. Translate each paragraph from ${from === 'auto' ? 'its source language' : LANGUAGES[from]} into ${LANGUAGES[to]}, faithfully and in a natural literary register. Return exactly one translation per input paragraph, in the same order.`,
      messages: [{ role: 'user', content: JSON.stringify(group.map((p) => p.t)) }],
    });
    if (response.stop_reason === 'refusal') throw new Error('Claude declined to translate part of this text.');
    if (response.stop_reason === 'max_tokens') throw new Error('A translation batch was cut off; try a shorter text.');
    const text = response.content.find((b) => b.type === 'text')?.text || '{}';
    const list = JSON.parse(text).translations || [];
    group.forEach((p, k) => out.push({ t: list[k] ?? '', h: p.h }));
    progress(`Translated ${out.length} / ${paras.length} paragraphs`, out.length / paras.length);
  }
  return out;
}

async function viaMyMemory(paras, from, to, progress) {
  const out = [];
  for (let i = 0; i < paras.length; i++) {
    // MyMemory accepts ~500 bytes per request, so split long paragraphs on sentence ends.
    const pieces = paras[i].t.match(/[^.!?。！？]+[.!?。！？]*\s*/g) || [paras[i].t];
    const chunks = [];
    let cur = '';
    for (const s of pieces) {
      if (cur && new Blob([cur + s]).size > 450) { chunks.push(cur); cur = ''; }
      cur += s;
    }
    if (cur) chunks.push(cur);
    const done = [];
    for (const c of chunks) {
      const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(c)}&langpair=${from}|${to}`;
      const res = await fetch(url).then((r) => r.json());
      if (res.responseStatus !== 200 && res.responseStatus !== '200') throw new Error('MyMemory: ' + (res.responseDetails || 'request failed'));
      done.push(res.responseData.translatedText);
    }
    out.push({ t: done.join(' '), h: paras[i].h });
    progress(`Translating paragraph ${i + 1} / ${paras.length}`, (i + 1) / paras.length);
  }
  return out;
}

// ---------- single words, for the reader's hover gloss and dictionary ----------

const wordCache = new Map();
const translators = new Map();
let builtInStalled = false; // some browsers expose the API but never answer

async function browserTranslator(from, to, allowDownload) {
  if (!('Translator' in self) || builtInStalled) return null;
  const key = from + '>' + to;
  if (translators.has(key)) return translators.get(key);
  const availability = await withTimeout(Translator.availability({ sourceLanguage: from, targetLanguage: to }), 2000)
    .catch(() => { builtInStalled = true; return 'unavailable'; });
  // Downloading a language pack needs a click, so a hover only uses packs already installed.
  if (availability === 'unavailable' || (availability !== 'available' && !allowDownload)) return null;
  const t = withTimeout(Translator.create({ sourceLanguage: from, targetLanguage: to }), allowDownload ? 20000 : 3000)
    .catch(() => { translators.delete(key); builtInStalled = true; return null; });
  translators.set(key, t);
  return t;
}

// Claude reads the whole sentence, so it can pick the sense the word has here
// (the bank of a river, not of money) and name its dictionary form.
async function claudeWord(word, context, from, to) {
  const client = await claude(keys.claude);
  const src = LANGUAGES[from] || from, dst = LANGUAGES[to] || to;
  const response = await client.beta.messages.create({
    model: 'claude-opus-5-5',
    max_tokens: 1024,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: {
      effort: 'low',
      format: {
        type: 'json_schema',
        schema: {
          type: 'object',
          properties: {
            translation: { type: 'string' },
            lemma: { type: 'string' },
            note: { type: 'string' },
          },
          required: ['translation', 'lemma', 'note'],
          additionalProperties: false,
        },
      },
    },
    system: `You are a bilingual dictionary for a reader of ${src} literature. You get a word and the sentence it appears in. Return "translation": the ${dst} word or short phrase that best renders it in this sentence (1 to 4 words); "lemma": its dictionary form in ${src}; "note": one short ${dst} sentence on its sense or grammar here (tense, case, idiom), or an empty string if there is nothing useful to add.`,
    messages: [{ role: 'user', content: JSON.stringify({ word, sentence: context || word }) }],
  });
  if (response.stop_reason !== 'end_turn') throw new Error('Claude did not finish');
  const r = JSON.parse(response.content.find((blk) => blk.type === 'text')?.text || '{}');
  return { text: r.translation || '', lemma: r.lemma || '', note: r.note || '', via: 'claude' };
}

async function freeWord(word, from, to, allowDownload) {
  try {
    const t = await browserTranslator(from, to, allowDownload);
    if (t) return { text: await withTimeout(t.translate(word), 4000), via: 'browser' };
  } catch { builtInStalled = true; /* fall through to MyMemory */ }
  const res = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(word)}&langpair=${from}|${to}`).then((r) => r.json());
  return { text: String(res.responseStatus) === '200' ? res.responseData.translatedText : '', via: 'mymemory' };
}

// One word as used in `context` (its sentence): { text, lemma?, note?, via }.
export function translateWord(word, from, to, { context = '', allowDownload = false } = {}) {
  const engine = wordEngine();
  const key = `${engine}|${from}>${to}:${word.toLowerCase()}` + (engine === 'claude' ? '|' + context : '');
  if (wordCache.has(key)) return wordCache.get(key);
  const job = (async () => {
    if (engine === 'claude') {
      try { return await claudeWord(word, context, from, to); } catch { /* fall back below */ }
    }
    if (keys.google) {
      try { return { text: (await google([word], from, to, keys.google))[0], via: 'google' }; } catch { /* fall back */ }
    }
    return freeWord(word, from, to, allowDownload);
  })().catch(() => ({ text: '', via: 'none' }));
  wordCache.set(key, job);
  return job;
}

export function translate(engine, paras, from, to, { progress = () => {} } = {}) {
  if (engine === 'browser') return viaBrowser(paras, from, to, progress);
  if (engine === 'google') return viaGoogle(paras, from, to, keys.google, progress);
  if (engine === 'claude') return viaClaude(paras, from, to, keys.claude, progress);
  return viaMyMemory(paras, from, to, progress);
}
