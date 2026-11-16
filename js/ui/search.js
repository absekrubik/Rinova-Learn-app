// Global search palette: button in the top bar, "/" or Ctrl/Cmd+K to open, arrow keys + Enter to go.
import { html, raw, debounce } from '../core/utils.js';
import { searchAll, MIN_CHARS } from '../services/search.js';

export function mountSearch({ button, role, nav }) {
  let el = null, seq = 0, flat = [], active = -1, prev = null;
  const close = () => { if (!el) return; el.remove(); el = null; document.removeEventListener('keydown', onKey, true); prev?.focus?.(); };
  const paintActive = () => {
    el.querySelectorAll('[role=option]').forEach((o, i) => { const on = i === active; o.setAttribute('aria-selected', String(on)); o.classList.toggle('active', on); if (on) o.scrollIntoView?.({ block: 'nearest' }); });
    el.querySelector('input').setAttribute('aria-activedescendant', active >= 0 ? `sr-${active}` : '');
  };
  function onKey(e) {
    if (!el) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
    if (e.key === 'Tab') { e.preventDefault(); el.querySelector('input').focus(); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (!flat.length) return; active = (active + (e.key === 'ArrowDown' ? 1 : -1) + flat.length) % flat.length; paintActive(); }
    else if (e.key === 'Enter' && active >= 0 && flat[active]) { e.preventDefault(); location.href = flat[active].href; }
  }
  function paint(groups, state) {
    const box = el.querySelector('#sr-body'); flat = groups.flatMap((g) => g.items); active = flat.length ? 0 : -1;
    if (state === 'hint') box.innerHTML = '<p class="palette-msg">Type at least 2 letters to search courses, lessons, assignments, quizzes, live classes and announcements.</p>';
    else if (state === 'loading') box.innerHTML = '<p class="palette-msg">Searching…</p>';
    else if (state === 'error') box.innerHTML = '<p class="palette-msg" role="alert">Search is not available right now. Please try again.</p>';
    else if (!flat.length) box.innerHTML = '<p class="palette-msg">Nothing found. Try a different word.</p>';
    else { let n = 0; box.innerHTML = groups.map((g) => html`<div class="palette-group" role="presentation">${g.label}</div>${raw(g.items.map((it) => { const i = n++; return html`<a class="palette-item" role="option" id="sr-${i}" href="${it.href}" aria-selected="false"><span class="t">${it.title}</span><span class="s">${it.sub}</span></a>`; }).join(''))}`).join(''); }
    el.querySelector('[aria-live]').textContent = state === 'results' ? `${flat.length} result${flat.length === 1 ? '' : 's'}` : '';
    if (flat.length) paintActive();
  }
  const run = debounce(async (q) => {
    const my = ++seq; if (q.trim().length < MIN_CHARS) return paint([], 'hint');
    paint([], 'loading');
    try { const g = await searchAll(q, role, nav); if (my === seq && el) paint(g, 'results'); } catch (err) { console.error(err); if (my === seq && el) paint([], 'error'); }
  }, 250);
  function open() {
    if (el) return; prev = document.activeElement;
    el = document.createElement('div'); el.className = 'palette-backdrop';
    el.innerHTML = `<div class="palette" role="dialog" aria-modal="true" aria-label="Search"><div class="palette-head"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
      <input type="search" id="sr-input" role="combobox" aria-expanded="true" aria-controls="sr-body" aria-autocomplete="list" placeholder="Search everything…" autocomplete="off" maxlength="60" aria-label="Search"><button class="btn btn-ghost btn-sm" type="button" data-close aria-label="Close search">Esc</button></div>
      <div id="sr-body" class="palette-body" role="listbox" aria-label="Search results"></div><div class="sr-only" aria-live="polite"></div></div>`;
    document.body.append(el); paint([], 'hint');
    const input = el.querySelector('input'); input.focus();
    input.addEventListener('input', (e) => run(e.target.value));
    el.addEventListener('click', (e) => { if (e.target === el || e.target.closest('[data-close]')) close(); });
    el.addEventListener('mousemove', (e) => { const o = e.target.closest('[role=option]'); if (o) { active = +o.id.slice(3); paintActive(); } });
    document.addEventListener('keydown', onKey, true);
  }
  button.addEventListener('click', open);
  document.addEventListener('keydown', (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
    if ((e.key === 'k' && (e.ctrlKey || e.metaKey)) || (e.key === '/' && !typing && !e.ctrlKey && !e.metaKey && !el && !document.querySelector('.modal'))) { e.preventDefault(); open(); }
  });
  return { open, close };
}
