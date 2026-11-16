import { updatePassword, getSession, onAuthChange, signOut } from '../core/auth.js';
import { requireClient } from '../core/supabase.js';
import { html, url } from '../core/utils.js';
import { formData, setFieldError, clearErrors, withBusy } from '../ui/form.js';

const form = document.getElementById('form'), notice = document.getElementById('notice');
try { requireClient(); } catch (e) { notice.innerHTML = html`<div class="alert alert-warning">${e.message}</div>`; throw e; }

let shown = false;
const showForm = () => { if (shown) return; shown = true; form.hidden = false; notice.innerHTML = ''; };
onAuthChange((event) => { if (event === 'PASSWORD_RECOVERY') showForm(); });
setTimeout(async () => {   // the recovery link signs the user in; give the client a moment to process the URL
  if (await getSession()) showForm();
  else notice.innerHTML = '<div class="alert alert-error">This reset link is invalid or has expired. <a href="forgot-password.html">Request a new one</a>.</div>';
}, 600);

form.addEventListener('submit', async (e) => {
  e.preventDefault(); clearErrors(form);
  const d = formData(form); let ok = true;
  if ((d.password ?? '').length < 8) { setFieldError(form.elements.password, 'Use at least 8 characters'); ok = false; }
  if (d.password !== d.confirm) { setFieldError(form.elements.confirm, 'Passwords do not match'); ok = false; }
  if (!ok) return;
  await withBusy(form.querySelector('button[type=submit]'), async () => {
    try { await updatePassword(d.password); await requireClient().auth.signOut(); location.href = url('auth/login.html?reset=1'); }
    catch (err) { notice.innerHTML = html`<div class="alert alert-error" role="alert" style="margin-bottom:var(--sp-4)">${err.message}</div>`; }
  });
});
