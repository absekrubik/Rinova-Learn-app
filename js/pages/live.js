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
const id = param('id'); let timer = null, pulseCtl = null, joinTimer = null, hbTimer = null, closeTimer = null, meetWin = null;
const listUrl = url(`${role}/live-classes.html`);
const notFound = () => { content.innerHTML = `<a class="text-sm" href="${listUrl}">&larr; Live classes</a><div class="card" style="margin-top:var(--sp-4)">${emptyState('Class not found', 'It may have been removed, or you may not have access to it.')}</div>`; };

function untilText(ms) { const m = Math.round(ms / 60000); if (m < 60) return `${m} minute${m === 1 ? '' : 's'}`; const h = Math.floor(m / 60); return h < 48 ? `${h} hour${h === 1 ? '' : 's'}` : `${Math.floor(h / 24)} days`; }

async function load() {
  clearInterval(timer); clearInterval(joinTimer); clearInterval(hbTimer); clearInterval(closeTimer); hbTimer = closeTimer = null; meetWin = null; pulseCtl?.stop(); pulseCtl = null;
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
    ${raw(canManage ? '<div class="card" id="joined-box"></div>' : '')}
    <div id="pulse-box"></div>
    ${raw(rec ? html`<div class="card"><div class="row row-between"><strong>Recording</strong><a class="btn btn-secondary btn-sm" href="${rec}" target="_blank" rel="noopener noreferrer">Watch recording</a></div></div>` : '')}
    ${raw(canManage ? html`<div class="card"><div class="row row-between"><div><strong>Attendance</strong><div class="text-muted text-sm">Mark who attended this class.</div></div><a class="btn btn-secondary" href="${courseUrl}&tab=attendance&live=${c.id}">Take attendance</a></div></div>` : '')}</div>`;

  let me8 = await live.myStatus(c.id).catch(() => null);          // my own join/leave status, kept in step with the server
  const fmtT = (d) => new Date(d).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const stopWatch = () => { clearInterval(closeTimer); closeTimer = null; };
  const startBeat = () => { if (!hbTimer) hbTimer = setInterval(() => { if (me8?.in_class) live.heartbeat(c.id).catch(() => {}); }, live.HEARTBEAT_MS); };
  const refresh = async () => { try { me8 = await live.myStatus(c.id); } catch (err) { console.warn('status', err); } paint(); drawJoined(); if (me8?.in_class) startBeat(); };
  const leave = async () => { stopWatch(); meetWin = null; try { await live.recordLeave(c.id); } catch (err) { console.warn('leave not recorded', err); } await refresh(); };
  const watch = () => { stopWatch(); closeTimer = setInterval(() => { if (meetWin && meetWin.closed) leave(); }, 1500); };   // the meeting tab was closed
  const paint = () => {
    const st = live.classState(c), now = Date.now(), can = canManage ? c.status !== 'cancelled' : live.canJoinNow(c);
    content.querySelector('#state').innerHTML = stateBadge(st);
    const target = live.joinUrl(c, me.full_name || '');
    const box = content.querySelector('#join-box'); let msg = ''; const app = live.jitsiAppLink(c);
    const inClass = !!me8?.in_class, wasIn = !!me8 && !inClass, rejoins = Math.max(0, (me8?.join_count ?? 1) - 1);
    if (c.status === 'cancelled') msg = 'This class was cancelled.';
    else if (!target) msg = 'This class has no valid meeting link. Ask your teacher.';
    else if (!can) msg = st === 'upcoming' ? `You can join from 15 minutes before the start (in about ${untilText(new Date(c.starts_at) - now - live.JOIN_EARLY_MS)}).` : 'This class has ended.';
    const ok = can && target;
    const title = !ok ? 'Join' : inClass ? 'You are in the class' : wasIn ? 'You left the class' : canManage ? 'Start or join the class' : 'The class is open';
    const chips = !ok ? '' : inClass ? html`<span class="chip chip-ok" id="joined-chip">Joined</span><span class="text-sm">at ${fmtT(me8.visit_joined_at)}${rejoins ? ` · rejoined ${rejoins} time${rejoins > 1 ? 's' : ''}` : ''}</span>`.toString()
      : wasIn ? html`<span class="chip chip-off" id="left-chip">Left</span><span class="text-sm">${me8.left_at ? `at ${fmtT(me8.left_at)}` : ''}${me8.visit_joined_at ? ` · you joined at ${fmtT(me8.visit_joined_at)}` : ''}</span>`.toString() : '';
    const help = msg || (inClass ? 'The meeting is open in its own tab. Closed it by mistake? Press Open the meeting. Finished? Press I\'ve left the class.'
      : wasIn ? 'Press Rejoin to come back. Your teacher can see when you join and leave.'
      : c.meeting_url ? (live.providerLabel(c) === 'Google Meet' ? 'Opens Google Meet in a new tab. On a phone or tablet it opens in the Google Meet app if you have it installed; use Present in the call to share your screen.' : 'Opens your meeting link in a new tab.')
      : 'Opens in a new tab. The teacher may be asked to sign in to Jitsi to start the room; students just join. Your teacher can see when you join and leave.');
    const mainLabel = inClass ? 'Open the meeting' : wasIn ? 'Rejoin class' : canManage ? 'Start class' : 'Join class';
    const appLabel = inClass ? 'Open in the app' : wasIn ? 'Rejoin in the app' : canManage ? 'Start in the app' : 'Join in the app';
    const buttons = !ok ? '<button class="btn btn-primary" disabled>Join class</button>' : app
      ? html`<div class="stack-sm" style="min-width:min(100%,15rem)"><a class="btn btn-primary" id="join-app" href="${app.url}">${appLabel}</a><a class="btn btn-secondary" id="join" href="${target}" target="_blank" rel="noopener noreferrer">${inClass ? 'Open in browser' : 'Join in browser instead'}</a>${raw(inClass ? '<button class="btn btn-ghost" id="leave" type="button">I\'ve left the class</button>' : '')}</div>`.toString()
      : html`<div class="stack-sm" style="min-width:min(100%,12rem)"><a class="btn btn-primary" id="join" href="${target}" target="_blank" rel="noopener noreferrer">${mainLabel}</a>${raw(inClass ? '<button class="btn btn-ghost" id="leave" type="button">I\'ve left the class</button>' : '')}</div>`.toString();
    box.innerHTML = html`<div class="row row-between"><div><strong>${title}</strong>
      <div class="row" style="gap:var(--sp-2);margin:var(--sp-1) 0">${raw(chips)}</div>
      <div class="text-muted text-sm">${help}</div></div>${raw(buttons)}</div>
      ${raw(ok && app ? '<div class="text-muted text-sm" id="app-tip" style="margin-top:var(--sp-3)">On a phone, screen sharing only works in the free Jitsi Meet app (three dots, then Share screen). If you do not have it yet, the first button takes you to the store. The browser cannot share your screen. When you use the app, press "I\'ve left the class" once you finish.</div>' : '')}`;
  };
  paint(); timer = setInterval(paint, 30000); if (me8?.in_class) startBeat();
  // Join, Rejoin and Open: the meeting opens in its own tab, and joins and leaves are recorded so this page and the teacher stay right
  content.querySelector('#join-box').addEventListener('click', (e) => {
    if (e.target.closest('#leave')) { leave(); return; }
    const a = e.target.closest('#join, #join-app'); if (!a) return;
    const isApp = a.id === 'join-app', target = live.joinUrl(c, me.full_name || ''), already = !!me8?.in_class;
    if (!isApp && live.isTrackedHost(target)) {
      // a window we keep a handle on, so we notice when it is closed; if it is still open it is brought to the front instead of opening a second one
      if (already && meetWin && !meetWin.closed) { e.preventDefault(); meetWin.focus(); return; }
      const w = window.open(target, `rinova-live-${c.id}`);
      if (w) { e.preventDefault(); meetWin = w; watch(); try { w.focus(); } catch { /* ignore */ } }
    }
    if (!already && live.canJoinNow(c)) live.recordJoin(c.id, isApp ? 'app' : 'tab').then(refresh).catch((err) => console.warn('join not recorded', err));   // never blocks opening the meeting
  });
  if (c.status !== 'cancelled') pulseCtl = mountPulse(content.querySelector('#pulse-box'), { cls: c, canManage });

  // staff: who has joined, who is in now, who left and when, and a short guide to Jitsi's own controls
  const drawJoined = async () => {
    const box = content.querySelector('#joined-box'); if (!box) return;
    try {
      const rows = await live.joinedList(c.id), students = rows.filter((r) => !r.is_staff), total = rows[0]?.enrolled ?? null, inNow = students.filter((r) => r.in_class).length;
      const visit = (v, i) => html`<div class="text-sm text-muted">${i ? 'Rejoined' : 'Joined'} ${fmtT(v.joined_at)} &middot; ${v.left_at ? `left ${fmtT(v.left_at)}` : 'in class now'}</div>`.toString();
      box.innerHTML = html`<div class="row row-between"><strong>Who has joined</strong><span class="text-muted text-sm">${inNow} in class now &middot; ${total != null ? `${students.length} of ${total} students` : `${students.length} student${students.length === 1 ? '' : 's'}`} joined</span></div>
        ${raw(rows.length ? `<ul class="list" style="margin-top:var(--sp-3)">${rows.map((r) => html`<li class="list-item" style="align-items:flex-start"><div><strong>${r.full_name}</strong> ${raw(r.is_staff ? '<span class="badge">Staff</span> ' : '')}${raw(r.in_class ? '<span class="chip chip-ok">In class</span>' : '<span class="chip chip-off">Left</span>')}
          <div style="margin-top:4px">${raw((r.visits ?? []).map(visit).join(''))}</div></div><span class="text-muted text-sm" style="white-space:nowrap">${live.fmtDuration(r.total_seconds)}</span></li>`.toString()).join('')}</ul>` : '<p class="text-muted text-sm" style="margin:var(--sp-3) 0 0">Nobody has joined yet. People show up here when they press Join.</p>')}
        ${raw(!c.meeting_url ? `<details style="margin-top:var(--sp-4)"><summary class="text-sm" style="cursor:pointer"><strong>Controls inside Jitsi</strong></summary><ul class="text-sm text-muted" style="margin:var(--sp-2) 0 0;padding-left:1.2rem;display:grid;gap:4px"><li>Sign in to Jitsi when asked (Google or GitHub). The person who signs in first becomes the moderator.</li><li>Tap a participant's tile, then <strong>Pin</strong> to keep them big, or use <strong>Mute</strong>, <strong>Kick</strong> and <strong>Ask to unmute</strong>.</li><li><strong>Tile view</strong> (grid button) shows everyone. <strong>Share your screen</strong> is in the bottom bar, and on a phone or Android board it is in the Jitsi app.</li><li>Moderator tools such as <strong>Mute everyone</strong> are in the three-dot menu, under Security options.</li></ul></details>` : '')}`;
    } catch (err) { console.warn('joined list', err); }
  };
  if (canManage) { drawJoined(); joinTimer = setInterval(drawJoined, 15000); }

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
