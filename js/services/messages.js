// Direct messages and course chats. Everything is protected by RLS / SECURITY DEFINER functions in migration 012.
import { requireClient } from '../core/supabase.js';
import { subscribe } from '../core/realtime.js';
import { safeFileName } from './content.js';
const sb = () => requireClient();

export const LIMITS = { body: 4000, file: 10 * 1024 * 1024, types: ['application/pdf', 'image/png', 'image/jpeg'] };
export const BUCKET = 'message-attachments';

export function validateMessage(body, file) {
  const t = (body ?? '').trim();
  if (!t && !file) return 'Write a message or attach a file.';
  if (t.length > LIMITS.body) return `Message is too long (${LIMITS.body} characters max).`;
  if (file) {
    if (!LIMITS.types.includes(file.type)) return 'Attachments must be PDF, PNG or JPG files.';
    if (file.size > LIMITS.file) return 'Attachments can be 10 MB at most.';
    if (file.size === 0) return 'That file is empty.';
  }
  return null;
}
export async function conversations() { const { data, error } = await sb().rpc('my_conversations'); if (error) throw error; return data ?? []; }
export async function thread(id, { limit = 60, before = null } = {}) {
  const { data, error } = await sb().rpc('conversation_messages', { p_conv: id, p_limit: limit, p_before: before }); if (error) throw error; return data ?? [];
}
export async function markRead(id) { const { error } = await sb().rpc('mark_conversation_read', { p_conv: id }); if (error) throw error; }
export async function people(q = '') { const { data, error } = await sb().rpc('messageable_users', { p_query: q || null }); if (error) throw error; return data ?? []; }
export async function startDirect(userId) { const { data, error } = await sb().rpc('get_or_create_direct_conversation', { p_other: userId }); if (error) throw error; return data; }
export async function openCourseChat(courseId) { const { data, error } = await sb().rpc('get_or_create_course_conversation', { p_course: courseId }); if (error) throw error; return data; }

export async function send(conversationId, body, file = null) {
  const err = validateMessage(body, file); if (err) throw new Error(err);
  let path = null;
  if (file) {
    path = `${conversationId}/${Date.now()}-${safeFileName(file.name)}`;
    const up = await sb().storage.from(BUCKET).upload(path, file, { contentType: file.type, upsert: false }); if (up.error) throw up.error;
  }
  const { error } = await sb().from('messages').insert({ conversation_id: conversationId, body: (body ?? '').trim() || null, attachment_path: path });
  if (error) { if (path) await sb().storage.from(BUCKET).remove([path]).catch(() => {}); throw error; }
}
export async function remove(message) {
  const { error } = await sb().from('messages').delete().eq('id', message.id); if (error) throw error;
  if (message.attachment_path) await sb().storage.from(BUCKET).remove([message.attachment_path]).catch(() => {});
}
export async function attachmentUrl(path) {
  const { data, error } = await sb().storage.from(BUCKET).createSignedUrl(path, 3600); if (error) throw error; return data.signedUrl;
}
export const fileLabel = (path) => (path ?? '').split('/').pop().replace(/^\d+-/, '');
/** Calls back whenever a message arrives in a conversation the user can read (RLS filters what Realtime sends). */
export const onMessage = (cb) => subscribe('messages', { event: 'INSERT' }, (p) => cb(p.new));
