// One live class: details, join button (opens in a new tab), recording, staff controls.
import { mountShell } from '../ui/shell.js';
import { html, raw, url, param } from '../core/utils.js';
import { confirmDialog } from '../ui/modal.js';
import { toastSuccess, toastError } from '../ui/toast.js';
import { emptyState, errorState, skeletonRows } from '../ui/states.js';
import * as live from '../services/live.js';
import * as courses from '../services/courses.js';
import { mountPulse } from '../ui/pulse-ui.js';
import { classDialog, stateBadge, whenText } from '../ui/live-ui.js';

const role = document.body.dataset.role;
const { me, content } = await mountShell({ roles: [role], active: `${role}/live-classes.html`, title: 'Live class' });
const id = param('id'); let timer = null, pulseCtl = null;
const listUrl = url(`${role}/live-classes.html`);
const notFound = () => { content.innerHTML = `<a class="text-sm" href="${listUrl}">&larr; Live classes</a><div class="card" style="margin-top:var(--sp-4)">${emptyState('Class not found', 'It may have been removed, or you may not have access to it.')}</div>`; };

function untilText(ms) { const m = Math.round(ms / 60000); if (m < 60) return `${m} minute${m === 1 ? '' : 's'}`; const h = Math.floor(m / 60); return h < 48 ? `${h} hour${h === 1 ? '' : 's'}` : `${Math.floor(h / 24)} days`; }

async function load() {
  clearInterval(timer); pulseCtl?.stop(); pulseCtl = null;
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return notFound();
  content.innerHTML = skeletonRows(3);
  let c, course;
  try { c = await live.getClass(id); if (!c) return notFound(); course = await courses.getCourse(c.course_id); } catch (e) { console.error(e); content.innerHTML = errorState(e.message); return; }
  const canManage = role === 'admin' || (course?.course_teachers ?? []).some((t) => t.teacher_id === me.id);
  document.title = `${c.title} · Rinova Learn`;
  const courseUrl = `${url(`${role}/course.html`)}?id=${c.course_id}`;
  const rec = live.safeHttpsUrl(c.recording_url);
  content.innerHTML = html`<div class="lesson-layout"><div><a class="text-sm" href="${listUrl}">&larr; Live classes</a>
    <div class="page-head" style="margin:var(--sp-3) 0 0"><div><div class="text-muted text-sm"><a href="${courseUrl}">${c.courses?.title ?? course?.title ?? ''}</a></div><h1>${c.title}</h1>
      <div class="row" style="gap:var(--sp-2);margin-top:var(--sp-2)"><span id="state"></span><span class="badge">${live.providerLabel(c)}</span></div></div>
      ${raw(canManage ? '<div class="row"><button class="btn btn-secondary" id="edit">Edit</button><button class="btn btn-ghost" id="cancel"></button><button class="btn btn-ghost" id="del" style="color:var(--red-600)">Delete</button></div>' : '')}</div></div>
    <div class="card"><div class="grid grid-2"><div><div class="text-muted text-sm">When</div><strong>${whenText(c)}</strong></div><div><div class="text-muted text-sm">Where</div><strong>${live.providerLabel(c)}</strong></div></div>
      ${raw(c.description ? html`<p class="pre-wrap" style="margin:var(--sp-4) 0 0">${c.description}</p>` : '')}</div>
    <div class="card" id="join-box"></div>
    <div id="pulse-box"></div>
    ${raw(rec ? html`<div class="card"><div class="row row-between"><strong>Recording</strong><a class="btn btn-secondary btn-sm" href="${rec}" target="_blank" rel="noopener noreferrer">Watch recording</a></div></div>` : '')}
    ${raw(canManage ? html`<div class="card"><div class="row row-between"><div><strong>Attendance</strong><div class="text-muted text-sm">Mark who attended this class.</div></div><a class="btn btn-secondary" href="${courseUrl}&tab=attendance&live=${c.id}">Take attendance</a></div></div>` : '')}</div>`;

  const paint = () => {
    const st = live.classState(c), now = Date.now(), can = canManage ? c.status !== 'cancelled' : live.canJoinNow(c);
    content.querySelector('#state').innerHTML = stateBadge(st);
    const target = live.joinUrl(c, me.full_name || '');
    const box = content.querySelector('#join-box'); let msg = '';
    if (c.status === 'cancelled') msg = 'This class was cancelled.';
    else if (!target) msg = 'This class has no valid meeting link. Ask your teacher.';
    else if (!can) msg = st === 'upcoming' ? `You can join from 15 minutes before the start (in about ${untilText(new Date(c.starts_at) - now - live.JOIN_EARLY_MS)}).` : 'This class has ended.';
    box.innerHTML = html`<div class="row row-between"><div><strong>${can && target ? (canManage ? 'Start or join the class' : 'The class is open') : 'Join'}</strong>
      <div class="text-muted text-sm">${msg || (c.meeting_url ? 'Opens your meeting link in a new tab.' : 'Opens in a new tab. The teacher may be asked to sign in to Jitsi to start the room; students just join.')}</div></div>
      ${raw(can && target ? `<a class="btn btn-primary" id="join" href="${target}" target="_blank" rel="noopener noreferrer">${canManage ? 'Start class' : 'Join class'}</a>` : '<button class="btn btn-primary" disabled>Join class</button>')}</div>`;
  };
  paint(); timer = setInterval(paint, 30000);
  if (c.status !== 'cancelled') pulseCtl = mountPulse(content.querySelector('#pulse-box'), { cls: c, canManage });

  if (!canManage) return;
  content.querySelector('#cancel').textContent = c.status === 'cancelled' ? 'Restore class' : 'Cancel class';
  content.querySelector('#edit').addEventListener('click', () => classDialog({ cls: c, onDone: load }));
  content.querySelector('#cancel').addEventListener('click', async () => {
    const cancelling = c.status !== 'cancelled';
    if (cancelling && !await confirmDialog('Cancel this class?', 'Enrolled students will be notified that it is cancelled.', { confirmLabel: 'Cancel class', danger: true })) return;
    try { await live.setClassStatus(c.id, cancelling ? 'cancelled' : 'scheduled'); toastSuccess(cancelling ? 'Class cancelled' : 'Class restored'); load(); } catch (e) { toastError(e.message); }
  });
  content.querySelector('#del').addEventListener('click', async () => {
    if (!await confirmDialog('Delete this class?', 'It will be removed permanently. Attendance already taken for it is kept.', { confirmLabel: 'Delete class', danger: true })) return;
    try { await live.deleteClass(c.id); toastSuccess('Class deleted'); location.href = listUrl; } catch (e) { toastError(e.message); }
  });
}
load();
