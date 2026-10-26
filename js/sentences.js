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

export function attachSentenceHover(pages) {
  if (!globalThis.CSS?.highlights || typeof Highlight === 'undefined') return;
  const hl = new Highlight();
  CSS.highlights.set('pamph-sentence', hl);
  let lastCol = null, lastI = -1, frame = 0;
  const clear = () => { hl.clear(); lastCol = null; lastI = -1; };

  pages.addEventListener('mousemove', (e) => {
    if (e.buttons) return;
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      const p = e.target.closest?.('.col p');
      const c = p && caretAt(e.clientX, e.clientY);
      if (!c || c.node.nodeType !== Node.TEXT_NODE || !p.contains(c.node)) return clear();
      const col = p.closest('.col');
      const sent = sentenceAt(col, c.node, c.offset);
      if (!sent) return clear();
      if (col === lastCol && sent.i === lastI) return;
      lastCol = col;
      lastI = sent.i;
      hl.clear();
      const ix = columnIndex(col);
      const mine = new Set([sent]);
      for (const other of col.parentElement.querySelectorAll('.col')) {
        if (other === col) continue;
        const [a, b] = counterpart(col, other, sent.i);
        a.forEach((s) => mine.add(s));
        const oix = columnIndex(other);
        for (const s of b) hl.add(rangeOf(oix, s));
      }
      for (const s of mine) hl.add(rangeOf(ix, s));
    });
  });
  pages.addEventListener('mouseleave', clear);
}
