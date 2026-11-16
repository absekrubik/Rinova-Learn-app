// Modules, lessons, videos, materials and learning progress. Access control = Row Level Security + storage policies.
import { coursePath } from './unlock.js';
import { requireClient } from '../core/supabase.js';

export const LESSON_TYPES = ['video', 'pdf', 'text'];
export const VIDEO_TYPES = { 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov' };
export const MATERIAL_TYPES = {
  'application/pdf': 'pdf', 'image/png': 'png', 'image/jpeg': 'jpg', 'application/zip': 'zip',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
};
// Supabase's free plan caps every upload at 50 MB. Longer videos: use an unlisted YouTube / Vimeo link instead.
export const UPLOAD_MAX = 50 * 1024 * 1024;

/** Accepts YouTube / Vimeo links only. Returns { provider, id, embedUrl, watchUrl } or null. The embed URL is rebuilt from the parsed ID, never copied from user text. */
export function parseVideoUrl(input) {
  let u; try { u = new URL(String(input ?? '').trim()); } catch { return null; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const host = u.hostname.replace(/^(www\.|m\.)/, '');
  const part = (i) => u.pathname.split('/').filter(Boolean)[i];
  let id = null;
  if (host === 'youtu.be') id = part(0);
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    if (u.pathname === '/watch') id = u.searchParams.get('v');
    else if (['embed', 'shorts', 'live', 'v'].includes(part(0))) id = part(1);
  }
  if (id && /^[A-Za-z0-9_-]{11}$/.test(id)) return { provider: 'youtube', id, embedUrl: `https://www.youtube-nocookie.com/embed/${id}`, watchUrl: `https://www.youtube.com/watch?v=${id}` };
  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    const segs = u.pathname.split('/').filter(Boolean);
    const vid = host === 'player.vimeo.com' ? (segs[0] === 'video' ? segs[1] : null) : segs.find((x) => /^\d+$/.test(x));
    if (vid && /^\d{4,12}$/.test(vid)) {
      const hash = u.searchParams.get('h') ?? (segs.length > 1 && /^[a-f0-9]{8,}$/i.test(segs[segs.length - 1]) && segs[segs.length - 1] !== vid ? segs[segs.length - 1] : null);
      const h = hash && /^[a-f0-9]{8,20}$/i.test(hash) ? `?h=${hash}` : '';
      return { provider: 'vimeo', id: vid, embedUrl: `https://player.vimeo.com/video/${vid}${h}`, watchUrl: `https://vimeo.com/${vid}` };
    }
  }
  return null;
}

export const safeFileName = (name) => name.normalize('NFKD').replace(/[^\w.-]+/g, '_').replace(/^\.+/, '').slice(-80) || 'file';
const sb = () => requireClient();

// ---------- reading ----------
/** Modules (ordered) each with an ordered `lessons` array.
 *  Teachers get every lesson. Students pass { student: true } and get the learning path instead: every published lesson,
 *  each with `locked`, `completed` and `requirements` (locked lessons carry only a title, never content). */
export async function loadCurriculum(courseId, { student = false } = {}) {
  if (student) {
    const [m, path] = await Promise.all([
      sb().from('modules').select('*').eq('course_id', courseId).order('position').order('created_at'),
      coursePath(courseId),
    ]);
    if (m.error) throw m.error;
    const lessons = path.map((p) => ({ id: p.lesson_id, module_id: p.module_id, title: p.title, type: p.type, duration_seconds: p.duration_seconds, position: p.position, is_published: true, locked: p.locked, completed: p.completed, requirements: p.requirements ?? [] }));
    return m.data.map((mod) => ({ ...mod, lessons: lessons.filter((x) => x.module_id === mod.id) }));
  }
  const [m, l] = await Promise.all([
    sb().from('modules').select('*').eq('course_id', courseId).order('position').order('created_at'),
    sb().from('lessons').select('id,module_id,title,type,video_source,duration_seconds,position,is_published').eq('course_id', courseId).order('position').order('created_at'),
  ]);
  if (m.error) throw m.error; if (l.error) throw l.error;
  return m.data.map((mod) => ({ ...mod, lessons: l.data.filter((x) => x.module_id === mod.id) }));
}
export async function getLesson(id) {
  const { data, error } = await sb().from('lessons').select('*, modules(id,title)').eq('id', id).maybeSingle();
  if (error) throw error; return data;
}
export async function listMaterials(courseId, lessonId = undefined) {
  let q = sb().from('materials').select('id,course_id,lesson_id,title,file_path,mime_type,size_bytes,created_at').eq('course_id', courseId).order('created_at');
  if (lessonId === null) q = q.is('lesson_id', null); else if (lessonId) q = q.eq('lesson_id', lessonId);
  const { data, error } = await q; if (error) throw error; return data;
}
export async function signedUrl(bucket, path, { download = false, seconds = 7200 } = {}) {
  const { data, error } = await sb().storage.from(bucket).createSignedUrl(path, seconds, download ? { download: true } : undefined);
  if (error) throw error; return data.signedUrl;
}

