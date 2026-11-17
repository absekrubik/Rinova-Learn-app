// Single course: overview (+edit), students (enroll/unenroll), teachers (admin manages).
import { mountShell } from '../ui/shell.js';
import { html, raw, url, param, formatDate, debounce, initials } from '../core/utils.js';
import { avatarInner } from '../core/avatar.js';
import { openModal, confirmDialog } from '../ui/modal.js';
import { toastSuccess, toastError } from '../ui/toast.js';
import { withBusy } from '../ui/form.js';
import { emptyState, errorState, skeletonRows } from '../ui/states.js';
import * as courses from '../services/courses.js';
import * as contentApi from '../services/content.js';
import { renderContent } from './course-content.js';
import { renderLive } from './course-live.js';
import { renderTopics } from './course-topics.js';
import * as mastery from '../services/mastery.js';
import { masteryCards } from '../ui/mastery-ui.js';
import { renderAttendance } from './course-attendance.js';
import { renderAssignments } from './course-assignments.js';
import { renderQuizzes } from './course-quizzes.js';
import { statusBadge, courseForm, validateCourseForm, thumbFallbacks } from '../ui/course-ui.js';

const role = document.body.dataset.role;
const { me, content } = await mountShell({ roles: [role], active: `${role}/courses.html`, title: 'Course' });
const id = param('id');
const listUrl = url(`${role}/courses.html`);
const isAdmin = role === 'admin';
let course = null, canManage = false, tab = 'overview';

const back = `<a class="text-sm" href="${listUrl}">&larr; ${role === 'admin' ? 'All courses' : 'My courses'}</a>`;
const notFound = () => { content.innerHTML = `${back}<div class="card" style="margin-top:var(--sp-4)">${emptyState('Course not found', 'It may have been removed, or you may not have access to it.')}</div>`; };

async function init() {
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return notFound();
  content.innerHTML = skeletonRows(4);
  try { course = await courses.getCourse(id); } catch (e) { console.error(e); content.innerHTML = `${back}${errorState(e.message)}`; return; }
  if (!course) return notFound();
  canManage = isAdmin || (course.course_teachers ?? []).some((t) => t.teacher_id === me.id);
  const startTab = param('tab');
  if (['content', 'live', 'attendance', 'assignments', 'quizzes', 'topics', 'mastery'].includes(startTab)) { tab = startTab; if (startTab === 'attendance' && /^[0-9a-f-]{36}$/i.test(param('live') ?? '')) attCtx.openLive = param('live'); }
  document.title = `${course.title} · Rinova Learn`;
  document.getElementById('page-title').textContent = 'Course';
  render();
}

const teacherNames = () => (course.course_teachers ?? []).sort((x, y) => y.is_lead - x.is_lead).map((x) => x.profiles?.full_name).filter(Boolean).join(', ');
const gradeOf = (t = '') => [...t].reduce((n, ch) => n + ch.charCodeAt(0), 0) % 4;

