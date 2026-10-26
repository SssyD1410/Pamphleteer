import { isHeadingLine } from './extract.js';

// Collages two paragraph lists into rows of [leftParas, rightParas].
// Linear time: chapters are matched first, then paragraphs inside each chapter
// are paired by their position in the running text (share of total characters).

const ROMAN = { i: 1, v: 5, x: 10, l: 50, c: 100 };
// Spelled-out chapter numbers 1–12, by language, in order.
const NUMBER_WORDS = [
  'one two three four five six seven eight nine ten eleven twelve',
  'first second third fourth fifth sixth seventh eighth ninth tenth eleventh twelfth',
  'premier deuxième troisième quatrième cinquième sixième septième huitième neuvième dixième onzième douzième',
  'erstes zweites drittes viertes fünftes sechstes siebentes achtes neuntes zehntes elftes zwölftes',
  'primero segundo tercero cuarto quinto sexto séptimo octavo noveno décimo undécimo duodécimo',
  'primo secondo terzo quarto quinto sesto settimo ottavo nono decimo undicesimo dodicesimo',
];
const ORDINALS = { première: 1, siebtes: 7, erste: 1, zweite: 2, dritte: 3 };
for (const line of NUMBER_WORDS) line.split(' ').forEach((w, k) => { ORDINALS[w] ??= k + 1; });

function numeral(heading) {
  const s = heading.toLowerCase();
  const arabic = s.match(/\d+/);
  if (arabic) return +arabic[0];
  const roman = s.match(/\b([ivxlc]{1,7})\b\.?/);
  if (roman) {
    let n = 0;
    const r = roman[1];
    for (let i = 0; i < r.length; i++) {
      const v = ROMAN[r[i]], next = ROMAN[r[i + 1]] || 0;
      n += v < next ? -v : v;
    }
    return n;
  }
  for (const w of s.split(/[\s.:]+/)) if (ORDINALS[w]) return ORDINALS[w];
  return null;
}

// Indices where matching chapters start on each side, or null if no confident match.
function chapterAnchors(L, R) {
  const hl = [], hr = [];
  L.forEach((p, i) => p.h && hl.push(i));
  R.forEach((p, i) => p.h && hr.push(i));
  if (hl.length < 2 || hr.length < 2) return null;

  // Prefer matching on chapter numbers; fall back to equal counts.
  // A numbered heading counts only if real text follows it, which skips tables of contents.
  const numbered = (idx, side) => {
    const found = [];
    for (const i of idx) {
      const n = isHeadingLine(side[i].t.split('\n')[0]) ? numeral(side[i].t) : null;
      if (n != null) found.push({ i, n });
    }
    const m = new Map();
    found.forEach(({ i, n }, k) => {
      const next = k + 1 < found.length ? found[k + 1].i : side.length;
      let body = 0;
      for (let x = i + 1; x < next && body < 300; x++) body += side[x].t.length;
      if (body >= 300 && !m.has(n)) m.set(n, i);
    });
    return m;
  };
  const ml = numbered(hl, L), mr = numbered(hr, R);
  const cand = [];
  for (const [n, i] of ml) if (mr.has(n)) cand.push([i, mr.get(n)]);
  cand.sort((a, b) => a[0] - b[0]);
  // Longest chain that moves forward on both sides (k is tiny, so O(k²) is fine).
  const len = cand.map(() => 1), prev = cand.map(() => -1);
  for (let a = 0; a < cand.length; a++)
    for (let b = 0; b < a; b++)
      if (cand[b][1] < cand[a][1] && len[b] + 1 > len[a]) { len[a] = len[b] + 1; prev[a] = b; }
  let end = len.indexOf(Math.max(0, ...len));
  const pairs = [];
  for (; end >= 0; end = prev[end]) pairs.unshift(cand[end]);
  if (pairs.length >= 2 && pairs.length >= 0.6 * Math.min(ml.size, mr.size)) return pairs;
  if (hl.length === hr.length) return hl.map((i, k) => [i, hr[k]]);
  return null;
}

// Banded Gale–Church style alignment: paragraphs of translations have proportional lengths,
// so we find the cheapest sequence of 1-1, 1-2, 2-1, 2-2, 1-3, 3-1 and skip moves.
const MOVES = [[1, 1, 0], [1, 2, 2.3], [2, 1, 2.3], [2, 2, 4.4], [1, 3, 4.2], [3, 1, 4.2], [1, 0, 4.6], [0, 1, 4.6]];
const MAX_CELLS = 3e6;

