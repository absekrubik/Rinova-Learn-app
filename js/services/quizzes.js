// Quizzes: builder (teachers/admins) and attempts (students). Correct answers never reach a student's browser while a quiz is in progress:
// questions come from a server function without answer data, and scoring happens in the database.
import { requireClient } from '../core/supabase.js';
import { applyOrder } from './content.js';

export const TYPES = { single: 'Single choice', multiple: 'Multiple choice', true_false: 'True / False', short_text: 'Short text' };
export const LIMITS = { title: 200, description: 5000, prompt: 2000, option: 500, explanation: 2000, answer: 200, minutesMax: 600, attemptsMax: 20, options: 10, questions: 100, text: 1000 };
const sb = () => requireClient();
const Q_COLS = 'id,course_id,title,description,time_limit_minutes,max_attempts,available_from,available_until,pass_percent,shuffle_questions,show_results,reveal_answers,is_published,created_at,courses(title)';

// ---------- derived state ----------
/** 'draft' | 'upcoming' | 'open' | 'closed' */
export function availability(q, now = Date.now()) {
  if (!q.is_published) return 'draft';
  if (q.available_from && now < new Date(q.available_from).getTime()) return 'upcoming';
  if (q.available_until && now > new Date(q.available_until).getTime()) return 'closed';
  return 'open';
}
/** Attempts a student can still start (Infinity when unlimited). In-progress attempts do not count as used. */
export const attemptsLeft = (q, attempts) => (q.max_attempts == null ? Infinity : Math.max(0, q.max_attempts - attempts.filter((a) => a.status !== 'in_progress').length));
export const percent = (score, max) => (max > 0 ? Math.round((1000 * Number(score)) / Number(max)) / 10 : 0);

// ---------- quizzes ----------
export async function listQuizzes({ courseId = null } = {}) {
  let q = sb().from('quizzes').select(Q_COLS);
  if (courseId) q = q.eq('course_id', courseId);
  const { data, error } = await q.order('created_at', { ascending: false }).limit(300); if (error) throw error; return data;
}
export async function getQuiz(id) {
  const { data, error } = await sb().from('quizzes').select(Q_COLS).eq('id', id).maybeSingle(); if (error) throw error; return data;
}
/** Staff: Map(quiz_id -> {attempts, pending, average_percent}). */
export async function stats(courseId = null) {
  let q = sb().from('v_quiz_stats').select('quiz_id,attempts,pending,average_percent'); if (courseId) q = q.eq('course_id', courseId);
  const { data, error } = await q; if (error) throw error; return new Map(data.map((r) => [r.quiz_id, r]));
}
export async function myAttempts(courseId = null) {
  const { data, error } = await sb().rpc('my_quiz_attempts', { p_course_id: courseId }); if (error) throw error; return data ?? [];
}
const fields = (v) => ({
  title: v.title.trim(), description: v.description?.trim() || null,
  time_limit_minutes: v.time_limit_minutes ?? null, max_attempts: v.max_attempts ?? null, pass_percent: v.pass_percent,
  available_from: v.available_from ?? null, available_until: v.available_until ?? null,
  shuffle_questions: !!v.shuffle_questions, show_results: !!v.show_results, reveal_answers: !!v.show_results && !!v.reveal_answers,
});
export async function createQuiz(courseId, v) {
  const { data, error } = await sb().from('quizzes').insert({ course_id: courseId, ...fields(v) }).select('id,course_id').single(); if (error) throw error; return data;
}
export async function updateQuiz(id, v) { const { error } = await sb().from('quizzes').update(fields(v)).eq('id', id); if (error) throw error; }
export async function setPublished(id, on) { const { error } = await sb().from('quizzes').update({ is_published: on }).eq('id', id); if (error) throw error; }
export async function deleteQuiz(id) { const { error } = await sb().from('quizzes').delete().eq('id', id); if (error) throw error; }
export async function hasAttempts(quizId) {
  const { data, error } = await sb().from('quiz_attempts').select('id').eq('quiz_id', quizId).limit(1); if (error) throw error; return data.length > 0;
}