function render() {
  const tabs = canManage ? [['overview', 'Overview'], ['content', 'Content'], ['live', 'Live classes'], ['assignments', 'Assignments'], ['quizzes', 'Quizzes'], ['topics', 'Topics'], ['attendance', 'Attendance'], ['students', 'Students'], ['teachers', 'Teachers']] : [['overview', 'Overview'], ['content', 'Lessons'], ['live', 'Live classes'], ['assignments', 'Assignments'], ['quizzes', 'Quizzes'], ['mastery', 'My mastery'], ['attendance', 'Attendance']];
  content.innerHTML = html`${raw(back)}
    <header class="course-top" data-g="${gradeOf(course.title)}"><div class="course-top-main">
      <div class="course-top-thumb thumb" data-initials="${initials(course.title)}" data-g="${gradeOf(course.title)}">${raw(courses.thumbUrl(course.thumbnail_path) ? `<img src="${courses.thumbUrl(course.thumbnail_path)}" alt="">` : html`${initials(course.title)}`)}</div>
      <div style="min-width:0"><div class="row" style="gap:var(--sp-2);flex-wrap:wrap">${raw(canManage ? statusBadge(course.status) : '')}${raw(course.category ? html`<span class="badge badge-blue">${course.category}</span>` : '')}${raw(course.level ? html`<span class="badge">${course.level}</span>` : '')}</div>
        <h1>${course.title}</h1>
        <div class="course-top-meta">${raw(teacherNames() ? html`<span>${teacherNames()}</span>` : '')}${raw(canManage ? html`<span>${course.enrollments?.[0]?.count ?? 0} student${(course.enrollments?.[0]?.count ?? 0) === 1 ? '' : 's'}</span>` : '')}</div></div></div>
      ${raw(canManage ? '<div class="row course-top-actions"><button class="btn btn-secondary" id="edit">Edit course</button>' + (isAdmin ? '<button class="btn btn-danger-soft" id="del">Delete</button>' : '') + '</div>' : '')}</header>
    ${raw(tabs.length > 1 ? `<div class="tabs" role="tablist" aria-label="Course sections">${tabs.map(([k, l]) => `<button class="tab" role="tab" data-tab="${k}" aria-selected="${k === tab}">${l}</button>`).join('')}</div>` : '')}
    <div id="pane"></div>`;
  content.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { tab = b.dataset.tab; render(); }));
  content.querySelector('#edit')?.addEventListener('click', editCourse);
  content.querySelector('#del')?.addEventListener('click', removeCourse);
  ({ overview, content: contentTab, live: liveTab, assignments: asgTab, quizzes: quizTab, topics: topicsTab, mastery: masteryTab, attendance: attTab, students, teachers }[tab])(content.querySelector('#pane'));
}

const attCtx = {};
const topicsTab = (pane) => renderTopics(pane, { course });
const masteryTab = async (pane) => {
  pane.innerHTML = skeletonRows(3);
  try { const rows = await mastery.myMastery(course.id); pane.innerHTML = rows.length ? masteryCards(rows).toString() : emptyState('No topics yet', 'Your teacher has not set up topics for this course yet.'); } catch (e) { console.error(e); pane.innerHTML = errorState(e.message); }
};
const quizTab = (pane) => renderQuizzes(pane, { course, me, role, canManage });
const asgTab = (pane) => renderAssignments(pane, { course, me, role, canManage });
const liveTab = (pane) => renderLive(pane, { course, me, role, canManage });
const attTab = (pane) => { Object.assign(attCtx, { course, me, role, canManage }); return renderAttendance(pane, attCtx); };

// ---------------- lessons / content ----------------
const contentTab = (pane) => renderContent(pane, { course, me, role, canManage });

// ---------------- overview ----------------
function overview(pane) {
  const t = courses.thumbUrl(course.thumbnail_path);
  const names = (course.course_teachers ?? []).sort((a, b) => b.is_lead - a.is_lead).map((x) => x.profiles?.full_name).filter(Boolean);
  const count = course.enrollments?.[0]?.count ?? 0;
  pane.innerHTML = html`<div class="course-hero"><div class="thumb" data-initials="${initials(course.title)}" style="border-radius:var(--radius-lg)">${raw(t ? `<img src="${t}" alt="">` : html`${initials(course.title)}`)}</div>
    <div class="stack"><div class="card"><h3 class="card-title">About this course</h3>
      ${raw(course.description ? html`<p class="pre-wrap" style="margin:0">${course.description}</p>` : '<p class="text-muted" style="margin:0">No description yet.</p>')}</div>
      <div class="card"><div class="grid grid-2"><div><div class="text-muted text-sm">Instructor${names.length === 1 ? '' : 's'}</div><strong>${names.length ? names.join(', ') : 'Not assigned yet'}</strong></div>
        ${raw(canManage ? html`<div><div class="text-muted text-sm">Students enrolled</div><strong>${count}</strong></div>` : html`<div><div class="text-muted text-sm">Started</div><strong>${formatDate(course.created_at)}</strong></div>`)}</div></div></div></div>`;
  thumbFallbacks(pane);
}

