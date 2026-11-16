// Early-warning list: which students may be falling behind. The database works the signals out (migration 014).
import { requireClient } from '../core/supabase.js';
const sb = () => requireClient();

export const NOTE_MAX = 300;
export async function list(courseId = null) {
  const { data, error } = await sb().rpc('at_risk_students', { p_course: courseId });
  if (error) throw error; return data ?? [];
}
export async function nudge(courseId, studentId, message = '') {
  const { error } = await sb().rpc('nudge_student', { p_course: courseId, p_student: studentId, p_message: message.trim() || null });
  if (error) throw error;
}

export const levelOf = (score) => (Number(score) >= 5 ? 'high' : Number(score) >= 3 ? 'medium' : 'low');
export const LEVELS = { high: { label: 'High', badge: 'badge-red' }, medium: { label: 'Medium', badge: 'badge-orange' }, low: { label: 'Low', badge: 'badge-blue' } };
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
/** Plain-language reasons, in the order a teacher would act on them. */
export function reasons(r) {
  const out = [];
  if (r.days_inactive >= 7) out.push(`No activity for ${r.days_inactive} days`);
  if (r.recent_absences >= 2) out.push(`Absent ${r.recent_absences} of the last 3 sessions`);
  if (r.overdue_assignments >= 1) out.push(`${plural(r.overdue_assignments, 'overdue assignment', 'overdue assignments')}`);
  if (r.late_submissions >= 2) out.push(`${r.late_submissions} late submissions`);
  if (r.failing_quizzes >= 1) out.push(`${plural(r.failing_quizzes, 'quiz', 'quizzes')} below the pass mark`);
  return out;
}
/** A nudge is blocked for 24 hours after the last one (the database enforces this too). */
export const canNudge = (r, now = Date.now()) => !r.last_nudged_at || now - new Date(r.last_nudged_at).getTime() >= 24 * 3600 * 1000;