function dpAlign(L, R, rows) {
  const n = L.length, m = R.length;
  const a = L.map((p) => p.t.length + 8), b = R.map((p) => p.t.length + 8);
  const c = b.reduce((s, x) => s + x, 0) / a.reduce((s, x) => s + x, 0);
  const W = Math.ceil(Math.abs(n - m) + 10 + 0.08 * Math.max(n, m));
  const span = 2 * W + 1;
  const cen = (i) => Math.round((i * m) / n);
  const at = (i, j) => { const o = j - cen(i) + W; return o < 0 || o >= span ? -1 : i * span + o; };
  const D = new Float32Array((n + 1) * span).fill(Infinity);
  const B = new Int8Array((n + 1) * span).fill(-1);
  D[at(0, 0)] = 0;
  for (let i = 0; i <= n; i++) {
    const lo = Math.max(0, cen(i) - W), hi = Math.min(m, cen(i) + W);
    for (let j = lo; j <= hi; j++) {
      const here = D[at(i, j)];
      if (here === Infinity) continue;
      for (let k = 0; k < MOVES.length; k++) {
        const [di, dj, pen] = MOVES[k];
        const ni = i + di, nj = j + dj;
        if (ni > n || nj > m) continue;
        const t = at(ni, nj);
        if (t < 0) continue;
        let x = 0, y = 0;
        for (let q = i; q < ni; q++) x += a[q];
        for (let q = j; q < nj; q++) y += b[q];
        let cost = pen;
        if (di && dj) { const d = (y - x * c) / Math.sqrt(x * 6.8); cost += Math.min(d * d / 2, 40); }
        else cost += 0.004 * (x + y);
        if (here + cost < D[t]) { D[t] = here + cost; B[t] = k; }
      }
    }
  }
  const path = [];
  for (let i = n, j = m; i || j;) {
    const k = B[at(i, j)];
    if (k < 0) return false; // band too narrow; caller falls back
    path.push([i - MOVES[k][0], j - MOVES[k][1], i, j]);
    i -= MOVES[k][0]; j -= MOVES[k][1];
  }
  for (let p = path.length - 1; p >= 0; p--) {
    const [i0, j0, i1, j1] = path[p];
    const row = [L.slice(i0, i1), R.slice(j0, j1)];
    // Fold unmatched paragraphs into the previous row rather than leaving a blank cell.
    if ((!row[0].length || !row[1].length) && rows.length && rows.at(-1).seg === rows.seg) {
      rows.at(-1)[0].push(...row[0]); rows.at(-1)[1].push(...row[1]);
    } else {
      row.seg = rows.seg;
      rows.push(row);
    }
  }
  return true;
}

function alignSegment(L, R, rows) {
  rows.seg = (rows.seg || 0) + 1;
  if (!L.length || !R.length) {
    if (L.length || R.length) rows.push([L, R]);
    return;
  }
  const W = Math.abs(L.length - R.length) + 10 + 0.08 * Math.max(L.length, R.length);
  if ((L.length + 1) * (2 * W + 1) <= MAX_CELLS && dpAlign(L, R, rows)) return;
  greedyAlign(L, R, rows);
}

// Fallback for very long chapterless texts: one pass, pairing by running share of characters.
function greedyAlign(L, R, rows) {
  const w = (p) => p.t.length + 20;
  const tl = L.reduce((a, p) => a + w(p), 0), tr = R.reduce((a, p) => a + w(p), 0);
  let i = 0, j = 0, cl = 0, cr = 0;
  while (i < L.length || j < R.length) {
    const a = [], b = [];
    if (i < L.length) { cl += w(L[i]) / tl; a.push(L[i++]); }
    if (j < R.length) { cr += w(R[j]) / tr; b.push(R[j++]); }
    // Grow the row on whichever side lags behind, as long as that narrows the gap.
    while (a.length + b.length < 14) {
      const d = cl - cr;
      if (d < 0 && i < L.length && Math.abs(d + w(L[i]) / tl) < -d) { cl += w(L[i]) / tl; a.push(L[i++]); continue; }
      if (d > 0 && j < R.length && Math.abs(d - w(R[j]) / tr) < d) { cr += w(R[j]) / tr; b.push(R[j++]); continue; }
      break;
    }
    if (i >= L.length && j < R.length) { b.push(...R.slice(j)); j = R.length; }
    if (j >= R.length && i < L.length) { a.push(...L.slice(i)); i = L.length; }
    rows.push([a, b]);
  }
}

export function collage(L, R) {
  const rows = [];
  const anchors = chapterAnchors(L, R);
  if (!anchors) {
    alignSegment(L, R, rows);
    return { rows, chapters: 0 };
  }
  const cuts = [[0, 0], ...anchors.filter(([i, j]) => i || j), [L.length, R.length]];
  for (let k = 0; k < cuts.length - 1; k++) {
    alignSegment(L.slice(cuts[k][0], cuts[k + 1][0]), R.slice(cuts[k][1], cuts[k + 1][1]), rows);
  }
  return { rows, chapters: anchors.length };
}

// Pairs two short lists of units that have a `t` field (e.g. the sentences of one row).
export function alignUnits(A, B) {
  const rows = [];
  alignSegment(A, B, rows);
  return rows;
}

// For translated text the pairing is exact: one translated paragraph per source paragraph.
export const pairOneToOne = (L, R) => ({ rows: L.map((p, k) => [[p], [R[k]]]), chapters: 0 });

// Three or four texts: align each one to the first (the pivot), then cut rows only where
// every alignment allows a break in the pivot, so all columns stay in step.
export function collageMany(pivot, others) {
  const maps = others.map(({ paras, exact }) => {
    const { rows } = exact ? pairOneToOne(pivot, paras) : collage(pivot, paras);
    const cuts = new Set();
    const pieces = []; // [pivotStart, paragraphs of this text]
    let p = 0;
    for (const [a, b] of rows) {
      pieces.push([p, b]);
      p += a.length;
      cuts.add(p);
    }
    return { cuts, pieces };
  });
  const n = pivot.length;
  const cuts = [...maps[0].cuts].filter((c) => maps.every((m) => m.cuts.has(c))).sort((x, y) => x - y);
  if (cuts.at(-1) !== n) cuts.push(n);

  const rows = [];
  let start = 0;
  const cursor = maps.map(() => 0);
  for (const end of cuts) {
    const row = [pivot.slice(start, end)];
    maps.forEach((m, k) => {
      const col = [];
      // Pieces that start inside this row (a piece with no pivot text starts at its row's start).
      while (cursor[k] < m.pieces.length && (m.pieces[cursor[k]][0] < end || end === n)) col.push(...m.pieces[cursor[k]++][1]);
      row.push(col);
    });
    rows.push(row);
    start = end;
  }
  return { rows };
}
