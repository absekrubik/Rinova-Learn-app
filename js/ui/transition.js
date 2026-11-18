// Branded full-screen transition. Resolves when it is time to navigate; the page unloads right after, so the overlay is never removed.
const LOGO = new URL('../../assets/img/logo-mark.png', import.meta.url).href;
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
let shown = false;

/** playTransition({ title, strong, sub, ms }) -> Promise. `strong` is the highlighted part of the title (e.g. a first name). */
export function playTransition({ title = '', strong = '', sub = '', ms = 900 } = {}) {
  if (shown) return Promise.resolve();
  shown = true;
  const root = el('div', 'rl-trans'); root.setAttribute('role', 'status'); root.setAttribute('aria-live', 'polite');
  root.append(el('i', 'orb'), el('i', 'orb b'));
  const inner = el('div', 'rl-trans-in');
  const mark = el('div', 'splash-mark'); mark.setAttribute('aria-hidden', 'true');
  const img = el('img'); img.src = LOGO; img.alt = ''; img.width = 512; img.height = 512;
  const ns = 'http://www.w3.org/2000/svg', svg = document.createElementNS(ns, 'svg'); svg.setAttribute('class', 'splash-ring'); svg.setAttribute('viewBox', '0 0 100 100');
  for (const c of ['track', 'arc']) { const k = document.createElementNS(ns, 'circle'); k.setAttribute('class', c); k.setAttribute('cx', '50'); k.setAttribute('cy', '50'); k.setAttribute('r', '46'); svg.append(k); }
  mark.append(el('i', 'splash-badge'), img, svg);
  const h = el('h2', '', title); if (strong) { const b = el('b', '', strong); h.append(b); }
  inner.append(mark, h);
  if (sub) inner.append(el('p', '', sub));
  const dots = el('div', 'dots'); dots.setAttribute('aria-hidden', 'true'); dots.append(el('i'), el('i'), el('i')); inner.append(dots);
  root.append(inner); document.body.append(root);
  return new Promise((r) => setTimeout(r, ms));
}

// Coming back with the browser Back button (page restored from cache): clear the overlay so the page is usable.
window.addEventListener('pageshow', (e) => { if (e.persisted) { document.querySelectorAll('.rl-trans').forEach((n) => n.remove()); shown = false; } });
