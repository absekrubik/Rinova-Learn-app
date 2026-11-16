// Assignments, submissions and grading. Access control = Row Level Security + storage policies.
import { requireClient } from '../core/supabase.js';
import { safeFileName } from './content.js';

export const ATTACH_TYPES = {
  'application/pdf': 'pdf', 'image/png': 'png', 'image/jpeg': 'jpg', 'application/zip': 'zip',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
};
export const SUBMISSION_TYPES = { ...ATTACH_TYPES, 'text/plain': 'txt' };
export const ATTACH_MAX = 50 * 1024 * 1024;       // Supabase free plan upload cap
export const SUBMISSION_MAX = 25 * 1024 * 1024;   // bucket limit
export const TEXT_MAX = 20000, FEEDBACK_MAX = 4000, TITLE_MAX = 200, INSTR_MAX = 10000;
const sb = () => requireClient();

const A_COLS = 'id,course_id,module_id,title,instructions,attachment_path,due_at,max_points,allow_late,is_published,created_at,courses(title)';

// ---------- derived state (the database enforces the same rules) ----------
/** 'draft' | 'no-deadline' | 'open' | 'overdue' (late work accepted) | 'closed' */
export function dueState(a, now = Date.now()) {
  if (!a.is_published) return 'draft';
  if (!a.due_at) return 'no-deadline';
  if (now <= new Date(a.due_at).getTime()) return 'open';
  return a.allow_late ? 'overdue' : 'closed';
}
/** Can the student send or change work right now? A returned submission can always be revised. */
export function canSubmit(a, sub, now = Date.now()) {
  if (!a.is_published) return false;
  if (sub?.status === 'graded') return false;
  if (sub?.status === 'returned') return true;
  return dueState(a, now) !== 'closed';
}
export function validateGrade(value, max) {
  const t = String(value ?? '').trim();
  if (!/^\d{1,5}(\.\d{1,2})?$/.test(t)) return { error: 'Enter a number such as 8 or 7.5' };
  const n = Number(t); if (n > Number(max)) return { error: `The maximum is ${max}` };
  return { value: n };
}
export const statusLabel = (sub) => (!sub ? 'Not submitted' : { submitted: 'Submitted', graded: 'Graded', returned: 'Returned' }[sub.status]);

// ---------- assignments ----------
export async function listAssignments({ courseId = null } = {}) {
  let q = sb().from('assignments').select(A_COLS);
  if (courseId) q = q.eq('course_id', courseId);
  const { data, error } = await q.order('due_at', { ascending: true }).limit(300); if (error) throw error; return data;
}
export async function getAssignment(id) {
  const { data, error } = await sb().from('assignments').select(A_COLS).eq('id', id).maybeSingle(); if (error) throw error; return data;
}
/** Staff: Map(assignment_id -> {submitted, graded, late}). */
export async function stats(courseId = null) {
  let q = sb().from('v_assignment_stats').select('assignment_id,submitted,graded,late'); if (courseId) q = q.eq('course_id', courseId);
  const { data, error } = await q; if (error) throw error; return new Map(data.map((r) => [r.assignment_id, r]));
}
/** Student: Map(assignment_id -> own submission). RLS only returns the student's own rows. */
export async function mySubmissions(studentId, courseId = null) {
  let q = sb().from('submissions').select('id,assignment_id,status,grade,is_late,submitted_at').eq('student_id', studentId);
  if (courseId) q = q.eq('course_id', courseId);
  const { data, error } = await q; if (error) throw error; return new Map(data.map((r) => [r.assignment_id, r]));
}
const fields = (v) => ({
  title: v.title.trim(), instructions: v.instructions?.trim() || null, due_at: v.due_at || null,
  max_points: v.max_points, allow_late: !!v.allow_late, is_published: !!v.is_published,
});
export async function createAssignment(courseId, v) {
  const { data, error } = await sb().from('assignments').insert({ course_id: courseId, ...fields(v) }).select('id,course_id,attachment_path').single();
  if (error) throw error; return data;
}
export async function updateAssignment(id, v) {
  const { error } = await sb().from('assignments').update(fields(v)).eq('id', id); if (error) throw error;
}
export async function setPublished(id, on) {
  const { error } = await sb().from('assignments').update({ is_published: on }).eq('id', id); if (error) throw error;
}
export function validateFile(file, types, max, label) {
  if (!types[file.type]) throw new Error(`${label}: this file type is not allowed (PDF, Word, PNG, JPG, ZIP${types['text/plain'] ? ', TXT' : ''}).`);
  if (file.size > max) throw new Error(`${label}: the file is larger than ${Math.round(max / 1048576)} MB.`);
}
/** Uploads the brief to assignment-files/<course>/<assignment>/<time>-<name> and links it. */
export async function uploadAttachment(a, file) {
  validateFile(file, ATTACH_TYPES, ATTACH_MAX, 'Attachment');
  const path = `${a.course_id}/${a.id}/${Date.now()}-${safeFileName(file.name)}`;
  const up = await sb().storage.from('assignment-files').upload(path, file, { contentType: file.type, upsert: false }); if (up.error) throw up.error;
  const { error } = await sb().from('assignments').update({ attachment_path: path }).eq('id', a.id);
  if (error) { await sb().storage.from('assignment-files').remove([path]).catch(() => {}); throw error; }
  if (a.attachment_path && a.attachment_path !== path) await sb().storage.from('assignment-files').remove([a.attachment_path]).catch(() => {});
  return path;
}
export async function clearAttachment(a) {
  const { error } = await sb().from('assignments').update({ attachment_path: null }).eq('id', a.id); if (error) throw error;
  if (a.attachment_path) await sb().storage.from('assignment-files').remove([a.attachment_path]).catch(() => {});
}
export async function deleteAssignment(a) {
  const subs = await sb().from('submissions').select('file_path').eq('assignment_id', a.id);
  const { error } = await sb().from('assignments').delete().eq('id', a.id); if (error) throw error;
  if (a.attachment_path) await sb().storage.from('assignment-files').remove([a.attachment_path]).catch(() => {});
  const files = (subs.data ?? []).map((s) => s.file_path).filter(Boolean);
  if (files.length) await sb().storage.from('submissions').remove(files).catch(() => {});
}
export async function signedUrl(bucket, path, download = false) {
  const { data, error } = await sb().storage.from(bucket).createSignedUrl(path, 3600, download ? { download: true } : undefined);
  if (error) throw error; return data.signedUrl;
}

