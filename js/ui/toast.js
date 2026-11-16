let region;
export function toast(message, type = 'info', ms = 4000) {
  region ??= Object.assign(document.createElement('div'), { className: 'toast-region' });
  region.setAttribute('role', 'status'); region.setAttribute('aria-live', 'polite');
  if (!region.isConnected) document.body.append(region);
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = message;               // textContent: never HTML
  region.append(el);
  setTimeout(() => { el.style.transition = 'opacity .2s'; el.style.opacity = '0'; setTimeout(() => el.remove(), 200); }, ms);
}
export const toastSuccess = (m) => toast(m, 'success');
export const toastError = (m) => toast(m, 'error', 6000);
