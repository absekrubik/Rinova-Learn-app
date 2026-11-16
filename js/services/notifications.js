import { requireClient } from '../core/supabase.js';
import { subscribe } from '../core/realtime.js';

export async function list(limit = 10) {
  const { data, error } = await requireClient().from('notifications').select('*').order('created_at', { ascending: false }).limit(limit);
  if (error) throw error;
  return data;
}
export async function unreadCount() {
  const { count, error } = await requireClient().from('notifications').select('id', { count: 'exact', head: true }).eq('is_read', false);
  if (error) throw error;
  return count ?? 0;
}
export async function markRead(id) {
  const { error } = await requireClient().from('notifications').update({ is_read: true }).eq('id', id);
  if (error) throw error;
}
export async function markAllRead() {
  const { error } = await requireClient().from('notifications').update({ is_read: true }).eq('is_read', false);
  if (error) throw error;
}
export const onNew = (userId, cb) => subscribe('notifications', { event: 'INSERT', filter: `user_id=eq.${userId}` }, (p) => cb(p.new));
