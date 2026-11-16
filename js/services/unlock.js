// Unlock rules: a lesson stays locked until the student has done something first.
// The database enforces it (migration 015). This file only reads and edits the rules and asks what a student may see.
import { requireClient } from '../core/supabase.js';
const sb = () => requireClient();

export const TYPES = { lesson: 'Complete a lesson', quiz: 'Pass a quiz', assignment: 'Submit an assignment' };
export const MAX_RULES = 10;

export async function listRules(courseId) {
  const { data, error } = await sb().from('unlock_rules').select('id,lesson_id,req_type,req_id,min_percent,created_at').eq('course_id', courseId).order('created_at');
  if (error) throw error; return data ?? [];
}
export async function addRule({ lessonId, type, reqId, minPercent = null }) {
  const row = { lesson_id: lessonId, req_type: type, req_id: reqId, min_percent: type === 'quiz' ? minPercent : null };
  const { error } = await sb().from('unlock_rules').insert(row); if (error) throw error;
}
export async function removeRule(id) { const { error } = await sb().from('unlock_rules').delete().eq('id', id); if (error) throw error; }

/** Student: every published lesson of the course with its lock state and what is missing (titles only, never content). */
export async function coursePath(courseId) {
  const { data, error } = await sb().rpc('course_path', { p_course: courseId });
  if (error) throw error; return data ?? [];
}
/** Student: why a lesson they cannot open is locked. null when it does not exist or is not theirs. */
export async function lessonGate(lessonId) {
  const { data, error } = await sb().rpc('lesson_gate', { p_lesson: lessonId });
  if (error) throw error; return data ?? null;
}

/** Validates the "add a rule" form before it is sent. Returns an error message or ''. */
export function validateRule({ type, reqId, minPercent }, existingCount = 0) {
  if (!TYPES[type]) return 'Choose what the student must do';
  if (!reqId) return 'Choose which item it is';
  if (existingCount >= MAX_RULES) return `A lesson can have at most ${MAX_RULES} rules`;
  if (type === 'quiz' && minPercent != null && (Number.isNaN(minPercent) || minPercent < 0 || minPercent > 100)) return 'The minimum score must be between 0 and 100';
  return '';
}
/** Plain-language text for one requirement ({type, title, min_percent, pass_percent}). */
export function requirementText(r) {
  const t = r.title ?? 'a removed item';
  if (r.type === 'lesson') return `Complete the lesson “${t}”`;
  if (r.type === 'quiz') { const p = r.min_percent ?? r.pass_percent; return `Pass the quiz “${t}”${p != null ? ` with at least ${Number(p)}%` : ''}`; }
  return `Submit the assignment “${t}”`;
}