// ---------- questions (staff) ----------
export async function loadQuestions(quizId) {
  const { data, error } = await sb().from('quiz_questions').select('*, quiz_options(*), quiz_answer_keys(*)').eq('quiz_id', quizId).order('position').order('id');
  if (error) throw error;
  return data.map((q) => {
    const key = Array.isArray(q.quiz_answer_keys) ? q.quiz_answer_keys[0] : q.quiz_answer_keys;
    const options = (q.quiz_options ?? []).slice().sort((a, b) => a.position - b.position);
    return { id: q.id, type: q.type, prompt: q.prompt, points: Number(q.points), explanation: q.explanation, position: q.position, options,
      correct_ids: key?.correct_option_ids ?? [], accepted_text: key?.accepted_text ?? [] };
  });
}
/** Returns an error message or null. `q` = { type, prompt, points, options:[{label,correct}], accepted:[string] } */
export function validateQuestion(q) {
  if (!q.prompt?.trim()) return 'Write the question.';
  if (q.prompt.length > LIMITS.prompt) return `The question is longer than ${LIMITS.prompt} characters.`;
  if (!(Number(q.points) >= 0 && Number(q.points) <= 1000)) return 'Points must be between 0 and 1000.';
  if ((q.explanation ?? '').length > LIMITS.explanation) return `The explanation is longer than ${LIMITS.explanation} characters.`;
  if (q.type === 'short_text') {
    if ((q.accepted ?? []).some((a) => a.length > LIMITS.answer)) return `An accepted answer is longer than ${LIMITS.answer} characters.`;
    if ((q.accepted ?? []).length > 20) return 'At most 20 accepted answers.';
    return null;
  }
  const opts = q.options ?? [];
  if (opts.length < 2) return 'Add at least two options.';
  if (opts.length > LIMITS.options) return `At most ${LIMITS.options} options.`;
  if (opts.some((o) => !o.label?.trim())) return 'Every option needs text.';
  if (opts.some((o) => o.label.length > LIMITS.option)) return `An option is longer than ${LIMITS.option} characters.`;
  const n = opts.filter((o) => o.correct).length;
  if (n === 0) return 'Mark the correct answer.';
  if (q.type !== 'multiple' && n > 1) return 'This question type has exactly one correct option.';
  return null;
}
/** Creates a question (id omitted) or updates one. `locked` = the quiz already has attempts: only wording can change. */
export async function saveQuestion(quizId, q, { position = 0, locked = false } = {}) {
  const err = validateQuestion(q); if (err) throw new Error(err);
  const base = { prompt: q.prompt.trim(), explanation: q.explanation?.trim() || null };
  let id = q.id;
  if (!id) {
    const { data, error } = await sb().from('quiz_questions').insert({ quiz_id: quizId, type: q.type, points: Number(q.points), position, ...base }).select('id').single(); if (error) throw error; id = data.id;
    try { await writeOptions(id, q, []); } catch (e) { await sb().from('quiz_questions').delete().eq('id', id); throw e; }
    return id;
  }
  const upd = locked ? base : { ...base, type: q.type, points: Number(q.points) };
  const { error } = await sb().from('quiz_questions').update(upd).eq('id', id); if (error) throw error;
  if (locked) {   // labels can be fixed; structure and answers cannot
    for (const o of q.options ?? []) if (o.id) { const r = await sb().from('quiz_options').update({ label: o.label.trim() }).eq('id', o.id); if (r.error) throw r.error; }
  } else await writeOptions(id, q, q.existingOptionIds ?? []);
  return id;
}
async function writeOptions(id, q, existing) {
  if (q.type === 'short_text') {
    if (existing.length) { const r = await sb().from('quiz_options').delete().eq('question_id', id); if (r.error) throw r.error; }
    return saveKey(id, [], (q.accepted ?? []).map((a) => a.trim()).filter(Boolean));
  }
  const keep = new Set((q.options ?? []).map((o) => o.id).filter(Boolean));
  const gone = existing.filter((x) => !keep.has(x));
  await saveKey(id, [], []);                                              // clear the key first so removed options leave no dangling answer
  if (gone.length) { const r = await sb().from('quiz_options').delete().in('id', gone); if (r.error) throw r.error; }
  const correct = [];
  for (const [i, o] of q.options.entries()) {
    if (o.id) { const r = await sb().from('quiz_options').update({ label: o.label.trim(), position: i }).eq('id', o.id); if (r.error) throw r.error; if (o.correct) correct.push(o.id); }
    else { const r = await sb().from('quiz_options').insert({ question_id: id, label: o.label.trim(), position: i }).select('id').single(); if (r.error) throw r.error; if (o.correct) correct.push(r.data.id); }
  }
  await saveKey(id, correct, []);
}
async function saveKey(questionId, correct, accepted) {
  const { error } = await sb().from('quiz_answer_keys').upsert({ question_id: questionId, correct_option_ids: correct, accepted_text: accepted }, { onConflict: 'question_id' }); if (error) throw error;
}
export async function deleteQuestion(id) { const { error } = await sb().from('quiz_questions').delete().eq('id', id); if (error) throw error; }
export const reorderQuestions = (list) => applyOrder('quiz_questions', list);

// ---------- attempts (students) ----------
/** Starts or resumes an attempt. Returns the attempt id, or null when no attempt is left. */
export async function startAttempt(quizId) {
  const { data, error } = await sb().rpc('start_quiz_attempt', { p_quiz_id: quizId }); if (error) throw error; return data;
}
export async function attemptQuestions(attemptId) {
  const { data, error } = await sb().rpc('get_attempt_questions', { p_attempt_id: attemptId }); if (error) throw error; return data;
}
/** answers: Map(question_id -> { option_ids:[], text:'' }) */
export async function submitAttempt(attemptId, answers) {
  const responses = [...answers].map(([question_id, a]) => ({ question_id, option_ids: a.option_ids ?? [], text: (a.text ?? '').slice(0, LIMITS.text) }));
  const { data, error } = await sb().rpc('submit_quiz_attempt', { p_attempt_id: attemptId, p_responses: responses }); if (error) throw error; return data;
}
export async function attemptReview(attemptId) {
  const { data, error } = await sb().rpc('get_attempt_review', { p_attempt_id: attemptId }); if (error) throw error; return data;
}

// ---------- attempts (staff) ----------
export async function listAttempts(quizId) {
  const { data, error } = await sb().from('quiz_attempts').select('id,student_id,status,started_at,submitted_at,score,max_score, profiles:student_id(id,full_name,email,avatar_url)')
    .eq('quiz_id', quizId).neq('status', 'in_progress').order('submitted_at', { ascending: false }).limit(500);
  if (error) throw error; return data;
}
export async function gradeResponse(responseId, points, max) {
  const t = String(points ?? '').trim();
  if (!/^\d{1,4}(\.\d{1,2})?$/.test(t) || Number(t) > Number(max)) throw new Error(`Enter points from 0 to ${max}.`);
  const { error } = await sb().rpc('grade_quiz_response', { p_response_id: responseId, p_points: Number(t) }); if (error) throw error;
}
