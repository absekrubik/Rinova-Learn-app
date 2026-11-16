// Reports for teachers (their courses) and admins (all courses): per-student progress, attendance and grades, with CSV export.
import { mountShell } from '../ui/shell.js';
import { html, raw, url, param } from '../core/utils.js';
import { toastError } from '../ui/toast.js';
import { emptyState, errorState, skeletonRows } from '../ui/states.js';
import * as api from '../services/reports.js';

const role = document.body.dataset.role;
const { content } = await mountShell({ roles: [role], active: `${role}/reports.html`, title: 'Reports' });
const isId = (v) => /^[0-9a-f-]{36}$/i.test(v ?? '');
let courses = [], current = null, rows = [], sort = { key: 'full_name', dir: 1 };

content.innerHTML = html`<div class="page-head"><div><h1>Reports</h1><p>Progress, attendance and grades, calculated live from your courses.</p></div></div><div id="sum"></div><div id="detail"></div>`;
const sumEl = content.querySelector('#sum'), detailEl = content.querySelector('#detail');
const bar = (v) => html`<div style="min-width:90px"><div class="text-sm">${api.pct(v)}</div><div class="progress" aria-hidden="true"><span style="width:${Math.max(0, Math.min(100, Number(v) || 0))}%"></span></div></div>`;

async function start() {
  sumEl.innerHTML = skeletonRows(3);
  try { courses = await api.coursesReport(); } catch (e) { console.error(e); sumEl.innerHTML = errorState(e.message); return; }
  if (!courses.length) { sumEl.innerHTML = `<div class="card">${emptyState('No courses yet', role === 'admin' ? 'Reports appear once courses exist.' : 'Reports appear once you teach a course.')}</div>`; return; }
  sumEl.innerHTML = html`<div class="card" style="padding:var(--sp-4);margin-bottom:var(--sp-4)"><h3 style="margin:0 0 var(--sp-3)">${role === 'admin' ? 'All courses' : 'My courses'}</h3>
    <div class="table-wrap"><table class="table"><thead><tr><th>Course</th><th>Students</th><th>Avg progress</th><th>Avg attendance</th><th>To grade</th><th></th></tr></thead><tbody>
    ${raw(courses.map((c) => html`<tr data-c="${c.course_id}"><td><strong>${c.title}</strong>${raw(c.status !== 'published' ? ` <span class="badge">${html`${c.status}`}</span>` : '')}</td><td>${Number(c.students)}</td><td>${raw(bar(c.avg_progress))}</td><td>${api.pct(c.avg_attendance)}</td>
      <td>${raw(Number(c.pending_submissions) + Number(c.pending_quizzes) > 0 ? `<span class="badge badge-blue">${Number(c.pending_submissions)} assignments, ${Number(c.pending_quizzes)} quizzes</span>` : '<span class="text-muted">Nothing</span>')}</td>
      <td style="text-align:right"><button class="btn btn-secondary btn-sm" data-open>View report</button></td></tr>`).join(''))}</tbody></table></div></div>`;
  sumEl.querySelectorAll('[data-c]').forEach((tr) => tr.querySelector('[data-open]').addEventListener('click', () => showCourse(tr.dataset.c)));
  const want = param('course'); if (isId(want) && courses.some((c) => c.course_id === want)) showCourse(want);
}

async function showCourse(id) {
  current = courses.find((c) => c.course_id === id); if (!current) return;
  detailEl.innerHTML = skeletonRows(3); detailEl.scrollIntoView?.({ behavior: 'smooth' });
  try { rows = await api.courseReport(id); } catch (e) { console.error(e); detailEl.innerHTML = errorState(e.message); return; }
  paint();
}
const COLS = [['full_name', 'Student'], ['progress_percent', 'Lessons'], ['attendance_percent', 'Attendance'], ['assignments_percent', 'Assignments'], ['quizzes_percent', 'Quizzes'], ['overall', 'Overall']];
function paint() {
  const sorted = api.sortRows(rows, sort.key, sort.dir);
  const courseUrl = `${url(`${role}/course.html`)}?id=${current.course_id}`;
  detailEl.innerHTML = html`<div class="card" style="padding:var(--sp-4)"><div class="row row-between" style="margin-bottom:var(--sp-3);flex-wrap:wrap;gap:var(--sp-2)"><div><h3 style="margin:0">${current.title}</h3><a class="text-sm" href="${courseUrl}">Open course</a></div>
    <button class="btn btn-secondary" id="csv" ${raw(rows.length ? '' : 'disabled')}>Download CSV</button></div>
    ${raw(rows.length ? html`<div class="table-wrap"><table class="table"><thead><tr>${raw(COLS.map(([k, l]) => `<th><button class="btn btn-ghost btn-sm" data-sort="${k}" aria-label="Sort by ${l}" style="padding:0;font:inherit;text-transform:inherit;letter-spacing:inherit">${l}${sort.key === k ? (sort.dir === 1 ? ' &uarr;' : ' &darr;') : ''}</button></th>`).join(''))}</tr></thead><tbody>
      ${raw(sorted.map((r) => html`<tr><td><strong>${r.full_name}</strong><div class="text-muted text-sm" style="overflow-wrap:anywhere">${r.email}</div></td>
        <td>${raw(bar(r.progress_percent))}<div class="text-muted text-sm">${Number(r.completed_lessons)} of ${Number(r.total_lessons)}</div></td>
        <td>${api.pct(r.attendance_percent)}<div class="text-muted text-sm">${Number(r.attendance_marked)} marked</div></td>
        <td>${api.pct(r.assignments_percent)}<div class="text-muted text-sm">${Number(r.assignments_graded)} of ${Number(r.assignments_total)} graded</div></td>
        <td>${api.pct(r.quizzes_percent)}<div class="text-muted text-sm">${Number(r.quizzes_taken)} of ${Number(r.quizzes_total)} taken</div></td>
        <td><strong>${api.pct(api.overall(r))}</strong></td></tr>`).join(''))}</tbody></table></div>
      <p class="text-muted text-sm" style="margin:var(--sp-3) 0 0">Overall is the average of assignment and quiz results. Lesson progress and attendance are shown separately.</p>` : emptyState('No students enrolled', 'Enroll students from the course page to see their progress here.'))}</div>`;
  detailEl.querySelectorAll('[data-sort]').forEach((b) => b.addEventListener('click', () => { const k = b.dataset.sort; sort = { key: k, dir: sort.key === k ? -sort.dir : (k === 'full_name' ? 1 : -1) }; paint(); }));
  detailEl.querySelector('#csv')?.addEventListener('click', () => { try { api.downloadText(`${current.title}-report.csv`, api.reportCsv(sorted)); } catch (e) { toastError(e.message); } });
}
start();