// ---------- modules ----------
export async function createModule(courseId, { title, description }, position) {
  const { data, error } = await sb().from('modules').insert({ course_id: courseId, title: title.trim(), description: description?.trim() || null, position }).select('*').single();
  if (error) throw error; return data;
}
export async function updateModule(id, { title, description }) {
  const { error } = await sb().from('modules').update({ title: title.trim(), description: description?.trim() || null }).eq('id', id);
  if (error) throw error;
}
/** Persist a new order: `items` are in their new order; only rows whose stored position differs are updated. */
export async function applyOrder(table, items) {
  for (let i = 0; i < items.length; i++) {
    if (items[i].position === i) continue;
    const { error } = await sb().from(table).update({ position: i }).eq('id', items[i].id); if (error) throw error;
  }
}
export async function deleteModule(mod) {
  const files = await filesOfLessons(mod.lessons.map((l) => l.id));
  const { error } = await sb().from('modules').delete().eq('id', mod.id); if (error) throw error;
  await removeFiles(files);
}

// ---------- lessons ----------
const lessonFields = (v) => ({
  title: v.title.trim(), type: v.type, content: v.content?.trim() || null,
  duration_seconds: v.duration_minutes ? Math.round(Number(v.duration_minutes) * 60) : null,
  is_published: !!v.is_published,
});
export async function createLesson(moduleId, v, position) {
  const { data, error } = await sb().from('lessons').insert({ module_id: moduleId, position, ...lessonFields(v), ...videoFields(v) }).select('*').single();
  if (error) throw error; return data;
}
export async function updateLesson(id, v, extra = {}) {
  const { data, error } = await sb().from('lessons').update({ ...lessonFields(v), ...extra }).eq('id', id).select('*').single();
  if (error) throw error; return data;
}
function videoFields(v) {
  if (v.type !== 'video') return { video_source: null, video_path: null, video_url: null };
  if (v.video_source === 'external') return { video_source: 'external', video_url: v.video_url, video_path: null };
  return {};
}
export async function moveLesson(id, moduleId, position) {
  const { error } = await sb().from('lessons').update({ module_id: moduleId, position }).eq('id', id); if (error) throw error;
}
export async function deleteLesson(lesson) {
  const files = await filesOfLessons([lesson.id]);
  const { error } = await sb().from('lessons').delete().eq('id', lesson.id); if (error) throw error;
  await removeFiles(files);
}

export function validateUpload(file, types, label) {
  if (!types[file.type]) throw new Error(`${label}: this file type is not allowed.`);
  if (file.size > UPLOAD_MAX) throw new Error(`${label}: the file is larger than 50 MB. For long videos use an unlisted YouTube or Vimeo link instead.`);
}
/** Uploads a lesson video to lesson-videos/<courseId>/<lessonId>/<time>.<ext> and points the lesson at it. Removes the previous file. */
export async function uploadLessonVideo(courseId, lesson, file) {
  validateUpload(file, VIDEO_TYPES, 'Video');
  const path = `${courseId}/${lesson.id}/${Date.now()}.${VIDEO_TYPES[file.type]}`;
  const up = await sb().storage.from('lesson-videos').upload(path, file, { contentType: file.type, upsert: false }); if (up.error) throw up.error;
  const { error } = await sb().from('lessons').update({ video_source: 'storage', video_path: path, video_url: null }).eq('id', lesson.id);
  if (error) { await sb().storage.from('lesson-videos').remove([path]).catch(() => {}); throw error; }
  if (lesson.video_path && lesson.video_path !== path) await sb().storage.from('lesson-videos').remove([lesson.video_path]).catch(() => {});
  return path;
}
export async function clearLessonVideoFile(lesson) {
  if (lesson.video_path) await sb().storage.from('lesson-videos').remove([lesson.video_path]).catch(() => {});
}

