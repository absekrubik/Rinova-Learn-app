import { sendPasswordReset } from '../core/auth.js';
import { requireClient } from '../core/supabase.js';
import { html } from '../core/utils.js';
import { formData, setFieldError, clearErrors, withBusy, isEmail } from '../ui/form.js';

const form = document.getElementById('form'), notice = document.getElementById('notice');
try { requireClient(); } catch (e) { notice.innerHTML = html`<div class="alert alert-warning">${e.message}</div>`; form.querySelector('button').disabled = true; }
form.addEventListener('submit', async (e) => {
  e.preventDefault(); clearErrors(form); notice.innerHTML = '';
  const { email } = formData(form);
  if (!isEmail(email ?? '')) return setFieldError(form.elements.email, 'Enter a valid email address');
  await withBusy(form.querySelector('button[type=submit]'), async () => {
    try { await sendPasswordReset(email); } catch (err) { console.error(err); }
    // Same message whether or not the account exists (no account enumeration).
    notice.innerHTML = '<div class="alert alert-success" role="status" style="margin-bottom:var(--sp-4)">If an account exists for that email, a reset link is on its way.</div>';
    form.reset();
  });
});
