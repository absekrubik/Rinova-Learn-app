// Courses, co-teachers and enrollments. All access control is enforced by Row Level Security in the database;
// this module only builds the queries.
import { requireClient } from '../core/supabase.js';
import { SUPABASE_URL } from '../config.js';

export const COURSE_STATUS = ['draft', 'published', 'archived'];
export const LEVELS = ['Beginner', 'Intermediate', 'Advanced'];
export const ENROLL_STATUS = ['active', 'completed', 'dropped'];
export const THUMB_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
export const THUMB_MAX = 5 * 1024 * 1024;

const cleanQuery = (q) => q.replace(/[,()*%\\]/g, ' ').trim();

/** Public URL of a thumbnail. Only paths of the form <uuid>/<file> are trusted (the column is user-editable text). */
export function thumbUrl(path) {
  if (typeof path !== 'string' || !/^[0-9a-f-]{36}\/[A-Za-z0-9._-]+$/i.test(path)) return null;
  return `${SUPABASE_URL}/storage/v1/object/public/course-thumbnails/${path}`;
}

const LIST_SELECT = '*, course_teachers(is_lead, teacher_id, profiles(id,full_name)), enrollments(count)';

export async function listCourses({ q = '', status = '' } = {}) {
  let query = requireClient().from('courses').select(LIST_SELECT);
  const term = cleanQuery(q);
  if (term) query = query.or(`title.ilike.%${term}%,category.ilike.%${term}%`);
  if (status) query = query.eq('status', status);
  const { data, error } = await query.order('created_at', { ascending: false }).limit(100);
  if (error) throw error;
  return data;
}

export async function getCourse(id) {
  const { data, error } = await requireClient().from('courses').select(LIST_SELECT).eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
}

const fields = ({ title, description, category, level, status }) => ({
  title: (title ?? '').trim(), description: description?.trim() || null, category: category?.trim() || null,
  level: level || null, status,
});

export async function createCourse(values, userId) {
  const { data, error } = await requireClient().from('courses').insert({ ...fields(values), created_by: userId }).select('*').single();
  if (error) throw error;
  return data;
}

export async function updateCourse(id, values) {
  const { data, error } = await requireClient().from('courses').update(fields(values)).eq('id', id).select('*').single();
  if (error) throw error;
  return data;
}

export async function deleteCourse(id) {
  const { error } = await requireClient().from('courses').delete().eq('id', id);
  if (error) throw error;
}

export function validateThumb(file) {
  if (!THUMB_TYPES[file.type]) throw new Error('Please choose a PNG, JPG or WebP image.');
  if (file.size > THUMB_MAX) throw new Error('The image must be 5 MB or smaller.');
}

/** Uploads course-thumbnails/<courseId>/<file>, stores the path on the course, removes the previous file. */
export async function uploadThumbnail(courseId, file, oldPath) {
  validateThumb(file);
  const sb = requireClient();
  const path = `${courseId}/thumb-${Date.now()}.${THUMB_TYPES[file.type]}`;
  const { error: upErr } = await sb.storage.from('course-thumbnails').upload(path, file, { contentType: file.type, upsert: false });
  if (upErr) throw upErr;
  const { error } = await sb.from('courses').update({ thumbnail_path: path }).eq('id', courseId);
  if (error) throw error;
  if (oldPath) await sb.storage.from('course-thumbnails').remove([oldPath]).catch(() => {});
  return path;
}

export async function removeThumbnail(courseId, oldPath) {
  const sb = requireClient();
  const { error } = await sb.from('courses').update({ thumbnail_path: null }).eq('id', courseId);
  if (error) throw error;
  if (oldPath) await sb.storage.from('course-thumbnails').remove([oldPath]).catch(() => {});
}

// ---------- co-teachers (admin writes) ----------
export async function listTeachers(courseId) {
  const { data, error } = await requireClient().from('course_teachers')
    .select('teacher_id,is_lead,profiles(id,full_name,email,avatar_url)').eq('course_id', courseId).order('is_lead', { ascending: false });
  if (error) throw error;
  return data;
}
export async function availableTeachers(excludeIds = []) {
  const { data, error } = await requireClient().from('profiles').select('id,full_name,email').eq('role', 'teacher').eq('status', 'active').order('full_name');
  if (error) throw error;
  const ex = new Set(excludeIds); return data.filter((t) => !ex.has(t.id));
}
export async function addTeacher(courseId, teacherId) {
  const { error } = await requireClient().from('course_teachers').insert({ course_id: courseId, teacher_id: teacherId });
  if (error) throw error;
}
export async function removeTeacher(courseId, teacherId) {
  const { error } = await requireClient().from('course_teachers').delete().eq('course_id', courseId).eq('teacher_id', teacherId);
  if (error) throw error;
}
/** Makes one teacher the lead (clears the flag on the others). */
export async function setLead(courseId, teacherId) {
  const sb = requireClient();
  const a = await sb.from('course_teachers').update({ is_lead: false }).eq('course_id', courseId).neq('teacher_id', teacherId);
  if (a.error) throw a.error;
  const b = await sb.from('course_teachers').update({ is_lead: true }).eq('course_id', courseId).eq('teacher_id', teacherId);
  if (b.error) throw b.error;
}

// ---------- enrollments (teachers/admins write) ----------
export async function listEnrollments(courseId) {
  const { data, error } = await requireClient().from('enrollments')
    .select('id,student_id,status,enrolled_at,profiles:student_id(id,full_name,email,avatar_url)').eq('course_id', courseId).order('enrolled_at', { ascending: false });
  if (error) throw error;
  return data;
}
export async function searchStudents(q, excludeIds = [], limit = 20) {
  let query = requireClient().from('profiles').select('id,full_name,email,avatar_url').eq('role', 'student').eq('status', 'active');
  const term = cleanQuery(q);
  if (term) query = query.or(`full_name.ilike.%${term}%,email.ilike.%${term}%`);
  const ex = new Set(excludeIds);
  const { data, error } = await query.order('full_name').limit(limit + ex.size);
  if (error) throw error;
  return data.filter((s) => !ex.has(s.id)).slice(0, limit);
}
export async function enroll(courseId, studentIds) {
  if (!studentIds.length) return;
  const { error } = await requireClient().from('enrollments').insert(studentIds.map((student_id) => ({ course_id: courseId, student_id })));
  if (error) throw error;
}
export async function setEnrollmentStatus(id, status) {
  const { error } = await requireClient().from('enrollments').update({ status }).eq('id', id);
  if (error) throw error;
}
export async function unenroll(id) {
  const { error } = await requireClient().from('enrollments').delete().eq('id', id);
  if (error) throw error;
}
