// Announcements: everyone reads; teachers post to their courses; admins post to a course or to everyone.
import { mountShell } from '../ui/shell.js';
import { html, raw, param, timeAgo, formatDateTime } from '../core/utils.js';
import { openModal, confirmDialog } from '../ui/modal.js';
import { toastSuccess, toastError } from '../ui/toast.js';
import { withBusy } from '../ui/form.js';
import { emptyState, errorState, skeletonRows } from '../ui/states.js';
import * as api from '../services/announcements.js';
import * as coursesApi from '../services/courses.js';

const role = document.body.dataset.role, staff = role !== 'student';
const { me, content } = await mountShell({ roles: [role], active: `${role}/announcements.html`, title: 'Announcements' });
const focusId = /^[0-9a-f-]{36}$/i.test(param('id') ?? '') ? param('id') : null;
let courses = [], filter = '';
try { courses = (await coursesApi.listCourses()).filter((c) => c.status !== 'archived'); } catch (e) { console.error(e); }

content.innerHTML = html`<div class="page-head"><div><h1>Announcements</h1><p>${staff ? 'Share news with your students.' : 'News from your teachers and the school.'}</p></div>
  ${raw(staff ? '<button class="btn btn-primary" id="new">+ New announcement</button>' : '')}</div>
  <div class="card" style="padding:var(--sp-3) var(--sp-4);margin-bottom:var(--sp-4)"><label class="row" style="gap:var(--sp-3)"><span class="text-sm text-muted">Show</span>
    <select class="select" id="flt" style="max-width:320px"><option value="">Everything</option><option value="global">School-wide only</option>${raw(courses.map((c) => html`<option value="${c.id}">${c.title}</option>`).join(''))}</select></label></div>
  <div id="list"></div>`;
const box = content.querySelector('#list');
content.querySelector('#flt').addEventListener('change', (e) => { filter = e.target.value; load(); });
content.querySelector('#new')?.addEventListener('click', () => editor());

async function load() {
  box.innerHTML = skeletonRows(3);
  let rows; try { rows = await api.list({ courseId: filter || null }); } catch (e) { console.error(e); box.innerHTML = errorState(e.message); return; }
  if (!rows.length) { box.innerHTML = `<div class="card">${emptyState('No announcements', staff ? 'Post the first one with "New announcement".' : 'Nothing has been posted yet.')}</div>`; return; }
  box.innerHTML = rows.map((a) => {
    const mine = role === 'admin' || a.author_id === me.id;
    return html`<article class="card ann-card ${a.pinned ? 'pinned' : ''}" data-id="${a.id}" style="margin-bottom:var(--sp-3)" ${raw(a.id === focusId ? 'tabindex="-1"' : '')}>
      <div class="row row-between" style="align-items:flex-start;gap:var(--sp-3)"><div style="min-width:0"><h3 style="margin:0;overflow-wrap:anywhere">${a.title}</h3>
        <div class="text-muted text-sm" style="margin-top:2px"><span title="${formatDateTime(a.created_at)}">${timeAgo(a.created_at)}</span> · ${a.author?.full_name || 'Staff'} · ${a.course?.title ?? 'Everyone'}</div></div>
        <div class="row" style="gap:var(--sp-2);flex-wrap:nowrap">${raw(a.pinned ? '<span class="badge badge-orange">Pinned</span>' : '')}</div></div>
      <p class="pre-wrap" style="margin:var(--sp-3) 0 0;overflow-wrap:anywhere">${a.body}</p>
      ${raw(mine ? '<div class="row" style="margin-top:var(--sp-3);gap:var(--sp-2)"><button class="btn btn-ghost btn-sm" data-pin></button><button class="btn btn-ghost btn-sm" data-edit>Edit</button><button class="btn btn-ghost btn-sm" data-del style="color:var(--red-600)">Delete</button></div>' : '')}</article>`.toString();
  }).join('');
  const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
  box.querySelectorAll('[data-id]').forEach((el) => {
    const a = byId[el.dataset.id];
    const pin = el.querySelector('[data-pin]'); if (pin) pin.textContent = a.pinned ? 'Unpin' : 'Pin to top';
    pin?.addEventListener('click', async () => { try { await api.setPinned(a.id, !a.pinned); load(); } catch (e) { toastError(e.message); } });
    el.querySelector('[data-edit]')?.addEventListener('click', () => editor(a));
    el.querySelector('[data-del]')?.addEventListener('click', async () => {
      if (!await confirmDialog('Delete this announcement?', 'It will disappear for everyone who could see it.', { confirmLabel: 'Delete', danger: true })) return;
      try { await api.remove(a.id); toastSuccess('Announcement deleted'); load(); } catch (e) { toastError(e.message); }
    });
  });
  if (focusId) { const el = box.querySelector(`[data-id="${focusId}"]`); if (el) { el.style.outline = '2px solid var(--brand-500)'; el.scrollIntoView?.({ block: 'center' }); } }
}

function editor(a = null) {
  const form = document.createElement('form'); form.noValidate = true;
  const targets = role === 'admin' ? [{ id: '', title: 'Everyone (school-wide)' }, ...courses] : courses;
  form.innerHTML = html`${raw(a ? '' : html`<div class="field"><label for="an-course">Send to</label><select class="select" id="an-course" name="course">${raw(targets.map((c) => html`<option value="${c.id}">${c.title}</option>`).join(''))}</select></div>`)}
    <div class="field"><label for="an-title">Title</label><input class="input" id="an-title" name="title" maxlength="${api.LIMITS.title}" value="${a?.title ?? ''}"></div>
    <div class="field"><label for="an-body">Message</label><textarea class="textarea" id="an-body" name="body" rows="6" maxlength="${api.LIMITS.body}">${a?.body ?? ''}</textarea></div>
    <label class="row" style="gap:var(--sp-2)"><input type="checkbox" name="pinned" ${raw(a?.pinned ? 'checked' : '')}> Pin to the top</label>
    <div class="field-error" id="an-err" role="alert" style="color:var(--red-600);margin-top:var(--sp-2)"></div>`;
  if (!a && !targets.length) return toastError('You do not teach any course yet.');
  const dlg = openModal({ title: a ? 'Edit announcement' : 'New announcement', body: form, actions: [
    { label: 'Cancel', onClick: ({ close }) => close() },
    { label: a ? 'Save' : 'Post', variant: 'primary', onClick: ({ el }) => submit(el.querySelector('.modal-actions .btn-primary')) },
  ] });
  const submit = (btn) => withBusy(btn, async () => {
    const v = { title: form.title.value, body: form.body.value, pinned: form.pinned.checked }, err = api.validate(v);
    if (err) { form.querySelector('#an-err').textContent = err; return; }
    try { if (a) await api.update(a.id, v); else await api.create(form.course.value, v); dlg.close(); toastSuccess(a ? 'Announcement saved' : 'Announcement posted'); load(); }
    catch (e) { form.querySelector('#an-err').textContent = e.message; }
  });
  form.addEventListener('submit', (e) => { e.preventDefault(); submit(dlg.el.querySelector('.modal-actions .btn-primary')); });
}
load();
