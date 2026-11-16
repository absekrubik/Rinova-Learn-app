// A student's own progress and grades across all enrolled courses.
import { mountShell } from '../ui/shell.js';
import { html, raw, url, formatDate } from '../core/utils.js';
import { emptyState, errorState, skeletonRows } from '../ui/states.js';
import * as api from '../services/reports.js';

const role = document.body.dataset.role;
const { content } = await mountShell({ roles: [role], active: `${role}/grades.html`, title: 'Grades' });
content.innerHTML = html`<div class="page-head"><div><h1>Grades</h1><p>Your progress, attendance and results in every course.</p></div></div><div id="list">${raw(skeletonRows(3))}</div>`;
const box = content.querySelector('#list');
const STATUS = { submitted: ['Waiting for grade', 'badge-blue'], graded: ['Graded', 'badge-green'], returned: ['Returned to you', 'badge-orange'] };
const bar = (v) => `<div class="progress" aria-hidden="true"><span style="width:${Math.max(0, Math.min(100, Number(v) || 0))}%"></span></div>`;
try {
  const courses = await api.myGrades();
  if (!courses.length) box.innerHTML = `<div class="card">${emptyState('No grades yet', 'Once you are enrolled in a course, your progress and results appear here.')}</div>`;
  else box.innerHTML = courses.map((c) => {
    const lp = c.total_lessons ? Math.round((1000 * c.completed_lessons) / c.total_lessons) / 10 : 0, at = c.attendance ?? {}, ass = c.assignments ?? [], qz = c.quizzes ?? [];
    const graded = ass.filter((a) => a.percent != null), avgA = api.mean(graded.map((a) => a.percent)), avgQ = api.mean(qz.map((q) => q.best_percent));
    return html`<section class="card" style="padding:var(--sp-4);margin-bottom:var(--sp-4)"><div class="row row-between" style="flex-wrap:wrap;gap:var(--sp-2)"><h3 style="margin:0"><a href="${url('student/course.html')}?id=${c.course_id}">${c.title}</a></h3></div>
      <div class="grid grid-3" style="margin:var(--sp-3) 0"><div><div class="text-muted text-sm">Lessons</div><strong>${Number(c.completed_lessons)} of ${Number(c.total_lessons)} (${lp}%)</strong>${raw(bar(lp))}</div>
        <div><div class="text-muted text-sm">Attendance</div><strong>${api.pct(at.percent)}</strong><div class="text-muted text-sm">${Number(at.present ?? 0)} present, ${Number(at.late ?? 0)} late, ${Number(at.absent ?? 0)} absent</div></div>
        <div><div class="text-muted text-sm">Average result</div><strong>${api.pct(api.mean([avgA, avgQ]))}</strong><div class="text-muted text-sm">Assignments ${api.pct(avgA)} · Quizzes ${api.pct(avgQ)}</div></div></div>
      ${raw(ass.length ? html`<h4 style="margin:var(--sp-4) 0 var(--sp-2)">Assignments</h4><div class="table-wrap"><table class="table"><thead><tr><th>Assignment</th><th>Due</th><th>Status</th><th>Result</th></tr></thead><tbody>${raw(ass.map((a) => { const s = STATUS[a.status]; return html`<tr><td><a href="${url('student/assignment.html')}?id=${a.id}">${a.title}</a></td><td class="text-sm">${a.due_at ? formatDate(a.due_at) : '—'}</td><td>${raw(s ? `<span class="badge ${s[1]}">${s[0]}</span>` : '<span class="badge">Not submitted</span>')}</td><td>${a.percent != null ? `${Number(a.grade)} / ${Number(a.max_points)} (${Number(a.percent)}%)` : '—'}</td></tr>`; }).join(''))}</tbody></table></div>` : '')}
      ${raw(qz.length ? html`<h4 style="margin:var(--sp-4) 0 var(--sp-2)">Quizzes</h4><div class="table-wrap"><table class="table"><thead><tr><th>Quiz</th><th>Attempts</th><th>Best result</th></tr></thead><tbody>${raw(qz.map((q) => html`<tr><td><a href="${url('student/quiz.html')}?id=${q.id}">${q.title}</a></td><td>${Number(q.attempts)}</td><td>${raw(q.best_percent != null ? `${Number(q.best_percent)}% ${Number(q.best_percent) >= Number(q.pass_percent) ? '<span class="badge badge-green">Passed</span>' : '<span class="badge badge-red">Not passed</span>'}` : q.pending > 0 ? '<span class="badge badge-blue">Waiting for grade</span>' : q.show_results || !q.attempts ? '—' : '<span class="text-muted">Your teacher shares results</span>')}</td></tr>`).join(''))}</tbody></table></div>` : '')}</section>`.toString();
  }).join('');
} catch (e) { console.error(e); box.innerHTML = errorState(e.message); }
