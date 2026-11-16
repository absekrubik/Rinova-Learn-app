// "Attendance" tab: teachers/admins take and review attendance; students see their own record.
import { html, raw, formatDate } from '../core/utils.js';
import { avatarInner } from '../core/avatar.js';
import { openModal, confirmDialog } from '../ui/modal.js';
import { toastSuccess, toastError } from '../ui/toast.js';
import { formData, setFieldError, clearErrors, withBusy } from '../ui/form.js';
import { emptyState, errorState, skeletonRows } from '../ui/states.js';
import * as att from '../services/attendance.js';
import * as live from '../services/live.js';
import * as courses from '../services/courses.js';

const LABEL = { present: 'Present', late: 'Late', absent: 'Absent', excused: 'Excused' };
const BADGE = { present: 'badge-green', late: 'badge-orange', absent: 'badge-red', excused: '' };
const badge = (s) => (s ? `<span class="badge ${BADGE[s]}">${LABEL[s]}</span>` : '<span class="text-muted text-sm">Not recorded</span>');
const today = () => { const d = new Date(), p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
const pct = (v) => (v == null ? '—' : `${v}%`);

export async function renderAttendance(pane, ctx) { return ctx.canManage ? staffView(pane, ctx) : studentView(pane, ctx); }

// ---------------- student ----------------
async function studentView(pane, { course, me }) {
  pane.innerHTML = skeletonRows(3);
  try {
    const [sessions, mine, sum] = await Promise.all([att.listSessions(course.id), att.myRecords(course.id, me.id), att.summary(course.id, me.id)]);
    const s = sum[0];
    pane.innerHTML = html`<div class="grid grid-4" style="margin-bottom:var(--sp-4)">
      ${raw([['Attendance', s ? pct(s.percent) : '—'], ['Present', s?.present ?? 0], ['Late', s?.late ?? 0], ['Absent', s?.absent ?? 0]].map(([l, v]) => html`<div class="card"><div class="text-muted text-sm">${l}</div><div style="font-size:var(--fs-xl);font-weight:650">${v}</div></div>`).join(''))}</div>
      <div class="card" style="padding:var(--sp-4)"><h3 style="margin:0 0 var(--sp-2)">Sessions</h3>${raw(sessions.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Date</th><th>Session</th><th>Status</th><th>Note</th></tr></thead><tbody>${sessions.map((x) => { const r = mine.get(x.id); return html`<tr><td>${formatDate(x.session_date)}</td><td>${x.title ?? 'Class'}</td><td>${raw(badge(r?.status))}</td><td class="text-muted text-sm">${r?.note ?? ''}</td></tr>`; }).join('')}</tbody></table></div>` : emptyState('No sessions yet', 'Attendance will appear here once your teacher takes it.'))}
      <p class="text-muted text-sm" style="margin:var(--sp-3) 0 0">Attendance % counts Present and Late; Excused sessions are left out.</p></div>`;
  } catch (e) { console.error(e); pane.innerHTML = errorState(e.message); }
}

// ---------------- staff ----------------
async function staffView(pane, ctx) {
  const { course } = ctx; pane.innerHTML = skeletonRows(4);
  let sessions, sum, enr, classes;
  try { [sessions, sum, enr, classes] = await Promise.all([att.listSessions(course.id), att.summary(course.id), courses.listEnrollments(course.id), live.listClasses({ courseId: course.id })]); } catch (e) { console.error(e); pane.innerHTML = errorState(e.message); return; }
  const refresh = () => staffView(pane, ctx);
  const sm = new Map(sum.map((x) => [x.student_id, x])); const roster = enr.filter((e) => e.status !== 'dropped');
  const linked = new Set(sessions.map((x) => x.live_class_id).filter(Boolean));

  pane.innerHTML = html`<div class="row row-between" style="margin-bottom:var(--sp-4)"><span class="text-muted text-sm">${roster.length} enrolled student${roster.length === 1 ? '' : 's'}</span><button class="btn btn-primary" id="newsess" ${raw(roster.length ? '' : 'disabled')}>+ Take attendance</button></div>
    <div class="card" style="padding:var(--sp-4)"><h3 style="margin:0 0 var(--sp-2)">Sessions</h3>${raw(sessions.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Date</th><th>Session</th><th>Present</th><th>Late</th><th>Absent</th><th>Excused</th><th></th></tr></thead><tbody>${sessions.map((x) => html`<tr data-id="${x.id}"><td>${formatDate(x.session_date)}</td><td><strong>${x.title ?? 'Class'}</strong></td><td>${x.counts.present}</td><td>${x.counts.late}</td><td>${x.counts.absent}</td><td>${x.counts.excused}</td>
      <td style="text-align:right;white-space:nowrap"><button class="btn btn-secondary btn-sm" data-open>Mark / review</button><button class="btn btn-ghost btn-sm" data-edit>Rename</button><button class="btn btn-ghost btn-sm" data-del style="color:var(--red-600)">Delete</button></td></tr>`).join('')}</tbody></table></div>` : emptyState('No attendance taken yet', 'Use "Take attendance" to start a session.'))}</div>
    <div class="card" style="padding:var(--sp-4);margin-top:var(--sp-4)"><h3 style="margin:0 0 var(--sp-2)">By student</h3>${raw(roster.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Student</th><th>Present</th><th>Late</th><th>Absent</th><th>Excused</th><th>Attendance</th></tr></thead><tbody>${roster.map((r) => { const s = sm.get(r.student_id); return html`<tr><td><div class="row"><span class="avatar">${raw(avatarInner(r.profiles))}</span><div><strong>${r.profiles?.full_name || '—'}</strong><div class="text-muted text-sm">${r.profiles?.email}</div></div></div></td><td>${s?.present ?? 0}</td><td>${s?.late ?? 0}</td><td>${s?.absent ?? 0}</td><td>${s?.excused ?? 0}</td><td><strong>${pct(s?.percent)}</strong></td></tr>`; }).join('')}</tbody></table></div>` : emptyState('No students enrolled', 'Enroll students from the Students tab first.'))}</div>`;

  const byId = Object.fromEntries(sessions.map((x) => [x.id, x]));
  pane.querySelector('#newsess')?.addEventListener('click', () => sessionDialog());
  pane.querySelectorAll('tbody tr[data-id]').forEach((tr) => {
    const s = byId[tr.dataset.id];
    tr.querySelector('[data-open]').addEventListener('click', () => markView(s));
    tr.querySelector('[data-edit]').addEventListener('click', () => sessionDialog(s));
    tr.querySelector('[data-del]').addEventListener('click', async () => {
      if (!await confirmDialog('Delete this session?', `Attendance marked for "${s.title ?? 'Class'}" will be permanently deleted.`, { confirmLabel: 'Delete session', danger: true })) return;
      try { await att.deleteSession(s.id); toastSuccess('Session deleted'); refresh(); } catch (e) { toastError(e.message); }
    });
  });

  function sessionDialog(s = null) {
    const free = classes.filter((c) => c.status !== 'cancelled' && !linked.has(c.id));
    const form = document.createElement('form'); form.noValidate = true;
    form.innerHTML = html`<div class="grid grid-2"><div class="field"><label for="as-date">Date</label><input class="input" id="as-date" name="session_date" type="date" required value="${s?.session_date ?? today()}"></div>
      <div class="field"><label for="as-title">Title</label><input class="input" id="as-title" name="title" maxlength="120" placeholder="e.g. Week 3 class" value="${s?.title ?? ''}"></div></div>
      ${raw(!s && free.length ? html`<div class="field"><label for="as-live">Link to a live class (optional)</label><select class="select" id="as-live" name="live_class_id"><option value="">No link</option>${raw(free.map((c) => html`<option value="${c.id}">${c.title} — ${formatDate(c.starts_at)}</option>`).join(''))}</select></div>` : '')}`;
    const dlg = openModal({ title: s ? 'Rename session' : 'Take attendance', body: form, actions: [{ label: 'Cancel', onClick: ({ close }) => close() },
      { label: s ? 'Save' : 'Start', variant: 'primary', onClick: async ({ el }) => {
        clearErrors(form); const d = formData(form);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(d.session_date ?? '')) return setFieldError(form.elements.session_date, 'Choose a date');
        await withBusy(el.querySelector('.modal-actions .btn-primary'), async () => {
          try {
            if (s) { await att.updateSession(s.id, d); toastSuccess('Session updated'); dlg.close(); refresh(); return; }
            if (!d.title && d.live_class_id) d.title = classes.find((c) => c.id === d.live_class_id)?.title ?? '';
            const created = await att.createSession(course.id, { title: d.title ?? '', session_date: d.session_date, live_class_id: d.live_class_id }); dlg.close(); markView(created);
          } catch (e) { toastError(e.message); }
        });
      } }] });
  }

  async function markView(session) {
    pane.innerHTML = skeletonRows(4);
    let existing; try { existing = await att.sessionRecords(session.id); } catch (e) { toastError(e.message); return refresh(); }
    const state = new Map(roster.map((r) => [r.student_id, { status: existing.get(r.student_id)?.status ?? 'present', note: existing.get(r.student_id)?.note ?? '' }]));
    pane.innerHTML = html`<div class="row row-between" style="margin-bottom:var(--sp-3)"><div><button class="btn btn-ghost btn-sm" id="back">&larr; All sessions</button><h3 style="margin:var(--sp-2) 0 0">${session.title ?? 'Class'} <span class="text-muted text-sm">· ${formatDate(session.session_date)}</span></h3></div>
      <div class="row"><button class="btn btn-secondary btn-sm" id="allp">Mark all present</button><button class="btn btn-primary" id="save">Save attendance</button></div></div>
      <div class="card" style="padding:var(--sp-4)"><div class="table-wrap"><table class="table"><thead><tr><th>Student</th><th style="width:160px">Status</th><th>Note</th></tr></thead><tbody>${raw(roster.map((r) => html`<tr data-s="${r.student_id}"><td><div class="row"><span class="avatar">${raw(avatarInner(r.profiles))}</span><strong>${r.profiles?.full_name || r.profiles?.email}</strong></div></td>
        <td><select class="select" data-status aria-label="Status for ${r.profiles?.full_name ?? 'student'}" style="height:36px">${raw(att.STATUSES.map((x) => `<option value="${x}" ${x === state.get(r.student_id).status ? 'selected' : ''}>${LABEL[x]}</option>`).join(''))}</select></td>
        <td><input class="input" data-note maxlength="${att.NOTE_MAX}" placeholder="Optional" aria-label="Note" style="height:36px;min-width:150px" value="${state.get(r.student_id).note}"></td></tr>`).join(''))}</tbody></table></div>
      <p class="text-muted text-sm" id="tally" style="margin:var(--sp-3) 0 0"></p></div>`;
    const tally = () => { const c = { present: 0, late: 0, absent: 0, excused: 0 }; state.forEach((v) => c[v.status]++); pane.querySelector('#tally').textContent = `${c.present} present · ${c.late} late · ${c.absent} absent · ${c.excused} excused`; };
    pane.querySelectorAll('tr[data-s]').forEach((tr) => {
      const st = state.get(tr.dataset.s);
      tr.querySelector('[data-status]').addEventListener('change', (e) => { st.status = e.target.value; tally(); });
      tr.querySelector('[data-note]').addEventListener('input', (e) => { st.note = e.target.value; });
    });
    pane.querySelector('#allp').addEventListener('click', () => { state.forEach((v) => { v.status = 'present'; }); pane.querySelectorAll('[data-status]').forEach((s) => { s.value = 'present'; }); tally(); });
    pane.querySelector('#back').addEventListener('click', refresh);
    pane.querySelector('#save').addEventListener('click', (e) => withBusy(e.currentTarget, async () => {
      try { await att.saveRecords(session.id, [...state].map(([student_id, v]) => ({ student_id, ...v }))); toastSuccess('Attendance saved'); refresh(); } catch (err) { toastError(err.message); }
    }));
    tally();
  }

  // opened from a live class page: ?tab=attendance&live=<id>
  if (ctx.openLive && !ctx.openLiveDone) {
    ctx.openLiveDone = true;
    try {
      let s = sessions.find((x) => x.live_class_id === ctx.openLive);
      if (!s) { const c = classes.find((x) => x.id === ctx.openLive); if (c) s = await att.createSession(course.id, { title: c.title, session_date: live.toLocalInput(c.starts_at).slice(0, 10), live_class_id: c.id }); }
      if (s) markView(s);
    } catch (e) { toastError(e.message); }
  }
}
