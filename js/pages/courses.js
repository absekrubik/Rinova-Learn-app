// Course list for all three roles. Admins/teachers manage; students see their enrolled (published) courses.
import { mountShell } from '../ui/shell.js';
import { html, raw, url, debounce, initials } from '../core/utils.js';
import { openModal } from '../ui/modal.js';
import { toastSuccess, toastError } from '../ui/toast.js';
import { withBusy } from '../ui/form.js';
import { emptyState, errorState } from '../ui/states.js';
import * as courses from '../services/courses.js';
import { allMyCourseProgress } from '../services/content.js';
import { statusBadge, courseForm, validateCourseForm, thumbFallbacks } from '../ui/course-ui.js';

const role = document.body.dataset.role;
const staff = role !== 'student';
const { me, content } = await mountShell({ roles: [role], active: `${role}/courses.html`, title: staff ? 'Courses' : 'My courses' });
const state = { q: '', status: '' };
const gradeOf = (t = '') => [...t].reduce((n, ch) => n + ch.charCodeAt(0), 0) % 4;
const SEARCH_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>';

content.innerHTML = `
  <div class="page-head"><div><h1>${staff ? (role === 'admin' ? 'Courses' : 'My courses') : 'My courses'}</h1>
    <p>${staff ? 'Create and manage courses, then enroll students.' : 'Everything you are enrolled in.'}</p></div>
    ${staff ? '<button class="btn btn-primary" id="add">+ New course</button>' : ''}</div>
  <div id="summary"></div>
  <div class="course-tools">
    <label class="search-field">${SEARCH_ICON}<input class="input" id="q" type="search" placeholder="Search courses…" aria-label="Search courses"></label>
    ${staff ? '<select class="select" id="status" aria-label="Filter by status"><option value="">Any status</option><option value="draft">Draft</option><option value="published">Published</option><option value="archived">Archived</option></select>' : ''}</div>
  <div id="list"></div>`;
const $ = (s) => content.querySelector(s);

let progressMap = new Map();
function card(c) {
  const t = courses.thumbUrl(c.thumbnail_path);
  const teachers = (c.course_teachers ?? []).map((x) => x.profiles?.full_name).filter(Boolean);
  const count = c.enrollments?.[0]?.count ?? 0;
  return html`<a class="card card-hover course-card" href="${url(`${role}/course.html`)}?id=${c.id}">
    <div class="thumb" data-g="${gradeOf(c.title)}" data-initials="${initials(c.title)}">${raw(t ? `<img src="${t}" alt="" loading="lazy">` : html`${initials(c.title)}`)}</div>
    <div class="body"><div class="row" style="gap:var(--sp-2)">${raw(staff ? statusBadge(c.status) : '')}${raw(c.category ? html`<span class="badge badge-blue">${c.category}</span>` : '')}${raw(c.level ? html`<span class="badge">${c.level}</span>` : '')}</div>
      <h3>${c.title}</h3>
      <div class="text-muted text-sm course-teacher">${teachers.length ? teachers.join(', ') : 'No instructor yet'}</div>
      ${raw(staff ? html`<div class="course-foot"><span>${count} student${count === 1 ? '' : 's'}</span><span class="course-open">Open &rarr;</span></div>` : progressMap.get(c.id)?.total_lessons ? html`<div class="text-sm">${progressMap.get(c.id).percent}% complete <span class="text-muted">· ${progressMap.get(c.id).completed_lessons}/${progressMap.get(c.id).total_lessons} lessons</span></div><div class="progress"><span style="width:${progressMap.get(c.id).percent}%"></span></div>` : '')}</div></a>`;
}

async function load() {
  $('#list').innerHTML = '<div class="course-grid">' + '<div class="skeleton" style="height:240px"></div>'.repeat(3) + '</div>';
  try {
    const rows = await courses.listCourses(state);
    if (!staff) progressMap = await allMyCourseProgress(me.id).catch(() => new Map());
    $('#summary').innerHTML = staff && rows.length ? html`<div class="summary-chips"><span><strong>${rows.length}</strong> course${rows.length === 1 ? '' : 's'}</span><span><strong>${rows.filter((r) => r.status === 'published').length}</strong> published</span><span><strong>${rows.filter((r) => r.status === 'draft').length}</strong> draft</span></div>` : '';
    $('#list').innerHTML = rows.length
      ? `<div class="course-grid">${rows.map(card).join('')}</div>`
      : (state.q || state.status ? emptyState('No courses match', 'Try a different search or filter.')
        : staff ? emptyState('No courses yet', 'Create your first course to get started.') : emptyState('No courses yet', 'When a teacher enrolls you in a course it will appear here.'));
    thumbFallbacks($('#list'));
  } catch (e) { console.error(e); $('#list').innerHTML = errorState(e.message); }
}

if (staff) $('#add').addEventListener('click', () => {
  const form = courseForm({}, { withThumb: true });
  const m = openModal({ title: 'New course', body: form, actions: [
    { label: 'Cancel', onClick: ({ close }) => close() },
    { label: 'Create course', variant: 'primary', onClick: async ({ el }) => {
      const v = validateCourseForm(form); if (!v) return;
      await withBusy(el.querySelector('.modal-actions .btn-primary'), async () => {
        let course;
        try { course = await courses.createCourse(v.values, me.id); } catch (e) { return toastError(e.message); }
        if (v.file) { try { await courses.uploadThumbnail(course.id, v.file); } catch (e) { toastError(`Course created, but the thumbnail failed: ${e.message}`); } }
        toastSuccess('Course created'); m.close(); location.href = `${url(`${role}/course.html`)}?id=${course.id}`;
      });
    } }] });
});

$('#q').addEventListener('input', debounce((e) => { state.q = e.target.value; load(); }, 300));
$('#status')?.addEventListener('change', (e) => { state.status = e.target.value; load(); });
load();
