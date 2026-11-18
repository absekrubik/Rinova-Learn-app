import { showSplash } from '../ui/splash.js';
import { signIn, getProfile, roleHomeUrl } from '../core/auth.js';
import { redirectIfSignedIn } from '../core/guard.js';
import { SITE_ROOT, param, html } from '../core/utils.js';
import { formData, setFieldError, clearErrors, withBusy, isEmail } from '../ui/form.js';
import { requireClient } from '../core/supabase.js';
import { playTransition } from '../ui/transition.js';
showSplash();
const ROLE_LABEL = { admin: 'Administrator', teacher: 'Teacher', student: 'Student' };

const form = document.getElementById('form'), notice = document.getElementById('notice');
const say = (type, msg) => { notice.innerHTML = html`<div class="alert alert-${type}" role="alert" style="margin-bottom:var(--sp-4)">${msg}</div>`; };
try { requireClient(); } catch (e) { say('warning', e.message); form.querySelector('button').disabled = true; }
if (param('suspended')) say('error', 'Your account is suspended. Please contact an administrator.');
if (param('registered')) say('success', 'Account created. Check your email to confirm your address, then sign in.');
if (param('reset')) say('success', 'Password updated. Please sign in.');
redirectIfSignedIn();

// Only follow ?next= when it stays inside this site (prevents open redirects).
function safeNext() {
  const n = param('next'); if (!n) return null;
  try { const u = new URL(n, location.origin); return u.origin === location.origin && u.pathname.startsWith(SITE_ROOT.pathname) ? u.href : null; } catch { return null; }
}
const FRIENDLY = { 'Invalid login credentials': 'Incorrect email or password.', 'Email not confirmed': 'Please confirm your email address first. Check your inbox.' };

form.addEventListener('submit', async (e) => {
  e.preventDefault(); clearErrors(form); notice.innerHTML = '';
  const d = formData(form); let ok = true;
  if (!isEmail(d.email ?? '')) { setFieldError(form.elements.email, 'Enter a valid email address'); ok = false; }
  if (!d.password) { setFieldError(form.elements.password, 'Enter your password'); ok = false; }
  if (!ok) return;
  await withBusy(form.querySelector('button[type=submit]'), async () => {
    try {
      await signIn(d.email, d.password);
      const me = await getProfile({ refresh: true });
      if (!me || me.status !== 'active') { say('error', 'Your account is suspended. Please contact an administrator.'); return; }
      const next = safeNext();
      const first = String(me.full_name ?? '').trim().split(/\s+/)[0];
      const target = (next && next.startsWith(SITE_ROOT.origin + SITE_ROOT.pathname + me.role)) ? next : roleHomeUrl(me.role);
      await playTransition({ title: first ? 'Welcome back, ' : 'Welcome back', strong: first, sub: ROLE_LABEL[me.role] ?? '', ms: 1700 });
      try { sessionStorage.setItem('rl-skip-splash', '1'); } catch { /* ignore */ }
      location.href = target;
    } catch (err) { say('error', FRIENDLY[err.message] ?? err.message); }
  });
});
