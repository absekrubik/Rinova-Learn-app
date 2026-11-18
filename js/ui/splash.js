// Opening splash: plays every time. The landing page ships it as static HTML; other pages (login, dashboards) get it built here.
// The animation and its own exit are pure CSS; this handles building, skipping and cleanup.
const LOGO = new URL('../../assets/img/logo-mark.png', import.meta.url).href;
const root = document.documentElement;
const NS = 'http://www.w3.org/2000/svg';
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };

function build() {
  const s = el('div', 'splash'); s.id = 'splash'; s.setAttribute('role', 'status'); s.setAttribute('aria-label', 'Rinova Learn is loading');
  s.append(el('div', 'splash-orb o1'), el('div', 'splash-orb o2'), el('div', 'splash-orb o3'), el('div', 'splash-grid'));
  const c = el('div', 'splash-center'), mark = el('div', 'splash-mark'); mark.setAttribute('aria-hidden', 'true');
  const img = el('img'); img.src = LOGO; img.alt = ''; img.width = 512; img.height = 512;
  const svg = document.createElementNS(NS, 'svg'); svg.setAttribute('class', 'splash-ring'); svg.setAttribute('viewBox', '0 0 100 100');
  for (const k of ['track', 'arc']) { const ci = document.createElementNS(NS, 'circle'); ci.setAttribute('class', k); ci.setAttribute('cx', '50'); ci.setAttribute('cy', '50'); ci.setAttribute('r', '46'); svg.append(ci); }
  mark.append(el('i', 'splash-pulse'), el('i', 'splash-badge'), img, svg);
  const word = el('div', 'splash-word'); word.setAttribute('aria-hidden', 'true');
  [...'Rinova Learn'].forEach((ch, i) => { const sp = el('span', ch === ' ' ? 'sp' : i >= 7 ? 'g' : '', ch === ' ' ? '' : ch); sp.style.setProperty('--i', i); word.append(sp); });
  c.append(mark, word, el('p', 'splash-tag', 'Learn without limits'));
  const bar = el('div', 'splash-bar'); bar.setAttribute('aria-hidden', 'true'); bar.append(el('i'));
  const skip = el('button', 'splash-skip', 'Skip'); skip.type = 'button';
  s.append(c, bar, skip);
  return s;
}

/** Plays the splash: uses the static #splash if the page has one, otherwise builds it. Skipped once right after the sign-in welcome. */
export function showSplash() {
  if (root.classList.contains('no-splash')) { document.getElementById('splash')?.remove(); return; }
  let el0 = document.getElementById('splash');
  if (!el0) { el0 = build(); document.body.append(el0); }
  root.classList.add('splash-on');                                  // the page-cover that prevents a flash is no longer needed
  root.style.overflow = 'hidden';                                   // no scrolling behind it
  let done = false;
  const finish = () => { if (done) return; done = true; root.style.overflow = ''; el0.remove(); document.removeEventListener('keydown', onKey); };
  const leave = () => { if (done || el0.classList.contains('is-leaving')) return; el0.classList.add('is-leaving'); setTimeout(finish, 480); };
  const onKey = (e) => { if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') leave(); };
  el0.addEventListener('click', leave);
  el0.querySelector('.splash-skip')?.addEventListener('click', (e) => { e.stopPropagation(); leave(); });
  document.addEventListener('keydown', onKey);
  el0.addEventListener('animationend', (e) => { if (e.animationName === 'splash-out') finish(); });
  setTimeout(finish, 4000);                                          // safety net
}
export const initSplash = showSplash;                               // name used by the landing page
