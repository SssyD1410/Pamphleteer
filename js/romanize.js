// Reading aids: pronunciation shown above the text (ruby) for languages in other scripts.
//   Chinese  – pinyin, by word, with tones (pinyin-pro handles characters with several readings)
//   Japanese – furigana (hiragana over kanji) or romaji, from the kuromoji dictionary
//   Korean, Russian, Ukrainian, Greek, Arabic, Hebrew, Hindi – romanization by rule (below)
// Libraries load only when an aid is first used. Annotation runs on the rows being drawn.

const PINYIN = 'https://cdn.jsdelivr.net/npm/pinyin-pro@3.29.5/dist/index.js';
const WANAKANA = 'https://cdn.jsdelivr.net/npm/wanakana@5.3.1/wanakana.min.js';
const KUROMOJI = 'https://cdn.jsdelivr.net/npm/kuromoji@0.1.2/build/kuromoji.js';
const KUROMOJI_DICT = 'https://cdn.jsdelivr.net/npm/kuromoji@0.1.2/dict/';

// Which aids each language offers: [mode, label].
export const AIDS = {
  zh: [['pinyin', 'Pinyin']],
  ja: [['furigana', 'Furigana'], ['romaji', 'Romaji']],
  ko: [['roman', 'Romanization (RR)']],
  ru: [['roman', 'Latin letters']],
  uk: [['roman', 'Latin letters']],
  el: [['roman', 'Latin letters']],
  ar: [['roman', 'Transliteration']],
  he: [['roman', 'Transliteration']],
  hi: [['roman', 'IAST transliteration']],
};
export const RTL = new Set(['ar', 'he']);

// ---------- loading ----------

const scripts = {};
const loadScript = (src) => (scripts[src] ||= new Promise((resolve, reject) => {
  const s = document.createElement('script');
  s.src = src;
  s.onload = resolve;
  s.onerror = () => reject(new Error('Could not load ' + src));
  document.head.appendChild(s);
}));

let tokenizer = null;
let tokenizerJob = null;
function loadTokenizer() {
  return (tokenizerJob ||= Promise.all([loadScript(KUROMOJI), loadScript(WANAKANA)]).then(() => new Promise((resolve, reject) => {
    window.kuromoji.builder({ dicPath: KUROMOJI_DICT }).build((err, t) => {
      if (err) { tokenizerJob = null; reject(err); } else { tokenizer = t; resolve(t); }
    });
  })));
}

// Make sure everything an aid needs is loaded. Resolves when annotate() can run.
export async function prepare(lang) {
  if (lang === 'zh') await loadScript(PINYIN);
  if (lang === 'ja') await loadTokenizer();
}
export const ready = (lang) => (lang === 'zh' ? !!window.pinyinPro : lang === 'ja' ? !!tokenizer : true);

// ---------- rule-based romanization ----------

// Korean: Revised Romanization, syllable by syllable, with the common linking rules.
const KO_INITIAL = ['g', 'kk', 'n', 'd', 'tt', 'r', 'm', 'b', 'pp', 's', 'ss', '', 'j', 'jj', 'ch', 'k', 't', 'p', 'h'];
const KO_VOWEL = ['a', 'ae', 'ya', 'yae', 'eo', 'e', 'yeo', 'ye', 'o', 'wa', 'wae', 'oe', 'yo', 'u', 'wo', 'we', 'wi', 'yu', 'eu', 'ui', 'i'];
const KO_FINAL = ['', 'k', 'k', 'k', 'n', 'n', 'n', 't', 'l', 'k', 'm', 'l', 'l', 'l', 'p', 'l', 'm', 'p', 'p', 't', 't', 'ng', 't', 't', 'k', 't', 'p', 't'];
// A final consonant carried over to a following vowel keeps its full sound.
const KO_LINKED = ['', 'g', 'kk', 'ks', 'n', 'nj', 'n', 'd', 'r', 'lg', 'lm', 'lb', 'ls', 'lt', 'lp', 'r', 'm', 'b', 'ps', 's', 'ss', 'ng', 'j', 'ch', 'k', 't', 'p', ''];
function romanizeKorean(word) {
  const syl = [...word].map((ch) => {
    const c = ch.codePointAt(0) - 0xac00;
    return c >= 0 && c < 11172 ? { l: Math.floor(c / 588), v: Math.floor((c % 588) / 28), t: c % 28 } : { ch };
  });
  let out = '';
  syl.forEach((s, i) => {
    if (s.ch) { out += s.ch; return; }
    const prev = syl[i - 1], next = syl[i + 1];
    let initial = KO_INITIAL[s.l];
    if (prev && !prev.ch && prev.t && s.l === 11) initial = ''; // vowel-initial: the previous final links over
    if (prev && !prev.ch && prev.t === 8 && s.l === 5) initial = 'l'; // ㄹ + ㄹ → ll
    let final = KO_FINAL[s.t];
    if (s.t && next && !next.ch && next.l === 11) final = KO_LINKED[s.t];
    else if (next && !next.ch && (next.l === 2 || next.l === 6)) final = { k: 'ng', t: 'n', p: 'm' }[final] ?? final; // 합니다 → hamnida
    out += initial + KO_VOWEL[s.v] + final;
  });
  return out;
}

