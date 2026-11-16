import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../config.js';

const dot = document.getElementById('dot'), status = document.getElementById('status');
const configured = /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(SUPABASE_URL) && !SUPABASE_ANON_KEY.startsWith('YOUR-');

if (!configured) {
  dot.classList.add('warn');
  status.textContent = 'Setup needed: add your Supabase URL and anon key in js/config.js (see supabase/README.md).';
} else {
  try {
    const { getSession, getProfile, roleHomeUrl } = await import('../core/auth.js');
    const session = await getSession();
    dot.classList.add('ok');
    if (session) {
      const me = await getProfile();
      status.textContent = `Signed in as ${me.full_name || me.email}`;
      const a = document.getElementById('signin'); a.textContent = 'Open dashboard'; a.href = roleHomeUrl(me.role);
    } else status.textContent = 'Connected to Supabase.';
  } catch (e) { dot.classList.add('warn'); status.textContent = 'Could not reach Supabase: ' + e.message; }
}
