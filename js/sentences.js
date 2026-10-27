// Sentence-level reading aid: underline the sentence under the pointer and its
// counterpart in every other column. Sentences are found and paired only for the row
// being hovered, and drawn with the CSS Custom Highlight API, so the text is never rewrapped.

import { alignUnits } from './align.js';

const segmenters = {};
const sentenceSegmenter = (lang) => (segmenters[lang] ||= new Intl.Segmenter(lang, { granularity: 'sentence' }));

export function caretAt(x, y) {
  if (document.caretPositionFromPoint) {
    const p = document.caretPositionFromPoint(x, y);
    return p && { node: p.offsetNode, offset: p.offset };
  }
  const r = document.caretRangeFromPoint?.(x, y);
  return r && { node: r.startContainer, offset: r.startOffset };
}

// Per column: its text nodes, their offsets in the column's text, and its sentences.
const indexes = new WeakMap();
function columnIndex(col) {
  let ix = indexes.get(col);
  if (ix) return ix;
  const nodes = [];
  let text = '';
  for (const p of col.querySelectorAll('p')) {
    const walk = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      nodes.push({ node: n, start: text.length });
      text += n.data;
    }
    text += '\n'; // paragraph end is always a sentence end
  }
  const sents = [];
  for (const seg of sentenceSegmenter(col.lang || 'en').segment(text)) {
    const lead = seg.segment.length - seg.segment.trimStart().length;
    const body = seg.segment.trim();
    if (body) sents.push({ s: seg.index + lead, e: seg.index + lead + body.length, t: body, i: sents.length });
  }
  ix = { nodes, sents };
  indexes.set(col, ix);
  return ix;
}

function position(ix, off) {
  let lo = 0, hi = ix.nodes.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ix.nodes[mid].start <= off) lo = mid; else hi = mid - 1;
  }
  const n = ix.nodes[lo];
  return { node: n.node, offset: Math.min(off - n.start, n.node.length) };
}

function rangeOf(ix, sent) {
  const a = position(ix, sent.s), b = position(ix, sent.e);
  const r = new Range();
  r.setStart(a.node, a.offset);
  r.setEnd(b.node, b.offset);
  return r;
}

function sentenceAt(col, node, offset) {
  const ix = columnIndex(col);
  const n = ix.nodes.find((x) => x.node === node);
  if (!n) return null;
  const off = n.start + offset;
  return ix.sents.find((s) => off >= s.s && off <= s.e) || null;
}

// The sentence containing a text position, for giving a word its context.
export function sentenceAround(node, offset) {
  const col = node.parentElement?.closest('.col');
  return col ? sentenceAt(col, node, offset)?.t || '' : '';
}

// Which sentences of `other` correspond to sentence `i` of `col` (cached per pair of columns).
const pairings = new WeakMap();
function counterpart(col, other, i) {
  let byOther = pairings.get(col);
  if (!byOther) pairings.set(col, (byOther = new WeakMap()));
  let groups = byOther.get(other);
  if (!groups) {
    groups = alignUnits(columnIndex(col).sents, columnIndex(other).sents);
    byOther.set(other, groups);
  }
  return groups.find(([a]) => a.some((s) => s.i === i)) || [[], []];
}

// Two highlights: the sentence (single underline, in every column) and the word (double).
const supported = !!globalThis.CSS?.highlights && typeof Highlight !== 'undefined';
const sentenceHl = supported ? new Highlight() : null;
const wordHl = supported ? new Highlight() : null;
if (supported) {
  wordHl.priority = 1;
  CSS.highlights.set('pamph-sentence', sentenceHl);
  CSS.highlights.set('pamph-word', wordHl);
}
let lastCol = null, lastI = -1;

export function clearSentence() {
  sentenceHl?.clear();
  cut = null;
  lastCol = null;
  lastI = -1;
}

// Double-underline one word (a Range), or clear with null. The sentence underline is
// cut around the word, otherwise the two decorations paint over each other.
let cut = null; // { whole, parts } – the sentence range split around the word
export function markWord(range) {
  if (!wordHl) return;
  wordHl.clear();
  if (cut && sentenceHl.has(cut.parts[0])) {
    cut.parts.forEach((r) => sentenceHl.delete(r));
    sentenceHl.add(cut.whole);
  }
  cut = null;
  if (!range) return;
  wordHl.add(range);
  for (const whole of sentenceHl) {
    if (whole.compareBoundaryPoints(Range.START_TO_START, range) > 0 || whole.compareBoundaryPoints(Range.END_TO_END, range) < 0) continue;
    const before = new Range(), after = new Range();
    before.setStart(whole.startContainer, whole.startOffset);
    before.setEnd(range.startContainer, range.startOffset);
    after.setStart(range.endContainer, range.endOffset);
    after.setEnd(whole.endContainer, whole.endOffset);
    sentenceHl.delete(whole);
    sentenceHl.add(before);
    sentenceHl.add(after);
    cut = { whole, parts: [before, after] };
    break;
  }
}

// Underline the sentence at a point and its counterparts in the other columns.
// Returns false when the point is not on text.
export function showSentenceAt(x, y, target) {
  if (!supported) return false;
  const p = target?.closest?.('.col p');
  const c = p && caretAt(x, y);
  if (!c || c.node.nodeType !== Node.TEXT_NODE || !p.contains(c.node)) return false;
  const col = p.closest('.col');
  const sent = sentenceAt(col, c.node, c.offset);
  if (!sent) return false;
  if (col === lastCol && sent.i === lastI) return true;
  lastCol = col;
  lastI = sent.i;
  sentenceHl.clear();
  cut = null;
  const ix = columnIndex(col);
  const mine = new Set([sent]);
  for (const other of col.parentElement.querySelectorAll('.col')) {
    if (other === col) continue;
    const [a, b] = counterpart(col, other, sent.i);
    a.forEach((s) => mine.add(s));
    const oix = columnIndex(other);
    for (const s of b) sentenceHl.add(rangeOf(oix, s));
  }
  for (const s of mine) sentenceHl.add(rangeOf(ix, s));
  return true;
}

export function attachSentenceHover(pages) {
  if (!supported) return;
  let frame = 0;
  pages.addEventListener('mousemove', (e) => {
    if (e.buttons || e.sourceCapabilities?.firesTouchEvents) return; // taps are handled separately
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => { if (!showSentenceAt(e.clientX, e.clientY, e.target)) clearSentence(); });
  });
  pages.addEventListener('mouseleave', () => { clearSentence(); markWord(null); });
}
