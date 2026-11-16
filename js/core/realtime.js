// Thin helper around Supabase Realtime channels (used for messages, notifications, announcements).
import { requireClient } from './supabase.js';

/** subscribe('notifications', { event: 'INSERT', filter: `user_id=eq.${id}` }, (payload) => ...) -> unsubscribe fn */
export function subscribe(table, { event = '*', filter } = {}, handler) {
  const sb = requireClient();
  const name = `rt:${table}:${Math.random().toString(36).slice(2)}`;
  const cfg = { event, schema: 'public', table, ...(filter ? { filter } : {}) };
  const channel = sb.channel(name).on('postgres_changes', cfg, handler).subscribe();
  return () => sb.removeChannel(channel);
}