const keepCase = (src, lat) => (src !== src.toLowerCase() && lat ? lat[0].toUpperCase() + lat.slice(1) : lat);

// Russian and Ukrainian: a simple, readable transliteration (close to BGN/PCGN).
const RU = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch', ъ: 'ʺ', ы: 'y', ь: 'ʹ', э: 'e', ю: 'yu', я: 'ya' };
const UK = { ...RU, г: 'h', ґ: 'g', е: 'e', є: 'ye', и: 'y', і: 'i', ї: 'yi', ь: 'ʹ' };
function romanizeCyrillic(word, table) {
  let out = '';
  for (const ch of word) {
    const low = ch.toLowerCase();
    out += low in table ? keepCase(ch, table[low]) : ch;
  }
  return out;
}

// Greek: ELOT 743 style, keeping the stress accent on the Latin vowel.
const EL_PAIRS = { ου: 'ou', αι: 'ai', ει: 'ei', οι: 'oi', μπ: 'b', ντ: 'nt', γκ: 'gk', γγ: 'ng', γχ: 'nch', γξ: 'nx', αυ: 'av', ευ: 'ev', ηυ: 'iv' };
const EL = { α: 'a', β: 'v', γ: 'g', δ: 'd', ε: 'e', ζ: 'z', η: 'i', θ: 'th', ι: 'i', κ: 'k', λ: 'l', μ: 'm', ν: 'n', ξ: 'x', ο: 'o', π: 'p', ρ: 'r', σ: 's', ς: 's', τ: 't', υ: 'y', φ: 'f', χ: 'ch', ψ: 'ps', ω: 'o' };
function romanizeGreek(word) {
  const base = word.normalize('NFD');
  let out = '';
  for (let i = 0; i < base.length;) {
    const ch = base[i];
    if (/[\u0300-\u036f]/.test(ch)) { if (ch === '\u0301') out += '\u0301'; i++; continue; }
    // Digraphs (an accent may sit between the two letters: ού = ο + υ + \u0301)
    const pair = (ch + (base[i + 1] || '')).toLowerCase();
    if (EL_PAIRS[pair]) {
      let lat = EL_PAIRS[pair];
      // αυ, ευ, ηυ sound f before a voiceless consonant or at the end: ευχαριστώ → efcharistó
      if (/^[aei]v$/.test(lat)) {
        let j = i + 2;
        while (/[\u0300-\u036f]/.test(base[j] || '')) j++;
        if (!base[j] || /[θκξπστφχψς]/i.test(base[j])) lat = lat[0] + 'f';
      }
      out += keepCase(ch, lat);
      i += 2;
      continue;
    }
    const low = ch.toLowerCase();
    out += low in EL ? keepCase(ch, EL[low]) : ch;
    i++;
  }
  return out.normalize('NFC');
}

