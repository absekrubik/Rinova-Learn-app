import { html } from '../core/utils.js';

/** openModal({ title, body (trusted HTML string or Node), actions:[{label, variant, onClick}] }) -> { close, el } */
export function openModal({ title, body, actions = [], onClose } = {}) {
  const prev = document.activeElement;
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = html`<div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
    <div class="modal-head"><h3 id="modal-title"></h3><button class="btn btn-ghost btn-sm" data-close aria-label="Close">&#10005;</button></div>
    <div class="modal-body"></div><div class="modal-actions"></div></div>`.toString();
  backdrop.querySelector('#modal-title').textContent = title ?? '';
  const bodyEl = backdrop.querySelector('.modal-body');
  if (body instanceof Node) bodyEl.append(body); else bodyEl.innerHTML = body ?? '';
  const actionsEl = backdrop.querySelector('.modal-actions');
  const close = () => { backdrop.remove(); document.removeEventListener('keydown', onKey); prev?.focus?.(); onClose?.(); };
  const onKey = (e) => {
    if (e.key === 'Escape') { close(); return; }
    if (e.key !== 'Tab') return;                       // keep keyboard focus inside the dialog
    const f = [...backdrop.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter((x) => !x.disabled && !x.hidden && x.offsetParent !== null);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (!backdrop.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
    else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  for (const a of actions) {
    const b = document.createElement('button');
    b.className = `btn btn-${a.variant ?? 'secondary'}`; b.textContent = a.label;
    b.addEventListener('click', () => a.onClick?.({ close, el: backdrop }));
    actionsEl.append(b);
  }
  if (!actions.length) actionsEl.remove();
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop || e.target.closest('[data-close]')) close(); });
  document.addEventListener('keydown', onKey);
  document.body.append(backdrop);
  (backdrop.querySelector('input,select,textarea,button.btn-primary') ?? backdrop.querySelector('[data-close]')).focus();
  return { close, el: backdrop };
}

/** confirmDialog('Delete course?', 'This cannot be undone.') -> Promise<boolean> */
export function confirmDialog(title, message, { confirmLabel = 'Confirm', danger = false } = {}) {
  return new Promise((resolve) => {
    let settled = false; const done = (v) => { if (!settled) { settled = true; resolve(v); } };
    const p = document.createElement('p'); p.textContent = message;
    openModal({ title, body: p, onClose: () => done(false), actions: [
      { label: 'Cancel', onClick: ({ close }) => { done(false); close(); } },
      { label: confirmLabel, variant: danger ? 'danger' : 'primary', onClick: ({ close }) => { done(true); close(); } },
    ]});
  });
}
