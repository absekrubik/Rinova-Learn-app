import { signUp, roleHomeUrl, getProfile } from '../core/auth.js';
import { redirectIfSignedIn } from '../core/guard.js';
import { requireClient } from '../core/supabase.js';
import { html, url } from '../core/utils.js';
import { formData, setFieldError, clearErrors, withBusy, isEmail } from '../ui/form.js';

const form = document.getElementById('form'), notice = document.getElementById('notice'), meter = document.getElementById('meter');
const say = (type, msg) => { notice.innerHTML = html`<div class="alert alert-${type}" role="alert" style="margin-bottom:var(--sp-4)">${msg}</div>`; };
try { requireClient(); } catch (e) { say('warning', e.message); form.querySelector('button').disabled = true; }
redirectIfSignedIn();

form.elements.password.addEventListener('input', (e) => {
  const v = e.target.value; let s = 0;
  if (v.length >= 8) s++; if (v.length >= 12) s++; if (/[A-Z]/.test(v) && /[a-z]/.test(v)) s++; if (/\d/.test(v) && /[^A-Za-z0-9]/.test(v)) s++;
  meter.style.width = (s * 25) + '%'; meter.style.background = ['', 'var(--red-600)', 'var(--orange-500)', 'var(--brand-500)', 'var(--green-500)'][s] || '';
});

form.addEventListener('submit', async (e) => {
  e.preventDefault(); clearErrors(form); notice.innerHTML = '';
  const d = formData(form); let ok = true;
  if (!d.name || d.name.length < 2) { setFieldError(form.elements.name, 'Enter your full name'); ok = false; }
  if (!isEmail(d.email ?? '')) { setFieldError(form.elements.email, 'Enter a valid email address'); ok = false; }
  if ((d.password ?? '').length < 8) { setFieldError(form.elements.password, 'Use at least 8 characters'); ok = false; }
  if (d.password !== d.confirm) { setFieldError(form.elements.confirm, 'Passwords do not match'); ok = false; }
  if (!ok) return;
  await withBusy(form.querySelector('button[type=submit]'), async () => {
    try {
      const res = await signUp({ email: d.email, password: d.password, fullName: d.name });
      if (res.session) { const me = await getProfile({ refresh: true }); location.href = roleHomeUrl(me.role); }
      else location.href = url('auth/login.html?registered=1');
    } catch (err) { say('error', err.message); }
  });
});