// Arabic: consonants plus any short-vowel marks present. Unvowelled text gives an approximation.
const AR = { ا: 'ā', أ: 'ʾa', إ: 'ʾi', آ: 'ʾā', ء: 'ʾ', ؤ: 'ʾ', ئ: 'ʾ', ب: 'b', ت: 't', ث: 'th', ج: 'j', ح: 'ḥ', خ: 'kh', د: 'd', ذ: 'dh', ر: 'r', ز: 'z', س: 's', ش: 'sh', ص: 'ṣ', ض: 'ḍ', ط: 'ṭ', ظ: 'ẓ', ع: 'ʿ', غ: 'gh', ف: 'f', ق: 'q', ك: 'k', ل: 'l', م: 'm', ن: 'n', ه: 'h', ة: 'a', ى: 'ā', پ: 'p', چ: 'ch', گ: 'g', ک: 'k', ی: 'y' };
const AR_MARKS = { '\u064e': 'a', '\u0650': 'i', '\u064f': 'u', '\u064b': 'an', '\u064d': 'in', '\u064c': 'un', '\u0652': '', '\u0670': 'ā' };
function romanizeArabic(word) {
  let out = '';
  const chars = [...word];
  chars.forEach((ch, i) => {
    // Shadda doubles the consonant, even when a vowel mark came first: س\u064e\u0651 → ssa
    if (ch === '\u0651') {
      const m = out.match(/(sh|th|kh|dh|gh|[bdfhjklmnqrstwyzʾʿḥṣḍṭẓ])([aiuā]*)$/);
      if (m) out = out.slice(0, -m[0].length) + m[1] + m[1] + m[2];
      return;
    }
    if (ch in AR_MARKS) { out += AR_MARKS[ch]; return; }
    // A short vowel mark followed by its long letter is one long vowel: ك\u0650ت\u064eاب → kitāb
    if (ch === 'ا' && /a$/.test(out)) { out = out.slice(0, -1) + 'ā'; return; }
    if (ch === 'و' && /u$/.test(out)) { out = out.slice(0, -1) + 'ū'; return; }
    if (ch === 'ي' && /i$/.test(out)) { out = out.slice(0, -1) + 'ī'; return; }
    if (ch === 'و') { out += i === 0 || /[aiāī]$/.test(out) ? 'w' : 'ū'; return; }
    if (ch === 'ي') { out += i === 0 || /[auāū]$/.test(out) ? 'y' : 'ī'; return; }
    if (ch === 'ا' && i === 0) { out += 'a'; return; }
    out += AR[ch] ?? ch;
  });
  // The article: al-kitāb, but before a "sun letter" it assimilates: as-salām.
  const sun = out.match(/^al(sh|th|dh|[tdrzsṣḍṭẓln])\1/);
  if (sun) return `a${sun[1]}-${out.slice(2 + sun[1].length)}`;
  return out.replace(/^al(?=.)/, 'al-');
}

// Hebrew: consonants and any vowel points present (Modern Israeli pronunciation).
const HE = { א: 'ʾ', ב: 'v', ג: 'g', ד: 'd', ה: 'h', ו: 'v', ז: 'z', ח: 'ch', ט: 't', י: 'y', כ: 'kh', ך: 'kh', ל: 'l', מ: 'm', ם: 'm', נ: 'n', ן: 'n', ס: 's', ע: 'ʿ', פ: 'f', ף: 'f', צ: 'ts', ץ: 'ts', ק: 'k', ר: 'r', ש: 'sh', ת: 't' };
const HE_HARD = { ב: 'b', כ: 'k', פ: 'p' }; // with a dagesh dot
const HE_POINTS = { '\u05b7': 'a', '\u05b8': 'a', '\u05b2': 'a', '\u05b6': 'e', '\u05b5': 'e', '\u05b1': 'e', '\u05b4': 'i', '\u05b9': 'o', '\u05b3': 'o', '\u05bb': 'u', '\u05b0': 'e' };
function romanizeHebrew(word) {
  const chars = [...word];
  const pointed = chars.some((c) => c in HE_POINTS);
  let out = '';
  chars.forEach((ch, i) => {
    if (ch === '\u05bc' || ch === '\u05c1') return;
    if (ch === '\u05c2') { out = out.replace(/sh$/, 's'); return; }
    if (ch in HE_POINTS) { out += ch === '\u05b0' && i === chars.length - 1 ? '' : HE_POINTS[ch]; return; }
    const dagesh = chars[i + 1] === '\u05bc' || chars[i + 2] === '\u05bc';
    if (ch === 'ו' && (chars[i + 1] === '\u05b9' || (dagesh && !/[aeiou]$/.test(out) && i > 0))) { out += chars[i + 1] === '\u05b9' ? '' : 'u'; return; }
    if (!pointed && ch === 'ו' && i > 0) { out += 'o'; return; }
    if (!pointed && ch === 'י' && i > 0 && i < chars.length - 1) { out += 'i'; return; }
    out += (dagesh && HE_HARD[ch]) || (HE[ch] ?? ch);
  });
  return out.replace(/^ʾ/, '');
}

