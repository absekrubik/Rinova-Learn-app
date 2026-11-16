// Form helpers: validation display, busy buttons, serialisation.
export function formData(form) {
  const out = {};
  for (const [k, v] of new FormData(form)) out[k] = typeof v === 'string' ? v.trim() : v;
  return out;
}

export function setFieldError(input, message) {
  const field = input.closest('.field'); if (!field) return;
  field.classList.toggle('has-error', !!message);
  let err = field.querySelector('.field-error');
  if (message && !err) { err = document.createElement('div'); err.className = 'field-error'; err.setAttribute('role', 'alert'); field.append(err); }
  if (err) err.textContent = message ?? '';
  input.setAttribute('aria-invalid', message ? 'true' : 'false');
}
export const clearErrors = (form) => form.querySelectorAll('.field').forEach((f) => { f.classList.remove('has-error'); f.querySelector('.field-error')?.remove(); });

/** Run async work while the submit button shows a spinner and is disabled. */
export async function withBusy(button, fn) {
  button.setAttribute('aria-busy', 'true'); button.disabled = true;
  try { return await fn(); } finally { button.removeAttribute('aria-busy'); button.disabled = false; }
}

export const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
