import { requireClient } from '../core/supabase.js';

export async function listRecent(limit = 5) {
  const { data, error } = await requireClient().from('announcements')
    .select('id,title,body,pinned,created_at,course:courses(title),author:profiles(full_name)')
    .order('pinned', { ascending: false }).order('created_at', { ascending: false }).limit(limit);
  if (error) throw error;
  return data;
}

// ---------- Phase 9: full announcements module ----------
export const LIMITS = { title: 200, body: 5000 };
const SELECT = 'id,course_id,author_id,title,body,pinned,created_at,course:courses(id,title),author:profiles(id,full_name)';
export function validate(v) {
  const title = (v.title ?? '').trim(), body = (v.body ?? '').trim();
  if (!title) return 'Add a title.'; if (title.length > LIMITS.title) return `Title is too long (${LIMITS.title} characters max).`;
  if (!body) return 'Write a message.'; if (body.length > LIMITS.body) return `Message is too long (${LIMITS.body} characters max).`;
  return null;
}
/** courseId: uuid = that course only; 'global' = site-wide only; null = everything the user can see */
export async function list({ courseId = null } = {}) {
  let q = requireClient().from('announcements').select(SELECT);
  if (courseId === 'global') q = q.is('course_id', null); else if (courseId) q = q.eq('course_id', courseId);
  const { data, error } = await q.order('pinned', { ascending: false }).order('created_at', { ascending: false }).limit(200);
  if (error) throw error; return data;
}
export async function create(courseId, v) {
  const err = validate(v); if (err) throw new Error(err);
  const { data, error } = await requireClient().from('announcements')
    .insert({ course_id: courseId || null, title: v.title.trim(), body: v.body.trim(), pinned: !!v.pinned }).select('id').single();
  if (error) throw error; return data;
}
export async function update(id, v) {
  const err = validate(v); if (err) throw new Error(err);
  const { error } = await requireClient().from('announcements').update({ title: v.title.trim(), body: v.body.trim(), pinned: !!v.pinned }).eq('id', id);
  if (error) throw error;
}
export async function setPinned(id, pinned) { const { error } = await requireClient().from('announcements').update({ pinned }).eq('id', id); if (error) throw error; }
export async function remove(id) { const { error } = await requireClient().from('announcements').delete().eq('id', id); if (error) throw error; }
