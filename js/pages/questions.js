// Teachers and admins: one queue of lesson questions nobody has answered yet.
import { mountShell } from '../ui/shell.js';
import { html, raw, url, timeAgo } from '../core/utils.js';
import { emptyState, errorState, skeletonRows } from '../ui/states.js';
import * as api from '../services/lessonQuestions.js';

const role = document.body.dataset.role;
const { content } = await mountShell({ roles: [role], active: `${role}/questions.html`, title: 'Questions' });
content.innerHTML = html`<div class="page-head"><div><h1>Questions</h1><p>Questions students asked on lessons that nobody has answered yet, oldest first. A reply from you marks a question answered.</p></div></div>
  <div class="card" style="padding:var(--sp-4)"><div class="field" style="max-width:320px;margin-bottom:var(--sp-3)"><label for="f-course" class="text-sm">Course</label><select class="select" id="f-course"><option value="">All courses</option></select></div><div id="list">${raw(skeletonRows(4))}</div></div>`;
const $ = (s) => content.querySelector(s);
let rows = [];

function draw() {
  const course = $('#f-course').value, list = rows.filter((r) => !course || r.course_id === course);
  $('#list').innerHTML = !rows.length ? emptyState('No unanswered questions', 'When a student asks a question on a lesson it will show up here.')
    : !list.length ? emptyState('Nothing for this course', 'Try another course.')
    : `<div class="list">${list.map((r) => html`<div class="list-item" style="align-items:flex-start"><div style="min-width:0;flex:1">
        <div class="row" style="gap:var(--sp-2);flex-wrap:wrap">${raw(r.is_pinned ? '<span class="badge badge-orange">Pinned</span>' : '')}${raw(r.at_seconds != null ? `<span class="qa-time" style="cursor:default">&#9654; ${api.fmtTime(r.at_seconds)}</span>` : '')}<strong style="overflow-wrap:anywhere">${r.author_name}</strong><span class="text-muted text-sm">${timeAgo(r.created_at)}</span></div>
        <p class="pre-wrap" style="margin:var(--sp-1) 0">${r.body}</p>
        <div class="meta">${r.course_title} · ${r.lesson_title}</div></div>
        <a class="btn btn-primary btn-sm" href="${url(`${role}/lesson.html`)}?id=${r.lesson_id}${r.at_seconds != null ? `&t=${r.at_seconds}` : ''}&q=${r.id}">Answer</a></div>`.toString()).join('')}</div>`;
}
try {
  rows = await api.openQuestions();
  const courses = [...new Map(rows.map((r) => [r.course_id, r.course_title])).entries()];
  $('#f-course').innerHTML = '<option value="">All courses</option>' + courses.map(([id, t]) => html`<option value="${id}">${t}</option>`.toString()).join('');
  $('#f-course').addEventListener('change', draw); draw();
} catch (e) { console.error(e); $('#list').innerHTML = errorState(e.message); }
