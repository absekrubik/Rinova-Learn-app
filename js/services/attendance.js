// Attendance sessions and records. Teachers/admins write; students read their own records (enforced by Row Level Security).
import { requireClient } from '../core/supabase.js';

export const STATUSES = ['present', 'late', 'absent', 'excused'];
export const NOTE_MAX = 300;
const sb = () => requireClient();

export async function listSessions(courseId) {
  const [s, c] = await Promise.all([
    sb().from('attendance_sessions').select('id,course_id,live_class_id,session_date,title,created_at').eq('course_id', courseId).order('session_date', { ascending: false }).order('created_at', { ascending: false }).limit(300),
    sb().from('v_attendance_sessions').select('session_id,present,late,absent,excused,total').eq('course_id', courseId),
  ]);
  if (s.error) throw s.error; if (c.error) throw c.error;
  const counts = new Map(c.data.map((r) => [r.session_id, r]));
  return s.data.map((x) => ({ ...x, counts: counts.get(x.id) ?? { present: 0, late: 0, absent: 0, excused: 0, total: 0 } }));
}
export async function getSession(id) {
  const { data, error } = await sb().from('attendance_sessions').select('id,course_id,live_class_id,session_date,title').eq('id', id).maybeSingle();
  if (error) throw error; return data;
}
export async function sessionForClass(liveClassId) {
  const { data, error } = await sb().from('attendance_sessions').select('id,course_id,live_class_id,session_date,title').eq('live_class_id', liveClassId).maybeSingle();
  if (error) throw error; return data;
}
export async function createSession(courseId, { title, session_date, live_class_id }) {
  const { data, error } = await sb().from('attendance_sessions').insert({ course_id: courseId, title: title.trim() || null, session_date, live_class_id: live_class_id || null }).select('id,course_id,live_class_id,session_date,title').single();
  if (error) throw error; return data;
}
export async function updateSession(id, { title, session_date }) {
  const { error } = await sb().from('attendance_sessions').update({ title: title.trim() || null, session_date }).eq('id', id); if (error) throw error;
}
export async function deleteSession(id) {
  const { error } = await sb().from('attendance_sessions').delete().eq('id', id); if (error) throw error;
}
export async function sessionRecords(sessionId) {
  const { data, error } = await sb().from('attendance_records').select('student_id,status,note').eq('session_id', sessionId);
  if (error) throw error; return new Map(data.map((r) => [r.student_id, r]));
}
/** rows: [{ student_id, status, note }] — inserts or updates in one request. */
export async function saveRecords(sessionId, rows) {
  const clean = rows.map((r) => {
    if (!STATUSES.includes(r.status)) throw new Error('Invalid attendance status');
    return { session_id: sessionId, student_id: r.student_id, status: r.status, note: (r.note ?? '').trim().slice(0, NOTE_MAX) || null };
  });
  const { error } = await sb().from('attendance_records').upsert(clean, { onConflict: 'session_id,student_id' }); if (error) throw error;
}
/** Staff: one row per student with counts and percent. Students: just their own row. */
export async function summary(courseId, studentId = null) {
  let q = sb().from('v_attendance_summary').select('student_id,present,late,absent,excused,total,percent').eq('course_id', courseId);
  if (studentId) q = q.eq('student_id', studentId);
  const { data, error } = await q; if (error) throw error; return data;
}
export async function myRecords(courseId, studentId) {
  const { data, error } = await sb().from('attendance_records').select('session_id,status,note').eq('course_id', courseId).eq('student_id', studentId);
  if (error) throw error; return new Map(data.map((r) => [r.session_id, r]));
}