// ---------- materials ----------
/** Uploads to materials/<courseId>/<time>-<name> and records it (course-level when lessonId is null). */
export async function uploadMaterial(courseId, lessonId, file, title) {
  validateUpload(file, MATERIAL_TYPES, 'File');
  const path = `${courseId}/${Date.now()}-${safeFileName(file.name)}`;
  const up = await sb().storage.from('materials').upload(path, file, { contentType: file.type, upsert: false }); if (up.error) throw up.error;
  const { data, error } = await sb().from('materials').insert({ course_id: courseId, lesson_id: lessonId, title: (title || file.name).trim(), file_path: path, mime_type: file.type, size_bytes: file.size }).select('*').single();
  if (error) { await sb().storage.from('materials').remove([path]).catch(() => {}); throw error; }
  return data;
}
export async function deleteMaterial(m) {
  const { error } = await sb().from('materials').delete().eq('id', m.id); if (error) throw error;
  await sb().storage.from('materials').remove([m.file_path]).catch(() => {});
}

async function filesOfLessons(ids) {
  if (!ids.length) return { videos: [], materials: [] };
  const [l, m] = await Promise.all([
    sb().from('lessons').select('video_path').in('id', ids),
    sb().from('materials').select('file_path').in('lesson_id', ids),
  ]);
  return { videos: (l.data ?? []).map((x) => x.video_path).filter(Boolean), materials: (m.data ?? []).map((x) => x.file_path) };
}
async function removeFiles({ videos, materials }) {
  if (videos.length) await sb().storage.from('lesson-videos').remove(videos).catch(() => {});
  if (materials.length) await sb().storage.from('materials').remove(materials).catch(() => {});
}
/** Best-effort cleanup of every stored file of a course (call after the course row is deleted). */
export async function purgeCourseFiles(courseId) {
  for (const bucket of ['lesson-videos', 'materials', 'assignment-files', 'submissions', 'course-thumbnails']) {
    try {
      const paths = []; const walk = async (prefix, depth = 0) => {
        const { data } = await sb().storage.from(bucket).list(prefix, { limit: 1000 });
        for (const o of data ?? []) { if (o.id) paths.push(`${prefix}/${o.name}`); else if (depth < 3) await walk(`${prefix}/${o.name}`, depth + 1); }
      };
      await walk(courseId); if (paths.length) await sb().storage.from(bucket).remove(paths);
    } catch (e) { console.warn('purge', bucket, e); }
  }
}

// ---------- progress (students) ----------
export async function myProgress(courseId) {
  const { data, error } = await sb().from('lesson_progress').select('lesson_id,completed,last_position_seconds').eq('course_id', courseId);
  if (error) throw error; return new Map(data.map((p) => [p.lesson_id, p]));
}
/** Upsert only the columns provided (position and/or completed). */
export async function saveProgress(lessonId, studentId, patch) {
  const { error } = await sb().from('lesson_progress').upsert({ lesson_id: lessonId, student_id: studentId, ...patch }, { onConflict: 'lesson_id,student_id' });
  if (error) throw error;
}
export async function courseProgress(courseId, studentId = null) {
  let q = sb().from('v_course_progress').select('course_id,student_id,total_lessons,completed_lessons,percent').eq('course_id', courseId);
  if (studentId) q = q.eq('student_id', studentId);
  const { data, error } = await q; if (error) throw error; return data;
}
export async function allMyCourseProgress(studentId) {
  const { data, error } = await sb().from('v_course_progress').select('course_id,total_lessons,completed_lessons,percent').eq('student_id', studentId);
  if (error) throw error; return new Map(data.map((p) => [p.course_id, p]));
}
