// Authentication + current-user profile. Pages call these; they never touch supabase.auth directly.
import { requireClient } from './supabase.js';
import { url } from './utils.js';

let profileCache = null;

export const ROLE_HOME = { admin: 'admin/index.html', teacher: 'teacher/index.html', student: 'student/index.html' };
export const roleHomeUrl = (role) => url(ROLE_HOME[role] ?? 'auth/login.html');

export async function getSession() {
  const { data, error } = await requireClient().auth.getSession();
  if (error) throw error;
  return data.session;
}

/** Profile row of the signed-in user (role, status, name). Cached per page load. */
export async function getProfile({ refresh = false } = {}) {
  if (profileCache && !refresh) return profileCache;
  const session = await getSession();
  if (!session) return null;
  const { data, error } = await requireClient().from('profiles').select('*').eq('id', session.user.id).single();
  if (error) throw error;
  profileCache = data;
  return data;
}

export async function signIn(email, password) {
  const { data, error } = await requireClient().auth.signInWithPassword({ email, password });
  if (error) throw error;
  profileCache = null;
  return data;
}

/** Public registration always creates a STUDENT (role is decided by the database, never the client). */
export async function signUp({ email, password, fullName }) {
  const { data, error } = await requireClient().auth.signUp({
    email, password,
    options: { data: { full_name: fullName }, emailRedirectTo: url('auth/login.html') },
  });
  if (error) throw error;
  return data;
}

export async function signOut() {
  profileCache = null;
  await requireClient().auth.signOut();
  location.href = url('auth/login.html');
}

export async function sendPasswordReset(email) {
  const { error } = await requireClient().auth.resetPasswordForEmail(email, { redirectTo: url('auth/reset-password.html') });
  if (error) throw error;
}

export async function updatePassword(newPassword) {
  const { error } = await requireClient().auth.updateUser({ password: newPassword });
  if (error) throw error;
}

export function onAuthChange(cb) {
  return requireClient().auth.onAuthStateChange((event, session) => { profileCache = null; cb(event, session); });
}
