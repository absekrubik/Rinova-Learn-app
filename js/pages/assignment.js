// One assignment: instructions + attachment, student submission form, teacher review and grading.
import { mountShell } from '../ui/shell.js';
import { html, raw, url, param, formatDateTime, formatBytes } from '../core/utils.js';
import { avatarInner } from '../core/avatar.js';
import { openModal, confirmDialog } from '../ui/modal.js';
import { toastSuccess, toastError } from '../ui/toast.js';
import { setFieldError, clearErrors, withBusy } from '../ui/form.js';
import { emptyState, errorState, skeletonRows } from '../ui/states.js';
import * as api from '../services/assignments.js';
import * as courses from '../services/courses.js';
import { assignmentDialog, dueText, dueBadge, submissionBadge } from '../ui/assignment-ui.js';

const role = document.body.dataset.role;
const { me, content } = await mountShell({ roles: [role], active: `${role}/assignments.html`, title: 'Assignment' });
const id = param('id');
const listUrl = url(`${role}/assignments.html`);
const notFound = () => { content.innerHTML = `<a class="text-sm" href="${listUrl}">&larr; Assignments</a><div class="card" style="margin-top:var(--sp-4)">${emptyState('Assignment not found', 'It may have been removed, or you may not have access to it.')}</div>`; };
const fileName = (p) => (p ?? '').split('/').pop().replace(/^\d+-/, '');

async function download(bucket, path) {
  try { const u = await api.signedUrl(bucket, path, true); const a = document.createElement('a'); a.href = u; a.rel = 'noopener'; document.body.append(a); a.click(); a.remove(); } catch (e) { toastError(e.message); }
}

async function load() {
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return notFound();
  content.innerHTML = skeletonRows(3);
  let a, course;
  try { a = await api.getAssignment(id); if (!a) return notFound(); course = await courses.getCourse(a.course_id); } catch (e) { console.error(e); content.innerHTML = errorState(e.message); return; }
  const canManage = role === 'admin' || (course?.course_teachers ?? []).some((t) => t.teacher_id === me.id);
  document.title = `${a.title} · Rinova Learn`;
  const courseUrl = `${url(`${role}/course.html`)}?id=${a.course_id}&tab=assignments`;
  content.innerHTML = html`<div class="lesson-layout"><div><a class="text-sm" href="${listUrl}">&larr; Assignments</a>
    <div class="page-head" style="margin:var(--sp-3) 0 0"><div><div class="text-muted text-sm"><a href="${courseUrl}">${a.courses?.title ?? course?.title ?? ''}</a></div><h1>${a.title}</h1>
      <div class="row" style="gap:var(--sp-2);margin-top:var(--sp-2)"><span class="badge">${dueText(a)}</span><span class="badge">${Number(a.max_points)} points</span>${raw(dueBadge(a))}</div></div>
      ${raw(canManage ? `<div class="row"><button class="btn btn-secondary" id="edit">Edit</button><button class="btn btn-secondary" id="pub">${a.is_published ? 'Unpublish' : 'Publish'}</button><button class="btn btn-ghost" id="del" style="color:var(--red-600)">Delete</button></div>` : '')}</div></div>
    <div class="card"><h3 class="card-title">Instructions</h3>${raw(a.instructions ? html`<p class="pre-wrap" style="margin:0">${a.instructions}</p>` : '<p class="text-muted" style="margin:0">No written instructions.</p>')}
      ${raw(a.attachment_path ? html`<div style="margin-top:var(--sp-4)"><button class="btn btn-secondary btn-sm" id="dl-brief">Download ${fileName(a.attachment_path)}</button></div>` : '')}</div>
    <div id="work"></div></div>`;
  content.querySelector('#dl-brief')?.addEventListener('click', () => download('assignment-files', a.attachment_path));
  const work = content.querySelector('#work');
  if (canManage) {
    content.querySelector('#edit').addEventListener('click', () => assignmentDialog({ a, onDone: load }));
    content.querySelector('#pub').addEventListener('click', async () => { try { await api.setPublished(a.id, !a.is_published); toastSuccess(a.is_published ? 'Assignment hidden from students' : 'Assignment published'); load(); } catch (e) { toastError(e.message); } });
    content.querySelector('#del').addEventListener('click', async () => {
      if (!await confirmDialog('Delete this assignment?', 'All student submissions, grades and files for it will be permanently deleted.', { confirmLabel: 'Delete assignment', danger: true })) return;
      try { await api.deleteAssignment(a); toastSuccess('Assignment deleted'); location.href = listUrl; } catch (e) { toastError(e.message); }
    });
    return staffWork(work, a);
  }
  return studentWork(work, a);
}

