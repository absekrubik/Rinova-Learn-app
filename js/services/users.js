import { requireClient } from '../core/supabase.js';

// characters that have special meaning inside a PostgREST .or() filter
const cleanQuery = (q) => q.replace(/[,()*%\\]/g, ' ').trim();

export async function listUsers({ q = '', role = '', status = '', page = 0, pageSize = 15 } = {}) {
  let query = requireClient().from('profiles')
    .select('id,full_name,email,role,status,created_at,avatar_url', { count: 'exact' });
  const term = cleanQuery(q);
  if (term) query = query.or(`full_name.ilike.%${term}%,email.ilike.%${term}%`);
  if (role) query = query.eq('role', role);
  if (status) query = query.eq('status', status);
  const from = page * pageSize;
  const { data, count, error } = await query.order('created_at', { ascending: false }).range(from, from + pageSize - 1);
  if (error) throw error;
  return { rows: data, total: count ?? 0 };
}

export async function setRole(userId, role) {
  const { error } = await requireClient().rpc('set_user_role', { p_user: userId, p_role: role });
  if (error) throw error;
}
export async function setStatus(userId, status) {
  const { error } = await requireClient().rpc('set_user_status', { p_user: userId, p_status: status });
  if (error) throw error;
}

/** Admin-only: creates an account through the `create-user` Edge Function (service key stays server-side). */
export async function createUser({ email, password, full_name, role }) {
  const { data, error } = await requireClient().functions.invoke('create-user', { body: { email, password, full_name, role } });
  if (error) {
    const status = error.context?.status;
    let msg = error.message;
    try { const body = await error.context?.json?.(); msg = body?.error ?? body?.message ?? msg; } catch { /* keep default */ }
    if (status === 404) msg = 'Supabase has no function named "create-user". Deploy it under exactly that name (supabase/README.md step 5).';
    else if (status === 401) msg = 'Your session is not valid for this action. Sign out, sign in again and retry.';
    else if (error.name === 'FunctionsFetchError') msg = `Could not reach the create-user function. It is probably not deployed under exactly that name, or the browser blocked the request. (${error.message})`;
    throw new Error(msg);
  }
  return data;
}

/** Admin-only: sets a new password for any user through the `admin-set-password` Edge Function (the service key stays server-side). */
export async function adminSetPassword(userId, password) {
  const { data, error } = await requireClient().functions.invoke('admin-set-password', { body: { user_id: userId, password } });
  if (error) {
    const status = error.context?.status;
    let msg = error.message;
    try { const body = await error.context?.json?.(); msg = body?.error ?? body?.message ?? msg; } catch { /* keep default */ }
    if (status === 404 && /function/i.test(String(msg))) msg = 'Supabase has no function named "admin-set-password". Deploy it under exactly that name (supabase/README.md step 5).';
    else if (status === 401) msg = 'Your session is not valid for this action. Sign out, sign in again and retry.';
    else if (error.name === 'FunctionsFetchError') msg = `Could not reach the admin-set-password function. It is probably not deployed under exactly that name, or the browser blocked the request. (${error.message})`;
    throw new Error(msg);
  }
  return data;
}
