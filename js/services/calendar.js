// Calendar data: live classes, assignment deadlines and quiz windows the signed-in user can already see.
// Row Level Security decides what comes back, so a student only gets their own courses.
import { requireClient } from '../core/supabase.js';
import { url } from '../core/utils.js';

const sb = () => requireClient();
export const KINDS = {
  live: { label: 'Live class', badge: 'badge-blue' },
  assignment: { label: 'Assignment due', badge: 'badge-orange' },
  quiz_open: { label: 'Quiz opens', badge: 'badge-green' },
  quiz_close: { label: 'Quiz closes', badge: 'badge-red' },
};
export const WEEK_START = 0;           // 0 = Sunday first
const PAGE = { live: 'live', assignment: 'assignment', quiz_open: 'quiz', quiz_close: 'quiz' };

/** Local calendar day key, e.g. "2026-11-16". */
export const dayKey = (d) => { const x = new Date(d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };

/** Loads events whose time falls in [from, to). Returns a flat list sorted by time. */
export async function loadEvents(role, from, to) {
  const f = from.toISOString(), t = to.toISOString();
  const [live, asg, quiz] = await Promise.all([
    sb().from('live_classes').select('id,title,starts_at,ends_at,status,courses(title)').gte('starts_at', f).lt('starts_at', t).neq('status', 'cancelled').order('starts_at').limit(500),
    sb().from('assignments').select('id,title,due_at,is_published,courses(title)').eq('is_published', true).gte('due_at', f).lt('due_at', t).order('due_at').limit(500),
    sb().from('quizzes').select('id,title,available_from,available_until,is_published,courses(title)').eq('is_published', true).limit(500),
  ]);
  for (const r of [live, asg, quiz]) if (r.error) throw r.error;
  const link = (kind, id) => `${role}/${PAGE[kind]}.html?id=${id}`;
  const out = [];
  for (const c of live.data) out.push({ key: `live-${c.id}`, kind: 'live', title: c.title, course: c.courses?.title ?? '', start: new Date(c.starts_at), end: new Date(c.ends_at), href: link('live', c.id) });
  for (const a of asg.data) out.push({ key: `assignment-${a.id}`, kind: 'assignment', title: a.title, course: a.courses?.title ?? '', start: new Date(a.due_at), end: null, href: link('assignment', a.id) });
  for (const q of quiz.data) {
    const inRange = (v) => v && new Date(v) >= from && new Date(v) < to;
    if (inRange(q.available_from)) out.push({ key: `quiz_open-${q.id}`, kind: 'quiz_open', title: q.title, course: q.courses?.title ?? '', start: new Date(q.available_from), end: null, href: link('quiz_open', q.id) });
    if (inRange(q.available_until)) out.push({ key: `quiz_close-${q.id}`, kind: 'quiz_close', title: q.title, course: q.courses?.title ?? '', start: new Date(q.available_until), end: null, href: link('quiz_close', q.id) });
  }
  return out.sort((a, b) => a.start - b.start);
}

/** Cells for a month grid: whole weeks, each cell { date, inMonth }. */
export function monthGrid(year, month) {
  const first = new Date(year, month, 1);
  const lead = (first.getDay() - WEEK_START + 7) % 7;
  const days = new Date(year, month + 1, 0).getDate();
  const total = Math.ceil((lead + days) / 7) * 7;
  return Array.from({ length: total }, (_, i) => { const d = new Date(year, month, 1 - lead + i); return { date: d, inMonth: d.getMonth() === month }; });
}
export const groupByDay = (events) => events.reduce((m, e) => { (m[dayKey(e.start)] ??= []).push(e); return m; }, {});

// ---------- .ics export (RFC 5545) ----------
const icsText = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/;/g, '\\;').replace(/,/g, '\\,');
const icsTime = (d) => new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
/** Lines longer than 75 characters are folded onto continuation lines that start with a space. */
export function fold(line) {
  const parts = [];
  for (let i = 0; i < line.length; i += 74) parts.push(line.slice(i, i + 74));
  return parts.join('\r\n ');
}
export function toIcs(events, { now = new Date(), absolute = (p) => url(p) } = {}) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Rinova Learn//Calendar//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:Rinova Learn'];
  for (const e of events) {
    const end = e.end ?? new Date(e.start.getTime() + 30 * 60 * 1000);
    const prefix = e.kind === 'assignment' ? 'Due: ' : e.kind === 'quiz_open' ? 'Quiz opens: ' : e.kind === 'quiz_close' ? 'Quiz closes: ' : '';
    lines.push('BEGIN:VEVENT', `UID:${e.key}@rinova-learn`, `DTSTAMP:${icsTime(now)}`, `DTSTART:${icsTime(e.start)}`, `DTEND:${icsTime(end)}`,
      `SUMMARY:${icsText(prefix + e.title)}`, `DESCRIPTION:${icsText([e.course, KINDS[e.kind].label].filter(Boolean).join(' · '))}`, `URL:${absolute(e.href)}`, 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
export function downloadIcs(text, name = 'rinova-learn.ics') {
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([text], { type: 'text/calendar;charset=utf-8' })), download: name });
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
