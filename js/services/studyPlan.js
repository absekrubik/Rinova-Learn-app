// Smart study plan: a calm 7-day plan built from what is due, what is weak and what is next.
// It is only a suggestion, computed in the browser from data the student can already see. Nothing is stored on the server.
import { requireClient } from '../core/supabase.js';
import * as mastery from './mastery.js';
import * as quizApi from './quizzes.js';
import { coursePath } from './unlock.js';

const sb = requireClient;
export const DAYS = 7;
export const MINUTES_CHOICES = [30, 60, 90, 120];
export const DEFAULT_MINUTES = 60;
export const EST = { assignment: 45, quiz: 20, revise: 20, lesson: 15 };
export const KIND_LABEL = { assignment: 'Assignment', quiz: 'Quiz', revise: 'Revise', lesson: 'Next lesson' };

const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
export const dayKey = (d) => { const x = new Date(d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
const dayDiff = (a, b) => Math.round((startOfDay(a) - startOfDay(b)) / 86400000);

/**
 * Pure planner (easy to test).
 * tasks:  [{ id, kind, title, course, minutes, due: Date|null, href, overdue? }]
 * events: [{ id, title, course, start: Date, end: Date, href }]   fixed things like live classes; shown, never moved
 * Rules: overdue work goes on day 1; work with a deadline goes on a day BEFORE it (today if it is due today or tomorrow);
 * everything else goes on the lightest day. A day is "heavy" when it goes over the student's daily minutes.
 */
export function buildPlan(tasks, events, { now = new Date(), minutesPerDay = DEFAULT_MINUTES } = {}) {
  const today = startOfDay(now);
  const days = Array.from({ length: DAYS }, (_, i) => { const d = new Date(today); d.setDate(d.getDate() + i); return { date: d, key: dayKey(d), tasks: [], events: [], minutes: 0, heavy: false }; });
  const order = (t) => (t.overdue ? 0 : t.due ? 1 : t.kind === 'revise' ? 2 : 3);
  const sorted = tasks.slice().sort((a, b) => order(a) - order(b) || ((a.due?.getTime() ?? Infinity) - (b.due?.getTime() ?? Infinity)) || a.title.localeCompare(b.title));
  for (const t of sorted) {
    let latest = DAYS - 1;
    if (t.overdue) latest = 0;
    else if (t.due) { const left = dayDiff(t.due, today); latest = Math.max(0, Math.min(DAYS - 1, left - 1)); }
    let best = 0;
    for (let i = 0; i <= latest; i++) if (days[i].minutes < days[best].minutes) best = i;     // lightest day, earliest on a tie
    if (days[best].minutes + t.minutes > minutesPerDay) {                                       // prefer a day that still has room
      const fit = days.slice(0, latest + 1).findIndex((d) => d.minutes + t.minutes <= minutesPerDay);
      if (fit >= 0) best = fit;
    }
    days[best].tasks.push(t); days[best].minutes += t.minutes;
  }
  for (const e of events) { const i = dayDiff(e.start, today); if (i >= 0 && i < DAYS) days[i].events.push(e); }
  for (const d of days) { d.heavy = d.minutes > minutesPerDay; d.events.sort((a, b) => a.start - b.start); }
  const all = days.flatMap((d) => d.tasks);
  return { days, minutesPerDay, total: all.length, totalMinutes: all.reduce((n, t) => n + t.minutes, 0), overdue: all.filter((t) => t.overdue).length,
    heavyDays: days.filter((d) => d.heavy).length };
}

/** Everything the planner needs, read under the student's own access rules. */
export async function loadInputs(userHref = (p) => p) {
  const now = new Date(), horizon = new Date(now.getTime() + 14 * 86400000), back = new Date(now.getTime() - 14 * 86400000);
  const [asg, subs, quizzes, attempts, live, enr, weak] = await Promise.all([
    sb().from('assignments').select('id,title,due_at,allow_late,is_published,courses(title)').eq('is_published', true).limit(500),
    sb().from('submissions').select('assignment_id').limit(1000),
    sb().from('quizzes').select('id,title,available_from,available_until,time_limit_minutes,max_attempts,is_published,courses(title)').eq('is_published', true).limit(500),
    quizApi.myAttempts(),
    sb().from('live_classes').select('id,title,starts_at,ends_at,status,courses(title)').gte('starts_at', now.toISOString()).lt('starts_at', new Date(now.getTime() + 8 * 86400000).toISOString()).neq('status', 'cancelled').order('starts_at').limit(100),
    sb().from('enrollments').select('course_id,status,courses(title)').neq('status', 'dropped'),
    mastery.myMastery().catch(() => []),
  ]);
  for (const r of [asg, subs, quizzes, live, enr]) if (r.error) throw r.error;
  const tasks = [], submitted = new Set(subs.data.map((s) => s.assignment_id)), tried = new Set(attempts.filter((a) => a.status !== 'in_progress').map((a) => a.quiz_id));
  const inProgress = new Set(attempts.filter((a) => a.status === 'in_progress').map((a) => a.quiz_id));

  for (const a of asg.data) {
    if (submitted.has(a.id) || !a.due_at) continue;
    const due = new Date(a.due_at);
    if (due > horizon || due < back) continue;
    const overdue = due < now;
    if (overdue && !a.allow_late) continue;                         // can no longer be handed in
    tasks.push({ id: `assignment:${a.id}`, kind: 'assignment', title: a.title, course: a.courses?.title ?? '', minutes: EST.assignment, due, overdue, href: userHref(`assignment.html?id=${a.id}`) });
  }
  for (const q of quizzes.data) {
    if (tried.has(q.id)) continue;                                  // already taken (retakes are optional, so not planned)
    const from = q.available_from ? new Date(q.available_from) : null, until = q.available_until ? new Date(q.available_until) : null;
    if (until && until < now) continue; if (from && from > horizon) continue;
    if (until && until > horizon) continue;
    tasks.push({ id: `quiz:${q.id}`, kind: 'quiz', title: q.title, course: q.courses?.title ?? '', minutes: q.time_limit_minutes ? Math.min(60, q.time_limit_minutes) : EST.quiz, due: until, overdue: false, href: userHref(`quiz.html?id=${q.id}`), note: inProgress.has(q.id) ? 'Started' : '' });
  }
  // topics to revise: the weakest first (at most 4), pointing at a lesson they can open
  for (const w of mastery.weakTopics(weak, 4)) {
    const l = (w.lessons ?? []).find((x) => !x.locked && !x.completed) ?? (w.lessons ?? []).find((x) => !x.locked);
    if (!l) continue;
    tasks.push({ id: `revise:${w.topic_id}`, kind: 'revise', title: `Revise ${w.topic}`, course: w.course_title, minutes: EST.revise, due: null, overdue: false, href: userHref(`lesson.html?id=${l.id}`), note: `${Math.round(w.percent)}% so far` });
  }
  // keep going: the next lesson to open in each course
  await Promise.all(enr.data.map(async (e) => {
    try {
      const path = await coursePath(e.course_id), next = path.find((l) => !l.completed && !l.locked);
      if (next) tasks.push({ id: `lesson:${next.lesson_id}`, kind: 'lesson', title: next.title, course: e.courses?.title ?? '', minutes: next.duration_seconds ? Math.max(5, Math.min(45, Math.ceil(next.duration_seconds / 60))) : EST.lesson, due: null, overdue: false, href: userHref(`lesson.html?id=${next.lesson_id}`) });
    } catch (err) { console.warn('study plan: course path', err); }
  }));
  const events = live.data.map((c) => ({ id: `live:${c.id}`, title: c.title, course: c.courses?.title ?? '', start: new Date(c.starts_at), end: new Date(c.ends_at), href: userHref(`live.html?id=${c.id}`) }));
  return { tasks, events };
}
