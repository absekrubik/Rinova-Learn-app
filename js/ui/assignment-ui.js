// Shared assignment UI: badges, due-date text and the create/edit dialog.
import { html, raw, formatDateTime, formatBytes } from '../core/utils.js';
import { openModal } from './modal.js';
import { toastSuccess, toastError } from './toast.js';
import { formData, setFieldError, clearErrors, withBusy } from './form.js';
import * as api from '../services/assignments.js';
import { toLocalInput, fromLocalInput } from '../services/live.js';

export const dueText = (a) => (a.due_at ? `Due ${formatDateTime(a.due_at)}` : 'No deadline');
export const dueBadge = (a) => ({
  draft: '<span class="badge badge-orange">Draft</span>', closed: '<span class="badge badge-red">Closed</span>',
  overdue: '<span class="badge badge-orange">Late work accepted</span>', open: '', 'no-deadline': '',
}[api.dueState(a)]);
export const submissionBadge = (sub, a) => {
  if (!sub) return api.dueState(a) === 'closed' ? '<span class="badge badge-red">Missed</span>' : '<span class="badge">Not submitted</span>';
  if (sub.status === 'graded') return `<span class="badge badge-green">Graded ${Number(sub.grade)}/${Number(a.max_points)}</span>`;
  if (sub.status === 'returned') return '<span class="badge badge-orange">Returned</span>';
  return `<span class="badge badge-blue">Submitted</span>${sub.is_late ? ' <span class="badge badge-orange">Late</span>' : ''}`;
};

/** Create / edit dialog. Pass `courseId` for a fixed course or `courses` to let the teacher choose. */
export function assignmentDialog({ courseId = null, courses = [], a = null, onDone }) {
  const editing = !!a;
  const form = document.createElement('form'); form.noValidate = true;
  form.innerHTML = html`${raw(!courseId && !editing ? html`<div class="field"><label for="as-course">Course</label><select class="select" id="as-course" name="course_id">${raw(courses.map((c) => html`<option value="${c.id}">${c.title}</option>`).join(''))}</select></div>` : '')}
    <div class="field"><label for="as-title">Title</label><input class="input" id="as-title" name="title" maxlength="${api.TITLE_MAX}" required value="${a?.title ?? ''}"></div>
    <div class="field"><label for="as-instr">Instructions</label><textarea class="textarea" id="as-instr" name="instructions" rows="5" maxlength="${api.INSTR_MAX}">${a?.instructions ?? ''}</textarea></div>
    <div class="grid grid-2"><div class="field"><label for="as-due">Deadline (optional)</label><input class="input" id="as-due" name="due" type="datetime-local" value="${a?.due_at ? toLocalInput(a.due_at) : ''}"><span class="field-hint">Shown in your local time.</span></div>
      <div class="field"><label for="as-pts">Maximum points</label><input class="input" id="as-pts" name="max_points" type="number" min="1" max="10000" step="0.5" value="${a?.max_points ?? 100}"></div></div>
    <div class="field"><label for="as-file">Attachment (optional)</label><input class="input" id="as-file" name="file" type="file" accept=".pdf,.png,.jpg,.jpeg,.zip,.docx"><span class="field-hint">PDF, Word, PNG, JPG or ZIP, up to 50 MB.${a?.attachment_path ? ' Choosing a file replaces the current one.' : ''}</span></div>
    ${raw(a?.attachment_path ? '<label class="row" style="gap:var(--sp-2);margin-bottom:var(--sp-3)"><input type="checkbox" name="remove_file"> Remove the current attachment</label>' : '')}
    <label class="row" style="gap:var(--sp-2);margin-bottom:var(--sp-2)"><input type="checkbox" name="allow_late" ${raw(a?.allow_late ? 'checked' : '')}> Accept late submissions (they are marked Late)</label>
    <label class="row" style="gap:var(--sp-2)"><input type="checkbox" name="is_published" ${raw(a?.is_published ? 'checked' : '')}> Published (students are notified when you publish)</label>`;
  const dlg = openModal({ title: editing ? 'Edit assignment' : 'New assignment', body: form, actions: [{ label: 'Cancel', onClick: ({ close }) => close() },
    { label: editing ? 'Save changes' : 'Create', variant: 'primary', onClick: async ({ el }) => {
      clearErrors(form); const d = formData(form); let ok = true;
      const bad = (n, m) => { setFieldError(form.elements[n], m); ok = false; };
      if (!d.title) bad('title', 'Enter a title');
      const pts = Number(d.max_points); if (!(pts >= 1 && pts <= 10000)) bad('max_points', 'Enter points between 1 and 10000');
      let due = null; if (d.due) { due = fromLocalInput(d.due); if (!due) bad('due', 'Choose a valid date and time'); }
      const file = form.elements.file.files[0];
      if (file) { try { api.validateFile(file, api.ATTACH_TYPES, api.ATTACH_MAX, 'Attachment'); } catch (e) { bad('file', e.message); } }
      const cid = courseId ?? a?.course_id ?? d.course_id; if (!cid) { toastError('Choose a course'); ok = false; }
      if (!ok) return;
      const v = { title: d.title, instructions: d.instructions, due_at: due, max_points: pts, allow_late: form.elements.allow_late.checked, is_published: form.elements.is_published.checked };
      await withBusy(el.querySelector('.modal-actions .btn-primary'), async () => {
        let saved = a;
        try {
          if (editing) await api.updateAssignment(a.id, v); else saved = await api.createAssignment(cid, v);
          if (file) await api.uploadAttachment(saved, file);
          else if (editing && form.elements.remove_file?.checked) await api.clearAttachment(a);
          toastSuccess(editing ? 'Assignment updated' : 'Assignment created'); dlg.close(); onDone?.(saved);
        } catch (e) {
          toastError(e.message);
          if (!editing && saved && saved !== a) { dlg.close(); onDone?.(saved); toastError('The assignment was created, but the attachment failed: ' + e.message); }
        }
      });
    } }] });
}