// Hindi: Devanagari to IAST, dropping the silent final a (kamal, not kamala).
const HI_CONS = { क: 'k', ख: 'kh', ग: 'g', घ: 'gh', ङ: 'ṅ', च: 'c', छ: 'ch', ज: 'j', झ: 'jh', ञ: 'ñ', ट: 'ṭ', ठ: 'ṭh', ड: 'ḍ', ढ: 'ḍh', ण: 'ṇ', त: 't', थ: 'th', द: 'd', ध: 'dh', न: 'n', प: 'p', फ: 'ph', ब: 'b', भ: 'bh', म: 'm', य: 'y', र: 'r', ल: 'l', व: 'v', श: 'ś', ष: 'ṣ', स: 's', ह: 'h' };
const HI_NUKTA = { क: 'q', ख: 'x', ग: 'ġ', ज: 'z', ड: 'ṛ', ढ: 'ṛh', फ: 'f' };
const HI_VOWEL = { अ: 'a', आ: 'ā', इ: 'i', ई: 'ī', उ: 'u', ऊ: 'ū', ऋ: 'r\u0325', ए: 'e', ऐ: 'ai', ओ: 'o', औ: 'au', ऑ: 'ŏ' };
const HI_SIGN = { 'ा': 'ā', 'ि': 'i', 'ी': 'ī', '\u0941': 'u', '\u0942': 'ū', '\u0943': 'r\u0325', '\u0947': 'e', '\u0948': 'ai', 'ो': 'o', 'ौ': 'au', 'ॉ': 'ŏ' };
function romanizeHindi(word) {
  const chars = [...word];
  let out = '';
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (ch in HI_CONS) {
      const nukta = chars[i + 1] === '\u093c';
      out += nukta ? HI_NUKTA[ch] || HI_CONS[ch] : HI_CONS[ch];
      const after = chars[i + 1 + (nukta ? 1 : 0)];
      if (after === '\u094d') i += 1 + (nukta ? 1 : 0); // no vowel
      else if (after in HI_SIGN) { out += HI_SIGN[after]; i += 1 + (nukta ? 1 : 0); }
      else { out += 'a'; if (nukta) i++; }
      continue;
    }
    if (ch in HI_VOWEL) { out += HI_VOWEL[ch]; continue; }
    if (ch === '\u0902') { out += 'ṃ'; continue; }
    if (ch === '\u0901') { out += 'ṁ'; continue; }
    if (ch === 'ः') { out += 'ḥ'; continue; }
    out += ch;
  }
  // Hindi drops the inherent a at the end of a word (but not after a consonant cluster).
  return out.replace(/([^aāiīuūeo])a$/, (m, c) => (chars.length > 2 ? c : m));
}

// ---------- Chinese and Japanese ----------

const kataToHira = (s) => s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
const HAS_KANJI = /[㐀-鿿\uf900-\ufaff]/;
const HAS_HAN = /\p{Script=Han}/u;

function pinyinOf(word) {
  return window.pinyinPro.pinyin(word, { nonZh: 'consecutive' }).replace(/\s+/g, '');
}

