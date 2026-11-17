// Live class UI pieces shared by the course tab, the class list and the class page.
import { html, raw, formatDateTime } from '../core/utils.js';
import { openModal } from './modal.js';
import { toastSuccess, toastError } from './toast.js';
import { formData, setFieldError, clearErrors, withBusy } from './form.js';
import * as live from '../services/live.js';

export const stateBadge = (s) => ({ upcoming: '<span class="badge badge-blue">Upcoming</span>', live: '<span class="badge badge-green">Live now</span>', ended: '<span class="badge">Ended</span>', cancelled: '<span class="badge badge-red">Cancelled</span>' }[s]);
export const whenText = (c) => {
  const s = new Date(c.starts_at), e = new Date(c.ends_at);
  const sameDay = s.toDateString() === e.toDateString();
  return sameDay ? `${formatDateTime(c.starts_at)} – ${e.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}` : `${formatDateTime(c.starts_at)} – ${formatDateTime(c.ends_at)}`;
};

/** Schedule / edit dialog. Pass `courseId` for a fixed course, or `courses` ([{id,title}]) to let the teacher choose. */
export function classDialog({ courseId = null, courses = [], cls = null, onDone }) {
  const editing = !!cls;
  const form = document.createElement('form'); form.noValidate = true;
  const startLocal = cls ? live.toLocalInput(cls.starts_at) : '';
  const mins = cls ? Math.max(5, Math.round((new Date(cls.ends_at) - new Date(cls.starts_at)) / 60000)) : 60;
  const isMeet = (u) => { try { return new URL(u).hostname.replace(/^www\./, '') === 'meet.google.com'; } catch { return false; } };
  const prov = !cls ? 'meet' : !cls.meeting_url ? 'jitsi' : isMeet(cls.meeting_url) ? 'meet' : 'link';
  form.innerHTML = html`${raw(!courseId && !editing ? html`<div class="field"><label for="lc-course">Course</label><select class="select" id="lc-course" name="course_id">${raw(courses.map((c) => html`<option value="${c.id}">${c.title}</option>`).join(''))}</select></div>` : '')}
    <div class="field"><label for="lc-title">Title</label><input class="input" id="lc-title" name="title" maxlength="140" required value="${cls?.title ?? ''}"></div>
    <div class="grid grid-2"><div class="field"><label for="lc-start">Starts</label><input class="input" id="lc-start" name="start" type="datetime-local" required value="${startLocal}"><span class="field-hint">Shown in your local time.</span></div>
      <div class="field"><label for="lc-dur">Length (minutes)</label><input class="input" id="lc-dur" name="duration" type="number" min="5" max="720" step="5" value="${mins}"></div></div>
    <div class="field"><label for="lc-prov">Where will it happen?</label><select class="select" id="lc-prov" name="provider"><option value="meet" ${raw(prov === 'meet' ? 'selected' : '')}>Google Meet (recommended)</option><option value="jitsi" ${raw(prov === 'jitsi' ? 'selected' : '')}>Jitsi Meet (free, a private room is created for you)</option><option value="link" ${raw(prov === 'link' ? 'selected' : '')}>Another link (Zoom, Teams…)</option></select></div>
    <div class="field" id="lc-linkbox"><label for="lc-link">Meeting link</label><input class="input" id="lc-link" name="meeting_url" type="url" placeholder="https://meet.google.com/…" value="${cls?.meeting_url ?? ''}"><span class="field-hint" id="lc-linkhint">Must start with https://</span><a class="btn btn-secondary btn-sm" id="lc-newmeet" href="https://meet.google.com/new" target="_blank" rel="noopener noreferrer" style="margin-top:var(--sp-2)">Create a Meet link</a></div>
    <div class="field"><label for="lc-desc">Description (optional)</label><textarea class="textarea" id="lc-desc" name="description" rows="3" maxlength="2000">${cls?.description ?? ''}</textarea></div>
    ${raw(editing ? html`<div class="field"><label for="lc-rec">Recording link (optional)</label><input class="input" id="lc-rec" name="recording_url" type="url" placeholder="https://…" value="${cls?.recording_url ?? ''}"><span class="field-hint">Add it after the class so students can watch again. Must start with https://</span></div>` : '')}`;
  const sync = () => { const v = form.elements.provider.value; form.querySelector('#lc-linkbox').hidden = v === 'jitsi'; form.querySelector('#lc-newmeet').hidden = v !== 'meet';
    form.querySelector('#lc-linkhint').textContent = v === 'meet' ? 'Tap "Create a Meet link", copy the link Google shows you (it looks like https://meet.google.com/abc-defg-hij) and paste it here.' : 'Must start with https://';
    form.querySelector('#lc-link').placeholder = v === 'meet' ? 'https://meet.google.com/abc-defg-hij' : 'https://…'; };
  form.elements.provider.addEventListener('change', sync); sync();
  const dlg = openModal({ title: editing ? 'Edit live class' : 'Schedule live class', body: form, actions: [{ label: 'Cancel', onClick: ({ close }) => close() },
    { label: editing ? 'Save changes' : 'Schedule', variant: 'primary', onClick: async ({ el }) => {
      clearErrors(form); const d = formData(form); let ok = true;
      const bad = (n, m) => { setFieldError(form.elements[n], m); ok = false; };
      if (!d.title) bad('title', 'Enter a title');
      const start = live.fromLocalInput(d.start); if (!start) bad('start', 'Choose a start date and time');
      const dur = Number(d.duration); if (!(dur >= 5 && dur <= 720)) bad('duration', 'Enter a length between 5 and 720 minutes');
      let meeting = null;
      if (d.provider === 'link' || d.provider === 'meet') {
        meeting = live.safeHttpsUrl(d.meeting_url);
        if (!meeting) bad('meeting_url', 'Enter a valid link starting with https://');
        else if (d.provider === 'meet' && !isMeet(meeting)) bad('meeting_url', 'This is not a Google Meet link. It should start with https://meet.google.com/');
      }
      let rec = null;
      if (editing && d.recording_url) { rec = live.safeHttpsUrl(d.recording_url); if (!rec) bad('recording_url', 'Enter a valid link starting with https://'); }
      const cid = courseId ?? cls?.course_id ?? d.course_id; if (!cid) { toastError('Choose a course'); ok = false; }
      if (!ok) return;
      const v = { title: d.title, description: d.description, starts_at: start, ends_at: new Date(new Date(start).getTime() + dur * 60000).toISOString(), meeting_url: meeting, recording_url: rec };
      await withBusy(el.querySelector('.modal-actions .btn-primary'), async () => {
        try { const r = editing ? await live.updateClass(cls.id, v) : await live.createClass(cid, v); toastSuccess(editing ? 'Class updated' : 'Class scheduled'); dlg.close(); onDone?.(r); } catch (e) { toastError(e.message); }
      });
    } }] });
}
