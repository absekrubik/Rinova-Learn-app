// Questions and answers on a lesson, optionally pinned to a moment of the video. Access follows the lesson itself (migration 017).
import { requireClient } from '../core/supabase.js';

const sb = requireClient;
export const BODY_MAX = 1000, TIME_MAX = 86400;

/** 272 -> "4:32", 3725 -> "1:02:05" */
export function fmtTime(sec) {
  const s = Math.max(0, Math.floor(Number(sec) || 0)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60, p = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${p(m)}:${p(r)}` : `${m}:${p(r)}`;
}
/** "4:32", "1:02:05" or "272" -> seconds. Empty -> { value: null }. Anything else -> { error }. */
export function parseTime(text) {
  const t = String(text ?? '').trim();
  if (!t) return { value: null };
  if (!/^\d{1,5}(:\d{1,2}){0,2}$/.test(t)) return { error: 'Use minutes and seconds, like 4:32' };
  const parts = t.split(':').map(Number);
  if (parts.length > 1 && parts.slice(1).some((n) => n > 59)) return { error: 'Seconds and minutes must be under 60' };
  const sec = parts.reduce((a, n) => a * 60 + n, 0);
  return sec > TIME_MAX ? { error: 'That time is too long' } : { value: sec };
}
export function validateBody(body) {
  const b = String(body ?? '').trim();
  return !b ? 'Write your question first' : b.length > BODY_MAX ? `Keep it under ${BODY_MAX + 1} characters` : null;
}

/** Rows from lesson_thread() -> questions with their replies. Pinned first, then by video time, then newest untimed last. */
export function groupThread(rows) {
  const qs = rows.filter((r) => !r.parent_id).map((q) => ({ ...q, replies: [] }));
  const byId = new Map(qs.map((q) => [q.id, q]));
  for (const r of rows) if (r.parent_id) byId.get(r.parent_id)?.replies.push(r);
  for (const q of qs) q.replies.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  return qs.sort((a, b) => (b.is_pinned - a.is_pinned)
    || ((a.at_seconds ?? Infinity) - (b.at_seconds ?? Infinity))
    || (new Date(a.created_at) - new Date(b.created_at)));
}

export async function thread(lessonId) {
  const { data, error } = await sb().rpc('lesson_thread', { p_lesson: lessonId });
  if (error) throw error; return data ?? [];
}
export async function ask(lessonId, body, atSeconds = null) {
  const { error } = await sb().from('lesson_questions').insert({ lesson_id: lessonId, body: String(body).trim(), at_seconds: atSeconds });
  if (error) throw error;
}
export async function reply(lessonId, parentId, body) {
  const { error } = await sb().from('lesson_questions').insert({ lesson_id: lessonId, parent_id: parentId, body: String(body).trim() });
  if (error) throw error;
}
export async function remove(id) { const { error } = await sb().from('lesson_questions').delete().eq('id', id); if (error) throw error; }
export async function setPinned(id, on) { const { error } = await sb().from('lesson_questions').update({ is_pinned: on }).eq('id', id); if (error) throw error; }
export async function setResolved(id, on) { const { error } = await sb().from('lesson_questions').update({ is_resolved: on }).eq('id', id); if (error) throw error; }

/** The teacher's queue of unanswered questions. */
export async function openQuestions(courseId = null) {
  const { data, error } = await sb().rpc('open_questions', { p_course: courseId });
  if (error) throw error; return data ?? [];
}