// ---------------- student ----------------
async function studentWork(box, a) {
  let sub; try { sub = await api.mySubmission(a.id, me.id); } catch (e) { console.error(e); box.innerHTML = errorState(e.message); return; }
  const can = api.canSubmit(a, sub);
  const readOnly = (s) => html`${raw(s.text_answer ? html`<p class="pre-wrap" style="margin:0 0 var(--sp-3)">${s.text_answer}</p>` : '')}${raw(s.file_path ? html`<button class="btn btn-secondary btn-sm" id="dl-mine">Download ${fileName(s.file_path)}</button>` : '')}`;
  box.innerHTML = html`<div class="card"><div class="row row-between" style="margin-bottom:var(--sp-3)"><h3 style="margin:0">Your work</h3><span>${raw(submissionBadge(sub, a))}</span></div>
    ${raw(sub?.status === 'graded' ? html`<div class="alert alert-success" role="status"><strong>Grade: ${Number(sub.grade)} / ${Number(a.max_points)}</strong>${raw(sub.feedback ? html`<div class="pre-wrap" style="margin-top:var(--sp-2)">${sub.feedback}</div>` : '')}</div>` : '')}
    ${raw(sub?.status === 'returned' ? html`<div class="alert" role="status"><strong>Your teacher asked for changes</strong><div class="pre-wrap" style="margin-top:var(--sp-2)">${sub.feedback ?? ''}</div></div>` : '')}
    ${raw(sub?.submitted_at ? html`<p class="text-muted text-sm" style="margin:0 0 var(--sp-3)">Last sent ${formatDateTime(sub.submitted_at)}</p>` : '')}
    <div id="body"></div></div>`;
  const body = box.querySelector('#body');
  if (!can) {
    body.innerHTML = sub ? readOnly(sub) : '<p class="text-muted" style="margin:0">' + (a.is_published ? 'The deadline has passed and this assignment no longer accepts work.' : 'This assignment is not open.') + '</p>';
    body.querySelector('#dl-mine')?.addEventListener('click', () => download('submissions', sub.file_path)); return;
  }
  const form = document.createElement('form'); form.noValidate = true;
  form.innerHTML = html`<div class="field"><label for="sb-text">Your answer</label><textarea class="textarea" id="sb-text" name="text" rows="7" maxlength="${api.TEXT_MAX}">${sub?.text_answer ?? ''}</textarea></div>
    <div class="field"><label for="sb-file">File (optional)</label><input class="input" id="sb-file" name="file" type="file" accept=".pdf,.png,.jpg,.jpeg,.zip,.docx,.txt"><span class="field-hint">PDF, Word, PNG, JPG, ZIP or TXT, up to 25 MB.</span></div>
    ${raw(sub?.file_path ? html`<div class="row" style="gap:var(--sp-3);margin-bottom:var(--sp-3)"><button type="button" class="btn btn-ghost btn-sm" id="dl-mine">Current file: ${fileName(sub.file_path)}</button><label class="row" style="gap:var(--sp-2)"><input type="checkbox" name="remove_file"> Remove it</label></div>` : '')}
    ${raw(a.due_at && api.dueState(a) === 'overdue' && sub?.status !== 'returned' ? '<div class="alert" role="note" style="margin-bottom:var(--sp-3)">The deadline has passed. Your work will be marked as late.</div>' : '')}
    <button class="btn btn-primary" type="submit">${sub ? 'Update submission' : 'Submit'}</button>`;
  body.append(form);
  form.querySelector('#dl-mine')?.addEventListener('click', () => download('submissions', sub.file_path));
  form.addEventListener('submit', (e) => {
    e.preventDefault(); clearErrors(form);
    const file = form.elements.file.files[0], text = form.elements.text.value;
    if (!text.trim() && !file && !(sub?.file_path && !form.elements.remove_file?.checked)) return setFieldError(form.elements.text, 'Write an answer or attach a file');
    if (file) { try { api.validateFile(file, api.SUBMISSION_TYPES, api.SUBMISSION_MAX, 'File'); } catch (er) { return setFieldError(form.elements.file, er.message); } }
    withBusy(form.querySelector('button[type=submit]'), async () => {
      try { await api.submitWork(a, me, sub, { text, file, removeFile: !!form.elements.remove_file?.checked }); toastSuccess(sub ? 'Submission updated' : 'Submitted'); load(); } catch (er) { toastError(er.message); }
    });
  });
}