// Japanese tokens with their reading; particles read as spoken (は → wa).
function japaneseTokens(text) {
  return tokenizer.tokenize(text).map((t) => {
    let reading = t.reading && t.reading !== '*' ? kataToHira(t.reading) : '';
    if (t.pos === '助詞' && { は: 'わ', へ: 'え' }[t.surface_form]) reading = { は: 'わ', へ: 'え' }[t.surface_form];
    return { surface: t.surface_form, reading };
  });
}

// Furigana only over the kanji: 食べる → 食(た)べる, keeping the kana outside the ruby.
function furigana(surface, reading) {
  if (!reading || !HAS_KANJI.test(surface)) return esc(surface);
  let s = surface, r = reading, head = '', tail = '';
  while (s && r && !HAS_KANJI.test(s.at(-1)) && kataToHira(s.at(-1)) === r.at(-1)) { tail = s.at(-1) + tail; s = s.slice(0, -1); r = r.slice(0, -1); }
  while (s && r && !HAS_KANJI.test(s[0]) && kataToHira(s[0]) === r[0]) { head += s[0]; s = s.slice(1); r = r.slice(1); }
  return esc(head) + (s ? `<ruby>${esc(s)}<rt>${esc(r)}</rt></ruby>` : '') + esc(tail);
}

// ---------- public API ----------

const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const segmenters = {};
const words = (lang, text) => (segmenters[lang] ||= new Intl.Segmenter(lang, { granularity: 'word' })).segment(text);

// Romanization of one word, or '' when there is nothing to add.
export function romanizeWord(word, lang) {
  switch (lang) {
    case 'zh': return window.pinyinPro && HAS_HAN.test(word) ? pinyinOf(word) : '';
    case 'ja': {
      if (tokenizer) return window.wanakana.toRomaji(japaneseTokens(word).map((t) => t.reading || t.surface).join(''));
      return window.wanakana && window.wanakana.isKana(word) ? window.wanakana.toRomaji(word) : '';
    }
    case 'ko': return /[가-힣]/.test(word) ? romanizeKorean(word) : '';
    case 'ru': return /[Ѐ-ӿ]/.test(word) ? romanizeCyrillic(word, RU) : '';
    case 'uk': return /[Ѐ-ӿ]/.test(word) ? romanizeCyrillic(word, UK) : '';
    case 'el': return /[Ͱ-Ͽἀ-῿]/.test(word) ? romanizeGreek(word) : '';
    case 'ar': return /[\u0600-ۿ]/.test(word) ? romanizeArabic(word) : '';
    case 'he': return /[֐-׿]/.test(word) ? romanizeHebrew(word) : '';
    case 'hi': return /[\u0900-ॿ]/.test(word) ? romanizeHindi(word) : '';
    default: return '';
  }
}

// Paragraph text → HTML with pronunciation above each word.
export function annotate(text, lang, mode) {
  if (lang === 'ja') {
    if (!tokenizer) return esc(text);
    return japaneseTokens(text).map(({ surface, reading }) => {
      if (mode === 'furigana') return furigana(surface, reading);
      if (!reading || !/[぀-ヿ㐀-鿿]/.test(surface)) return esc(surface);
      return `<ruby>${esc(surface)}<rt>${esc(window.wanakana.toRomaji(reading))}</rt></ruby>`;
    }).join('');
  }
  let html = '';
  for (const seg of words(lang, text)) {
    const rom = seg.isWordLike ? romanizeWord(seg.segment, lang) : '';
    html += rom ? `<ruby>${esc(seg.segment)}<rt>${esc(rom)}</rt></ruby>` : esc(seg.segment);
  }
  return html;
}

// Small helper so the gloss can show a romanization for Chinese and Japanese too,
// loading the light libraries on first use (never the 18 MB Japanese dictionary).
export async function romanizeForGloss(word, lang) {
  if (lang === 'zh') await loadScript(PINYIN).catch(() => {});
  if (lang === 'ja' && !tokenizer) await loadScript(WANAKANA).catch(() => {});
  return romanizeWord(word, lang);
}