function editCourse() {
  const form = courseForm(course);
  const t = courses.thumbUrl(course.thumbnail_path);
  const thumbField = document.createElement('div'); thumbField.className = 'field';
  thumbField.innerHTML = html`<label for="cf-thumb">Thumbnail</label>${raw(t ? `<div class="thumb" style="max-width:240px;border-radius:var(--radius);margin-bottom:var(--sp-2)"><img src="${t}" alt=""></div>` : '')}
    <input class="input" id="cf-thumb" name="thumb" type="file" accept="image/png,image/jpeg,image/webp"><span class="field-hint">Choose a new image to replace it (PNG, JPG or WebP, up to 5 MB).</span>
    ${raw(t ? '<label class="row" style="gap:var(--sp-2);margin-top:var(--sp-2)"><input type="checkbox" id="cf-rmthumb"> Remove thumbnail</label>' : '')}`;
  form.append(thumbField);
  const m = openModal({ title: 'Edit course', body: form, actions: [
    { label: 'Cancel', onClick: ({ close }) => close() },
    { label: 'Save changes', variant: 'primary', onClick: async ({ el }) => {
      const v = validateCourseForm(form); if (!v) return;
      await withBusy(el.querySelector('.modal-actions .btn-primary'), async () => {
        try {
          await courses.updateCourse(course.id, v.values);
          if (v.file) await courses.uploadThumbnail(course.id, v.file, course.thumbnail_path);
          else if (form.querySelector('#cf-rmthumb')?.checked) await courses.removeThumbnail(course.id, course.thumbnail_path);
          toastSuccess('Course updated'); m.close(); await init();
        } catch (e) { toastError(e.message); }
      });
    } }] });
}

async function removeCourse() {
  const ok = await confirmDialog('Delete this course?', `"${course.title}" and everything in it (enrollments, lessons, assignments, quizzes) will be permanently deleted. This cannot be undone.`, { confirmLabel: 'Delete course', danger: true });
  if (!ok) return;
  try {
    await courses.deleteCourse(course.id);
    await contentApi.purgeCourseFiles(course.id);
    toastSuccess('Course deleted'); location.href = listUrl;
  } catch (e) { toastError(e.message); }
}

