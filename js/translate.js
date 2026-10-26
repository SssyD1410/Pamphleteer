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
    ['ar', /[؀-ۿ]/g], ['he', /[֐-׿]/g], ['el', /[Ͱ-Ͽ]/g],
    ['hi', /[ऀ-ॿ]/g], ['ru', /[Ѐ-ӿ]/g],
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
    browser: 'Translator' in self,
    claude: true,
    mymemory: true,
  };
}

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

async function viaBrowser(paras, from, to, progress) {
  const availability = await Translator.availability({ sourceLanguage: from, targetLanguage: to });
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

async function viaClaude(paras, from, to, apiKey, progress) {
  const { default: Anthropic } = await import('https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@0.133.0/+esm');
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
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

export function translate(engine, paras, from, to, { apiKey, progress = () => {} } = {}) {
  if (engine === 'browser') return viaBrowser(paras, from, to, progress);
  if (engine === 'claude') return viaClaude(paras, from, to, apiKey, progress);
  return viaMyMemory(paras, from, to, progress);
}
