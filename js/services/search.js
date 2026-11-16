// Global search. Every query goes through Row Level Security, so people only ever find what they are allowed to see.
import { requireClient } from '../core/supabase.js';
import { url } from '../core/utils.js';
const sb = () => requireClient();
const isId = (v) => /^[0-9a-f-]{36}$/i.test(v ?? '');
export const MIN_CHARS = 2, PER_GROUP = 5;
/** Strip characters that have meaning inside a PostgREST filter, and cap the length. */
export const cleanTerm = (q) => String(q ?? '').replace(/[,()*%\\:"']/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);

const snippet = (text, term) => {
  const t = String(text ?? '').replace(/\s+/g, ' '); const i = t.toLowerCase().indexOf(term.toLowerCase());
  if (i < 0) return t.slice(0, 80);
  const s = Math.max(0, i - 25); return (s ? '…' : '') + t.slice(s, s + 90) + (t.length > s + 90 ? '…' : '');
};

/** Pages of the app itself ("Quizzes", "Reports"…), filtered from the sidebar. */
export function pageMatches(nav, term) {
  const t = term.toLowerCase();
  return nav.flatMap((g) => g.items).filter((i) => i.href && i.text.toLowerCase().includes(t)).slice(0, 4).map((i) => ({ title: i.text, sub: 'Page', href: url(i.href) }));
}

export async function searchAll(q, role, nav = []) {
  const term = cleanTerm(q); if (term.length < MIN_CHARS) return [];
  const like = `%${term}%`, db = sb(), page = (name) => url(`${role}/${name}.html`);
  const jobs = [
    ['Courses', db.from('courses').select('id,title,category,status').or(`title.ilike.${like},category.ilike.${like}`).limit(PER_GROUP),
      (r) => ({ title: r.title, sub: [r.category, r.status !== 'published' ? r.status : ''].filter(Boolean).join(' · ') || 'Course', href: `${page('course')}?id=${r.id}` })],
    ['Lessons', db.from('lessons').select('id,title,type').ilike('title', like).limit(PER_GROUP),
      (r) => ({ title: r.title, sub: `Lesson · ${r.type}`, href: `${page('lesson')}?id=${r.id}` })],
    ['Materials', db.from('materials').select('id,title,course_id').ilike('title', like).limit(PER_GROUP),
      (r) => ({ title: r.title, sub: 'Course material', href: `${page('course')}?id=${r.course_id}` })],
    ['Assignments', db.from('assignments').select('id,title').ilike('title', like).limit(PER_GROUP),
      (r) => ({ title: r.title, sub: 'Assignment', href: `${page('assignment')}?id=${r.id}` })],
    ['Quizzes', db.from('quizzes').select('id,title').ilike('title', like).limit(PER_GROUP),
      (r) => ({ title: r.title, sub: 'Quiz', href: `${page('quiz')}?id=${r.id}` })],
    ['Live classes', db.from('live_classes').select('id,title,starts_at').ilike('title', like).limit(PER_GROUP),
      (r) => ({ title: r.title, sub: 'Live class', href: `${page('live')}?id=${r.id}` })],
    ['Announcements', db.from('announcements').select('id,title,body').or(`title.ilike.${like},body.ilike.${like}`).limit(PER_GROUP),
      (r) => ({ title: r.title, sub: snippet(r.body, term), href: `${page('announcements')}?id=${r.id}` })],
  ];
  if (role === 'admin') jobs.push(['People', db.from('profiles').select('id,full_name,email,role').or(`full_name.ilike.${like},email.ilike.${like}`).limit(PER_GROUP),
    (r) => ({ title: r.full_name || r.email, sub: `${r.role} · ${r.email}`, href: `${page('users')}?q=${encodeURIComponent(term)}` }), false]);
  const settled = await Promise.allSettled(jobs.map(([, p]) => p));
  const groups = [];
  const pages = pageMatches(nav, term); if (pages.length) groups.push({ label: 'Pages', items: pages });
  settled.forEach((s, i) => {
    if (s.status !== 'fulfilled' || s.value.error) { if (s.status === 'fulfilled') console.warn('search', jobs[i][0], s.value.error.message); return; }
    const items = (s.value.data ?? []).filter((r) => jobs[i][3] === false || isId(r.id)).map(jobs[i][2]);
    if (items.length) groups.push({ label: jobs[i][0], items });
  });
  return groups;
}