// ---------------- students ----------------
async function students(pane) {
  pane.innerHTML = `<div class="card" style="padding:var(--sp-4)"><div class="row row-between" style="margin-bottom:var(--sp-3)"><strong id="st-count">Students</strong><button class="btn btn-primary btn-sm" id="enroll">+ Enroll students</button></div><div id="st"></div></div>`;
  pane.querySelector('#enroll').addEventListener('click', () => enrollDialog(pane));
  const box = pane.querySelector('#st'); box.innerHTML = skeletonRows(3);
  try {
    const [rows, prog] = await Promise.all([courses.listEnrollments(course.id), contentApi.courseProgress(course.id).catch(() => [])]);
    const pmap = new Map(prog.map((p) => [p.student_id, p]));
    pane.querySelector('#st-count').textContent = `${rows.length} student${rows.length === 1 ? '' : 's'}`;
    if (!rows.length) { box.innerHTML = emptyState('No students enrolled', 'Use "Enroll students" to add people to this course.'); return; }
    box.innerHTML = `<div class="table-wrap"><table class="table"><thead><tr><th>Student</th><th>Status</th><th>Progress</th><th>Enrolled</th><th></th></tr></thead><tbody>${rows.map((r) => html`
      <tr data-id="${r.id}"><td><div class="row"><span class="avatar">${raw(avatarInner(r.profiles))}</span><div><strong>${r.profiles?.full_name || '—'}</strong><div class="text-muted text-sm">${r.profiles?.email}</div></div></div></td>
      <td><select class="select" data-status aria-label="Enrollment status" style="height:34px;min-width:120px">${raw(courses.ENROLL_STATUS.map((s) => `<option value="${s}" ${s === r.status ? 'selected' : ''}>${s[0].toUpperCase() + s.slice(1)}</option>`).join(''))}</select></td>
      <td style="min-width:120px">${raw(pmap.has(r.student_id) ? html`<div class="text-sm">${pmap.get(r.student_id).percent}% <span class="text-muted">(${pmap.get(r.student_id).completed_lessons}/${pmap.get(r.student_id).total_lessons})</span></div><div class="progress" style="margin-top:4px"><span style="width:${pmap.get(r.student_id).percent}%"></span></div>` : '<span class="text-muted text-sm">—</span>')}</td>
      <td>${formatDate(r.enrolled_at)}</td><td style="text-align:right"><button class="btn btn-ghost btn-sm" data-remove style="color:var(--red-600)">Remove</button></td></tr>`).join('')}</tbody></table></div>`;
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    box.querySelectorAll('[data-status]').forEach((sel) => sel.addEventListener('change', async () => {
      try { await courses.setEnrollmentStatus(sel.closest('tr').dataset.id, sel.value); toastSuccess('Status updated'); } catch (e) { toastError(e.message); students(pane); }
    }));
    box.querySelectorAll('[data-remove]').forEach((b) => b.addEventListener('click', async () => {
      const r = byId[b.closest('tr').dataset.id];
      if (!await confirmDialog('Remove student?', `${r.profiles?.full_name || r.profiles?.email} will lose access to this course.`, { confirmLabel: 'Remove', danger: true })) return;
      try { await courses.unenroll(r.id); toastSuccess('Student removed'); students(pane); init_counts(); } catch (e) { toastError(e.message); }
    }));
  } catch (e) { console.error(e); box.innerHTML = errorState(e.message); }
}
async function init_counts() { try { course = await courses.getCourse(id) ?? course; } catch { /* keep */ } }

async function enrollDialog(pane) {
  const body = document.createElement('div');
  body.innerHTML = `<div class="field"><label for="es-q">Find students</label><input class="input" id="es-q" type="search" placeholder="Search by name or email…" autocomplete="off"></div><div class="pick-list" id="es-list" role="group" aria-label="Students"></div><p class="text-muted text-sm" id="es-sel" style="margin:var(--sp-2) 0 0">0 selected</p>`;
  const picked = new Map(); let enrolled = [];
  const listEl = body.querySelector('#es-list'), selEl = body.querySelector('#es-sel');
  const updateSel = () => { selEl.textContent = `${picked.size} selected`; };
  async function search(q = '') {
    listEl.innerHTML = '<div class="skeleton" style="height:44px;margin:8px"></div>';
    try {
      const rows = await courses.searchStudents(q, enrolled);
      listEl.innerHTML = rows.length ? rows.map((s) => html`<label class="pick-item"><input type="checkbox" value="${s.id}" ${raw(picked.has(s.id) ? 'checked' : '')}><span class="avatar">${raw(avatarInner(s))}</span><span><strong>${s.full_name || '—'}</strong><span class="text-muted text-sm" style="display:block">${s.email}</span></span></label>`).join('')
        : '<div class="empty" style="padding:var(--sp-5)">No students found. Create student accounts from the Users page (admin).</div>';
      const byId = Object.fromEntries(rows.map((s) => [s.id, s]));
      listEl.querySelectorAll('input').forEach((cb) => cb.addEventListener('change', () => { cb.checked ? picked.set(cb.value, byId[cb.value]) : picked.delete(cb.value); updateSel(); }));
    } catch (e) { listEl.innerHTML = errorState(e.message); }
  }
  try { enrolled = (await courses.listEnrollments(course.id)).map((r) => r.student_id); } catch (e) { return toastError(e.message); }
  const m = openModal({ title: 'Enroll students', body, actions: [
    { label: 'Cancel', onClick: ({ close }) => close() },
    { label: 'Enroll selected', variant: 'primary', onClick: async ({ el }) => {
      if (!picked.size) return toastError('Select at least one student.');
      await withBusy(el.querySelector('.modal-actions .btn-primary'), async () => {
        try { const n = picked.size; await courses.enroll(course.id, [...picked.keys()]); toastSuccess(`${n} student${n === 1 ? '' : 's'} enrolled`); m.close(); await init_counts(); students(pane); } catch (e) { toastError(e.message); }
      });
    } }] });
  body.querySelector('#es-q').addEventListener('input', debounce((e) => search(e.target.value), 300));
  search();
}

