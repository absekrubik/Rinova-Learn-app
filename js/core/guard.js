// Route guard. This is UX only: real security is enforced by Row Level Security in the database.
import { getProfile, roleHomeUrl } from './auth.js';
import { url } from './utils.js';

/**
 * Call at the top of every protected page: const me = await requireRole('teacher', 'admin');
 * Redirects to login when signed out, or to the user's own dashboard when the role does not match.
 */
export async function requireRole(...roles) {
  let profile = null;
  try { profile = await getProfile(); } catch (e) { console.error(e); }
  if (!profile) { location.replace(url('auth/login.html') + '?next=' + encodeURIComponent(location.pathname + location.search)); return new Promise(() => {}); }
  if (profile.status !== 'active') { location.replace(url('auth/login.html') + '?suspended=1'); return new Promise(() => {}); }
  if (roles.length && !roles.includes(profile.role)) { location.replace(roleHomeUrl(profile.role)); return new Promise(() => {}); }
  return profile;
}

/** For login/register pages: if already signed in, jump to the right dashboard. */
export async function redirectIfSignedIn() {
  try {
    const profile = await getProfile();
    if (profile && profile.status === 'active') location.replace(roleHomeUrl(profile.role));
  } catch { /* not signed in */ }
}
