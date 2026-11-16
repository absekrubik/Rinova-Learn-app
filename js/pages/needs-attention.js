// Teachers and admins: students who may be falling behind, with a one-click friendly nudge.
import { mountShell } from '../ui/shell.js';
import { html, raw, url, timeAgo } from '../core/utils.js';
import { emptyState, errorState, skeletonRows } from '../ui/states.js';
import { openModal } from '../ui/modal.js';
import { toastSuccess, toastError } from '../ui/toast.js';
import { withBusy } from '../ui/form.js';
import * as api from '../services/earlyWarning.js';

const role = document.body.dataset.role;
const { content } = await mountShell({ roles: [role], active: `${role}/needs-attention.html`, title: 'Needs attention' });
const state = { rows: [], level: 'all', course: 'all' };
content.innerHTML = html`<div class="page-head"><div><h1>Needs attention</h1><p>Students who may be falling behind, worked out from attendance, deadlines, quizzes and activity. A gentle nudge goes to the student, not to anyone else.</p></div></div>
  <div id="sum"></div><div class="card" style="padding:var(--sp-4)"><div class="row" style="gap:var(--sp-3);flex-wrap:wrap;margin-bottom:var(--sp-3)"><div class="field" style="margin:0"><label for="f-level" class="text-sm">Level</label><select class="select" id="f-level"><option value="all">All levels</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select></div>
  <div class="field" style="margin:0"><label for="f-course" class="text-sm">Course</label><select class="select" id="f-course"><option value="all">All courses</option></select></div></div><div id="list">${raw(skeletonRows(4))}</div></div>`;
const $ = (s) => content.querySelector(s);

function nudgeDialog(r) {
  const form = document.createElement('form');
  form.innerHTML = html`<p class="text-sm" style="margin-top:0">This sends a notification to <strong>${r.full_name}</strong> about <strong>${r.course_title}</strong>. Leave the note empty to send a friendly default message.</p>
    <div class="field"><label for="nd-note">Your note (optional)</label><textarea class="textarea" id="nd-note" rows="4" maxlength="${api.NOTE_MAX}" placeholder="Let's catch up this week. Is anything getting in the way?"></textarea><div class="text-sm text-muted" id="nd-count">0 / ${api.NOTE_MAX}</div></div>`;
  const note = form.querySelector('#nd-note'), count = form.querySelector('#nd-count');
  note.addEventListener('input', () => { count.textContent = `${note.value.length} / ${api.NOTE_MAX}`; });
  const send = async ({ close, el }) => {
    await withBusy(el.querySelector('.modal-actions .btn-primary'), async () => {
      try { await api.nudge(r.course_id, r.student_id, note.value); r.last_nudged_at = new Date().toISOString(); close(); toastSuccess(`Nudge sent to ${r.full_name}`); draw(); }
      catch (e) { toastError(e.message || 'Could not send the nudge.'); }
    });
  };
  form.addEventListener('submit', (e) => { e.preventDefault(); form.closest('.modal-backdrop')?.querySelector('.modal-actions .btn-primary')?.click(); });
  openModal({ title: 'Send a nudge', body: form, actions: [{ label: 'Cancel', onClick: ({ close }) => close() }, { label: 'Send nudge', variant: 'primary', onClick: send }] });
}

function draw() {
  const all = state.rows, by = (l) => all.filter((r) => api.levelOf(r.risk_score) === l).length;
  $('#sum').innerHTML = html`<div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:var(--sp-3);margin-bottom:var(--sp-4)">${raw(['high', 'medium', 'low'].map((l) => html`<div class="card stat" style="padding:var(--sp-3) var(--sp-4)"><div class="stat-value">${by(l)}</div><div class="stat-label">${api.LEVELS[l].label} level</div></div>`.toString()).join(''))}</div>`;
  const rows = all.filter((r) => (state.level === 'all' || api.levelOf(r.risk_score) === state.level) && (state.course === 'all' || r.course_id === state.course));
  const box = $('#list');
  if (!all.length) { box.innerHTML = emptyState('Everyone looks on track', 'No student has a warning sign right now. This list updates itself as attendance, deadlines and quizzes change.'); return; }
  if (!rows.length) { box.innerHTML = emptyState('Nothing matches these filters', 'Try another level or course.'); return; }
  box.innerHTML = `<div class="list">${rows.map((r) => {
    const lv = api.LEVELS[api.levelOf(r.risk_score)], ok = api.canNudge(r);
    return html`<div class="list-item" style="align-items:flex-start;flex-wrap:wrap;gap:var(--sp-3)"><div style="flex:1 1 260px;min-width:0"><div class="row" style="gap:var(--sp-2);flex-wrap:wrap"><strong style="overflow-wrap:anywhere">${r.full_name}</strong><span class="badge ${lv.badge}">${lv.label}</span></div>
      <div class="text-muted text-sm" style="overflow-wrap:anywhere">${r.email} · <a href="${url(`${role}/reports.html`)}?course=${r.course_id}">${r.course_title}</a></div>
      <ul style="margin:var(--sp-2) 0 0;padding-left:1.1em">${raw(api.reasons(r).map((x) => html`<li>${x}</li>`.toString()).join(''))}</ul></div>
      <div style="text-align:right"><button class="btn btn-secondary btn-sm" data-nudge="${r.course_id}:${r.student_id}" ${raw(ok ? '' : 'disabled')}>${ok ? 'Nudge' : 'Nudged'}</button>${raw(r.last_nudged_at ? `<div class="text-muted text-sm">Last nudge ${html`${timeAgo(r.last_nudged_at)}`}</div>` : '')}</div></div>`.toString();
  }).join('')}</div>`;
}
async function load() {
  try {
    state.rows = await api.list();
    const seen = new Map(); state.rows.forEach((r) => seen.set(r.course_id, r.course_title));
    $('#f-course').innerHTML = html`<option value="all">All courses</option>${raw([...seen].map(([id, t]) => html`<option value="${id}">${t}</option>`.toString()).join(''))}`;
    draw();
  } catch (e) { console.error(e); $('#sum').innerHTML = ''; $('#list').innerHTML = errorState(e.message); }
}
$('#f-level').onchange = (e) => { state.level = e.target.value; draw(); };
$('#f-course').onchange = (e) => { state.course = e.target.value; draw(); };
$('#list').addEventListener('click', (e) => {
  const b = e.target.closest('[data-nudge]'); if (!b || b.disabled) return;
  const [c, s] = b.dataset.nudge.split(':'); const r = state.rows.find((x) => x.course_id === c && x.student_id === s); if (r) nudgeDialog(r);
});
await load();