// ---------------- teachers ----------------
async function teachers(pane) {
  pane.innerHTML = `<div class="card" style="padding:var(--sp-4)"><div class="row row-between" style="margin-bottom:var(--sp-3)"><strong>Teaching team</strong>${isAdmin ? '<button class="btn btn-primary btn-sm" id="addt">+ Add teacher</button>' : ''}</div><div id="tl"></div>${isAdmin ? '' : '<p class="text-muted text-sm" style="margin:var(--sp-3) 0 0">Only an administrator can change the teaching team.</p>'}</div>`;
  const box = pane.querySelector('#tl'); box.innerHTML = skeletonRows(2);
  try {
    const rows = await courses.listTeachers(course.id);
    box.innerHTML = rows.length ? `<div class="list">${rows.map((r) => html`<div class="list-item" data-id="${r.teacher_id}"><div class="row"><span class="avatar">${raw(avatarInner(r.profiles))}</span><div><strong>${r.profiles?.full_name || '—'}</strong> ${raw(r.is_lead ? '<span class="badge badge-blue">Lead</span>' : '')}<div class="text-muted text-sm">${r.profiles?.email}</div></div></div>
      ${raw(isAdmin ? `<div class="row" style="gap:var(--sp-1)">${r.is_lead ? '' : '<button class="btn btn-ghost btn-sm" data-lead>Make lead</button>'}<button class="btn btn-ghost btn-sm" data-rm style="color:var(--red-600)">Remove</button></div>` : '')}</div>`).join('')}</div>` : emptyState('No teachers assigned', isAdmin ? 'Add a teacher so they can manage this course.' : '');
    box.querySelectorAll('[data-lead]').forEach((b) => b.addEventListener('click', async () => { try { await courses.setLead(course.id, b.closest('.list-item').dataset.id); toastSuccess('Lead teacher updated'); teachers(pane); } catch (e) { toastError(e.message); } }));
    box.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', async () => {
      const tid = b.closest('.list-item').dataset.id;
      if (!await confirmDialog('Remove teacher?', 'They will no longer be able to manage this course.', { confirmLabel: 'Remove', danger: true })) return;
      try { await courses.removeTeacher(course.id, tid); toastSuccess('Teacher removed'); await init_counts(); teachers(pane); } catch (e) { toastError(e.message); }
    }));
    pane.querySelector('#addt')?.addEventListener('click', async () => {
      let avail; try { avail = await courses.availableTeachers(rows.map((r) => r.teacher_id)); } catch (e) { return toastError(e.message); }
      if (!avail.length) return toastError('There are no other active teachers. Create one from the Users page.');
      const body = document.createElement('div');
      body.innerHTML = html`<div class="field"><label for="at-sel">Teacher</label><select class="select" id="at-sel">${raw(avail.map((t) => html`<option value="${t.id}">${t.full_name || t.email} (${t.email})</option>`).join(''))}</select></div>`;
      const m = openModal({ title: 'Add teacher', body, actions: [{ label: 'Cancel', onClick: ({ close }) => close() },
        { label: 'Add', variant: 'primary', onClick: async ({ el }) => { try { await courses.addTeacher(course.id, el.querySelector('#at-sel').value); toastSuccess('Teacher added'); m.close(); await init_counts(); teachers(pane); } catch (e) { toastError(e.message); } } }] });
    });
  } catch (e) { console.error(e); box.innerHTML = errorState(e.message); }
}

init();
