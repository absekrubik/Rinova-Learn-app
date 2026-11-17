// Topic mastery: teachers tag lessons and quiz questions with topics; students see how strong they are in each one.
// All numbers are worked out in the database from quiz results (see migration 016). Nothing here is trusted for security.
import { requireClient } from '../core/supabase.js';

const sb = requireClient;
export const NAME_MAX = 60, MAX_TOPICS = 40, MAX_TAGS = 3;

/** strong >= 80, ok 60-79, weak < 60, untested = no answers yet (same cut-offs as the database). */
export const LEVELS = {
  strong: { label: 'Strong', badge: 'badge-green', rank: 3 },
  ok: { label: 'Getting there', badge: 'badge-blue', rank: 2 },
  weak: { label: 'Needs revision', badge: 'badge-orange', rank: 1 },
  untested: { label: 'Not tested yet', badge: '', rank: 0 },
};
export const levelOf = (percent) => (percent == null ? 'untested' : percent >= 80 ? 'strong' : percent >= 60 ? 'ok' : 'weak');

/** Returns an error message or null. `existing` = names already used in the course. */
export function validateTopicName(name, existing = []) {
  const n = String(name ?? '').trim();
  if (!n) return 'Enter a topic name';
  if (n.length > NAME_MAX) return `Keep the name under ${NAME_MAX + 1} characters`;
  if (existing.some((e) => String(e).trim().toLowerCase() === n.toLowerCase())) return 'You already have a topic with that name';
  return null;
}
const friendly = (e) => {
  const m = String(e?.message ?? '');
  if (/duplicate key|topics_course_name/i.test(m)) return new Error('You already have a topic with that name');
  return e;
};

export async function listTopics(courseId) {
  const { data, error } = await sb().from('topics').select('id,course_id,name').eq('course_id', courseId).order('name');
  if (error) throw error; return data ?? [];
}
export async function addTopic(courseId, name) {
  const { data, error } = await sb().from('topics').insert({ course_id: courseId, name: String(name).trim() }).select('id,course_id,name').single();
  if (error) throw friendly(error); return data;
}
export async function renameTopic(id, name) {
  const { error } = await sb().from('topics').update({ name: String(name).trim() }).eq('id', id); if (error) throw friendly(error);
}
export async function deleteTopic(id) { const { error } = await sb().from('topics').delete().eq('id', id); if (error) throw error; }

const toMap = (rows, key) => { const m = new Map(); for (const r of rows ?? []) { if (!m.has(r[key])) m.set(r[key], new Set()); m.get(r[key]).add(r.topic_id); } return m; };
/** Map(lessonId -> Set(topicId)) for one course. */
export async function lessonTags(courseId) {
  const { data, error } = await sb().from('lesson_topics').select('lesson_id,topic_id').eq('course_id', courseId);
  if (error) throw error; return toMap(data, 'lesson_id');
}
/** Map(questionId -> Set(topicId)) for one course (staff only). */
export async function questionTags(courseId) {
  const { data, error } = await sb().from('question_topics').select('question_id,topic_id').eq('course_id', courseId);
  if (error) throw error; return toMap(data, 'question_id');
}
export async function setLessonTag(lessonId, topicId, on) {
  const q = sb().from('lesson_topics');
  const { error } = on ? await q.insert({ lesson_id: lessonId, topic_id: topicId }) : await q.delete().eq('lesson_id', lessonId).eq('topic_id', topicId);
  if (error) throw error;
}
export async function setQuestionTag(questionId, topicId, on) {
  const q = sb().from('question_topics');
  const { error } = on ? await q.insert({ question_id: questionId, topic_id: topicId }) : await q.delete().eq('question_id', questionId).eq('topic_id', topicId);
  if (error) throw error;
}

/** A student's own map. courseId = null covers every course they are in. */
export async function myMastery(courseId = null) {
  const { data, error } = await sb().rpc('my_mastery', { p_course: courseId });
  if (error) throw error; return data ?? [];
}
export async function classMastery(courseId) {
  const { data, error } = await sb().rpc('class_mastery', { p_course: courseId });
  if (error) throw error; return data ?? [];
}
export async function topicStudents(courseId, topicId) {
  const { data, error } = await sb().rpc('topic_students', { p_course: courseId, p_topic: topicId });
  if (error) throw error; return data ?? [];
}

/** Topics that need work first: weak ones, lowest first. */
export const weakTopics = (rows, limit = 5) => rows.filter((r) => r.level === 'weak').sort((a, b) => a.percent - b.percent).slice(0, limit);
export const pct = (v) => (v == null ? '–' : `${Math.round(Number(v))}%`);
