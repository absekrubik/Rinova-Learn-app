import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../config.js';
import { initSplash } from '../ui/splash.js';
import { playTransition } from '../ui/transition.js';
initSplash();

const $ = (id) => document.getElementById(id);
$('yr').textContent = new Date().getFullYear();
const configured = /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(SUPABASE_URL) && !SUPABASE_ANON_KEY.startsWith('YOUR-');

if (!configured) {
  $('warn').hidden = false;
  $('status').textContent = 'Setup needed: add your Supabase URL and publishable key in js/config.js.';
} else {
  try {
    const { getSession, getProfile, roleHomeUrl } = await import('../core/auth.js');
    if (await getSession()) {
      const me = await getProfile();
      for (const id of ['signin', 'signin-top', 'signin2']) { const a = $(id); a.textContent = 'Open dashboard'; a.href = roleHomeUrl(me.role); }
    }
  } catch { /* stay on the plain Sign in links */ }
}

// Clicking Sign in plays a short transition before the login page opens (not for the "Open dashboard" state).
for (const id of ['signin', 'signin-top', 'signin2']) {
  document.getElementById(id)?.addEventListener('click', async (e) => {
    const a = e.currentTarget; if (a.textContent.trim() === 'Open dashboard' || e.ctrlKey || e.metaKey || e.shiftKey || e.button) return;
    e.preventDefault(); await playTransition({ title: 'Taking you to sign in', ms: 800 }); location.href = a.href;
  });
}