// ---------- submissions ----------
export async function mySubmission(assignmentId, studentId) {
  const { data, error } = await sb().from('submissions').select('*').eq('assignment_id', assignmentId).eq('student_id', studentId).maybeSingle();
  if (error) throw error; return data;
}
/** Staff: every submission of an assignment with the student's profile. */
export async function listSubmissions(assignmentId) {
  const { data, error } = await sb().from('submissions').select('*, profiles:student_id(id,full_name,email,avatar_url)').eq('assignment_id', assignmentId).order('submitted_at', { ascending: true });
  if (error) throw error; return data;
}
/** Sends or updates work. `existing` is the student's current submission (or null). */
export async function submitWork(a, me, existing, { text, file, removeFile }) {
  const body = (text ?? '').trim();
  if (body.length > TEXT_MAX) throw new Error(`The answer is longer than ${TEXT_MAX} characters.`);
  if (file) validateFile(file, SUBMISSION_TYPES, SUBMISSION_MAX, 'File');
  const keepOld = existing?.file_path && !file && !removeFile;
  if (!body && !file && !keepOld) throw new Error('Write an answer or attach a file.');
  let path = keepOld ? existing.file_path : null, uploaded = null;
  if (file) {
    uploaded = `${a.course_id}/${a.id}/${me.id}/${Date.now()}-${safeFileName(file.name)}`;
    const up = await sb().storage.from('submissions').upload(uploaded, file, { contentType: file.type, upsert: false }); if (up.error) throw up.error;
    path = uploaded;
  }
  const row = { text_answer: body || null, file_path: path };
  const res = existing
    ? await sb().from('submissions').update(row).eq('id', existing.id)
    : await sb().from('submissions').insert({ assignment_id: a.id, student_id: me.id, ...row });
  if (res.error) { if (uploaded) await sb().storage.from('submissions').remove([uploaded]).catch(() => {}); throw res.error; }
  if (existing?.file_path && existing.file_path !== path) await sb().storage.from('submissions').remove([existing.file_path]).catch(() => {});
}
/** Teacher: grade (status becomes 'graded') or return for revision (status 'returned'; grade optional). */
export async function gradeSubmission(sub, a, { grade, feedback }) {
  const g = validateGrade(grade, a.max_points); if (g.error) throw new Error(g.error);
  const fb = (feedback ?? '').trim(); if (fb.length > FEEDBACK_MAX) throw new Error(`Feedback is longer than ${FEEDBACK_MAX} characters.`);
  const { error } = await sb().from('submissions').update({ grade: g.value, feedback: fb || null, status: 'graded' }).eq('id', sub.id); if (error) throw error;
}
export async function returnSubmission(sub, { feedback }) {
  const fb = (feedback ?? '').trim(); if (!fb) throw new Error('Tell the student what to change before returning the work.');
  if (fb.length > FEEDBACK_MAX) throw new Error(`Feedback is longer than ${FEEDBACK_MAX} characters.`);
  const { error } = await sb().from('submissions').update({ feedback: fb, status: 'returned' }).eq('id', sub.id); if (error) throw error;
}
