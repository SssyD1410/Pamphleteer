// A short guided tour for new readers: one card per step, pointing at the part of the
// page it explains. Each tour runs once on its own; the "?" buttons replay it.

const touch = matchMedia('(hover: none)').matches;
const SEEN = 'pamphleteer.tour.';

export const TOURS = {
  setup: [
    {
      title: 'Welcome to Pamphleteer',
      text: 'Read a book side by side with its translations. This takes half a minute. Nothing you upload leaves your device.',
    },
    {
      target: '#sides',
      title: 'Upload each language',
      text: 'Add the same work in two languages: PDF, EPUB, Word, HTML or plain text, or paste the text. Check the language under each side. “× remove” clears a side.',
    },
    {
      target: '#add-side',
      title: 'Up to four languages',
      text: 'Add a third or fourth language to read them all in parallel.',
    },
    {
      target: '#go',
      title: 'Set it in type',
      text: 'When the files are in, press this. Only have one language? Leave the other side empty and Pamphleteer can translate a short text for you.',
    },
    {
      target: '.sample',
      title: 'Try it first',
      text: 'Not sure where to start? Open Alice in Wonderland in English, French and German.',
    },
  ],
  reader: [
    {
      // the first row with a real paragraph in every column, not a title page or contents
      target: () => {
        const rows = [...document.querySelectorAll('#pages .row')];
        const prose = (col) => [...col.querySelectorAll('p')].some((p) => p.textContent.length > 120 && /[.!?»”"]\s/.test(p.textContent));
        return rows.find((r) => [...r.children].every(prose)) || rows[0];
      },
      title: 'Read across',
      text: touch
        ? 'Tap a sentence to underline it in every language. Double-tap a word for its translation and dictionary entry.'
        : 'Point at a sentence to underline it in every language. Point at a word for a quick translation, and click it for the dictionary.',
    },
    {
      target: '.toolbar .pager',
      title: 'Pages',
      text: touch
        ? 'Long books are split by chapter. Jump with this menu or the ‹ › buttons.'
        : 'Long books are split by chapter. Jump with this menu, the ‹ › buttons or the arrow keys.',
    },
    {
      target: '#font',
      title: 'Make it yours',
      text: 'Change the typeface and size, hide or reorder languages with the EN · FR buttons, and choose which language glosses appear in.',
    },
    {
      target: '#pdf',
      title: 'Keep a copy',
      text: 'Save the whole parallel text as a web page (HTML) or as a PDF.',
    },
    {
      target: '#help',
      title: 'Need this again?',
      text: 'This button replays the tour.',
    },
  ],
};

const seen = (name) => { try { return localStorage.getItem(SEEN + name) === '1'; } catch { return false; } };
const markSeen = (name) => { try { localStorage.setItem(SEEN + name, '1'); } catch { /* storage blocked */ } };

export function maybeTour(name) {
  if (!seen(name)) runTour(name);
}

let active = null;
const find = (target) => (typeof target === 'function' ? target() : document.querySelector(target));

export function runTour(name) {
  active?.end();
  const steps = TOURS[name].filter((s) => {
    if (!s.target) return true;
    const el = find(s.target);
    return el && el.getClientRects().length && !el.closest('[hidden]');
  });
  if (!steps.length) return;
  markSeen(name);

  const card = document.createElement('div');
  card.className = 'tour';
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-live', 'polite');
  document.body.appendChild(card);
  let i = 0, lit = null;

  const end = () => {
    lit?.classList.remove('tour-target');
    card.remove();
    removeEventListener('keydown', onKey, true);
    removeEventListener('resize', place);
    active = null;
  };
  const onKey = (e) => {
    if (e.key === 'Escape') end();
    if (e.key === 'ArrowRight' || e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); go(i + 1); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); go(i - 1); }
  };

  function place() {
    const step = steps[i];
    const margin = 14;
    if (!lit) {
      card.style.left = `${Math.max(16, (innerWidth - card.offsetWidth) / 2)}px`;
      card.style.top = `${Math.max(16, (innerHeight - card.offsetHeight) / 2)}px`;
      return;
    }
    const r = lit.getBoundingClientRect();
    const below = r.bottom + margin + card.offsetHeight < innerHeight;
    const top = below ? r.bottom + margin : Math.max(16, r.top - margin - card.offsetHeight);
    card.style.top = `${Math.min(top, innerHeight - card.offsetHeight - 16)}px`;
    card.style.left = `${Math.min(Math.max(16, r.left), innerWidth - card.offsetWidth - 16)}px`;
    card.dataset.step = step.title;
  }

  function go(n) {
    if (n < 0) return;
    if (n >= steps.length) return end();
    i = n;
    const step = steps[i];
    lit?.classList.remove('tour-target');
    lit = step.target ? find(step.target) : null;
    if (lit) {
      lit.classList.add('tour-target');
      if (!lit.closest('.toolbar')) lit.scrollIntoView({ block: 'center', behavior: 'instant' });
    }
    card.innerHTML = `
      <p class="tour-count">${i + 1} of ${steps.length}</p>
      <h3>${step.title}</h3>
      <p>${step.text}</p>
      <p class="tour-actions">
        <button type="button" class="link tour-skip">${i === steps.length - 1 ? 'Close' : 'Skip tour'}</button>
        <span>
          ${i ? '<button type="button" class="tool tour-back">Back</button>' : ''}
          <button type="button" class="tool tour-next">${i === steps.length - 1 ? 'Done' : 'Next'}</button>
        </span>
      </p>`;
    place();
    card.querySelector('.tour-next').focus({ preventScroll: true });
  }

  card.addEventListener('click', (e) => {
    if (e.target.closest('.tour-next')) go(i + 1);
    if (e.target.closest('.tour-back')) go(i - 1);
    if (e.target.closest('.tour-skip')) end();
  });
  addEventListener('keydown', onKey, true);
  addEventListener('resize', place);
  active = { end };
  go(0);
}