// ---------------- staff ----------------
async function staffWork(box, a) {
  box.innerHTML = skeletonRows(3);
  let subs, enr; try { [subs, enr] = await Promise.all([api.listSubmissions(a.id), courses.listEnrollments(a.course_id)]); } catch (e) { console.error(e); box.innerHTML = errorState(e.message); return; }
  const by = new Map(subs.map((s) => [s.student_id, s]));
  const roster = enr.filter((r) => r.status !== 'dropped');
  // students who dropped but still have work stay visible
  const extra = subs.filter((s) => !roster.some((r) => r.student_id === s.student_id)).map((s) => ({ student_id: s.student_id, profiles: s.profiles }));
  const people = [...roster, ...extra];
  const order = { submitted: 0, returned: 1, undefined: 2, graded: 3 };
  people.sort((x, y) => (order[by.get(x.student_id)?.status] - order[by.get(y.student_id)?.status]) || (x.profiles?.full_name ?? '').localeCompare(y.profiles?.full_name ?? ''));
  const n = subs.length, g = subs.filter((s) => s.status === 'graded').length;
  box.innerHTML = html`<div class="card" style="padding:var(--sp-4)"><div class="row row-between" style="margin-bottom:var(--sp-3)"><h3 style="margin:0">Submissions</h3><span class="text-muted text-sm" id="count">${n} of ${roster.length} submitted · ${g} graded</span></div>
    ${raw(people.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Student</th><th>Status</th><th>Sent</th><th>Grade</th></tr></thead><tbody>${people.map((r) => { const s = by.get(r.student_id); return html`<tr data-st="${r.student_id}"><td><div class="row"><span class="avatar">${raw(avatarInner(r.profiles))}</span><div><strong>${r.profiles?.full_name || '—'}</strong><div class="text-muted text-sm">${r.profiles?.email}</div>${raw(s ? '<button class="btn btn-secondary btn-sm" data-review style="margin-top:6px">' + (s.status === 'graded' ? 'View' : 'Review') + '</button>' : '')}</div></div></td>
      <td>${raw(submissionBadge(s, a))}</td><td class="text-sm">${s ? formatDateTime(s.submitted_at) : ''}</td><td>${s?.grade != null ? `${Number(s.grade)} / ${Number(a.max_points)}` : ''}</td></tr>`; }).join('')}</tbody></table></div>` : emptyState('No students enrolled', 'Enroll students from the Students tab of the course.'))}</div>`;
  box.querySelectorAll('tr[data-st]').forEach((tr) => tr.querySelector('[data-review]')?.addEventListener('click', () => review(by.get(tr.dataset.st), people.find((p) => p.student_id === tr.dataset.st).profiles)));

  function review(s, prof) {
    const form = document.createElement('form'); form.noValidate = true;
    form.innerHTML = html`<div class="text-muted text-sm" style="margin-bottom:var(--sp-3)">${prof?.full_name || prof?.email} · sent ${formatDateTime(s.submitted_at)}${raw(s.is_late ? ' · <strong>late</strong>' : '')}</div>
      <div class="card" style="background:var(--gray-50,#f7f8fa);margin-bottom:var(--sp-4)">${raw(s.text_answer ? html`<p class="pre-wrap" style="margin:0">${s.text_answer}</p>` : '<p class="text-muted" style="margin:0">No written answer.</p>')}
        ${raw(s.file_path ? html`<div style="margin-top:var(--sp-3)"><button type="button" class="btn btn-secondary btn-sm" id="rv-dl">Download ${fileName(s.file_path)}</button></div>` : '')}</div>
      <div class="field"><label for="rv-grade">Grade (out of ${Number(a.max_points)})</label><input class="input" id="rv-grade" name="grade" inputmode="decimal" value="${s.grade ?? ''}"></div>
      <div class="field"><label for="rv-fb">Feedback</label><textarea class="textarea" id="rv-fb" name="feedback" rows="4" maxlength="${api.FEEDBACK_MAX}">${s.feedback ?? ''}</textarea></div>`;
    form.querySelector('#rv-dl')?.addEventListener('click', () => download('submissions', s.file_path));
    const dlg = openModal({ title: 'Review submission', body: form, actions: [{ label: 'Close', onClick: ({ close }) => close() },
      { label: 'Return for revision', onClick: async ({ el }) => {
        clearErrors(form);
        try { await withBusy(el.querySelectorAll('.modal-actions button')[1], () => api.returnSubmission(s, { feedback: form.elements.feedback.value })); toastSuccess('Returned to the student'); dlg.close(); load(); }
        catch (e) { setFieldError(form.elements.feedback, e.message); }
      } },
      { label: s.status === 'graded' ? 'Update grade' : 'Save grade', variant: 'primary', onClick: async ({ el }) => {
        clearErrors(form);
        const v = api.validateGrade(form.elements.grade.value, a.max_points); if (v.error) return setFieldError(form.elements.grade, v.error);
        await withBusy(el.querySelector('.modal-actions .btn-primary'), async () => {
          try { await api.gradeSubmission(s, a, { grade: form.elements.grade.value, feedback: form.elements.feedback.value }); toastSuccess('Grade saved'); dlg.close(); load(); } catch (e) { toastError(e.message); }
        });
      } }] });
  }
}
load();
