// All live classes the signed-in user can see (admin: every course; teacher: own courses; student: enrolled courses).
import { mountShell } from '../ui/shell.js';
import { html, raw, url } from '../core/utils.js';
import { emptyState, errorState, skeletonRows } from '../ui/states.js';
import * as live from '../services/live.js';
import * as courses from '../services/courses.js';
import { classDialog, stateBadge, whenText } from '../ui/live-ui.js';
import { toastError } from '../ui/toast.js';

const role = document.body.dataset.role, staff = role !== 'student';
const { content } = await mountShell({ roles: [role], active: `${role}/live-classes.html`, title: 'Live classes' });
content.innerHTML = `<div class="page-head"><div><h1>Live classes</h1><p>${staff ? 'Schedule and run live sessions for your courses.' : 'Your upcoming and past live sessions.'}</p></div>${staff ? '<button class="btn btn-primary" id="sched">+ Schedule class</button>' : ''}</div><div id="list"></div>`;
const box = content.querySelector('#list');

async function load() {
  box.innerHTML = skeletonRows(4);
  try {
    const rows = await live.listClasses();
    const now = Date.now();
    const up = rows.filter((c) => c.status !== 'cancelled' && new Date(c.ends_at) >= now).sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at));
    const rest = rows.filter((c) => !up.includes(c)).sort((a, b) => new Date(b.starts_at) - new Date(a.starts_at));
    const item = (c) => html`<div class="list-item"><div style="min-width:0"><a href="${url(`${role}/live.html`)}?id=${c.id}" style="font-weight:560;overflow-wrap:anywhere">${c.title}</a><div class="meta">${c.courses?.title ?? ''} · ${whenText(c)}</div></div>
      <div class="row" style="gap:var(--sp-2);flex-wrap:nowrap">${raw(stateBadge(live.classState(c)))}${raw(live.canJoinNow(c) ? `<a class="btn btn-primary btn-sm" href="${url(`${role}/live.html`)}?id=${c.id}">${staff ? 'Open' : 'Join'}</a>` : '')}</div></div>`;
    box.innerHTML = html`<div class="card" style="padding:var(--sp-4)"><h3 style="margin:0 0 var(--sp-2)">Upcoming</h3>${raw(up.length ? `<div class="list">${up.map(item).join('')}</div>` : emptyState('No upcoming classes', staff ? 'Use "Schedule class" to add one.' : 'Nothing is scheduled right now.'))}</div>
      ${raw(rest.length ? html`<div class="card" style="padding:var(--sp-4);margin-top:var(--sp-4)"><h3 style="margin:0 0 var(--sp-2)">Past and cancelled</h3><div class="list">${raw(rest.map(item).join(''))}</div></div>` : '')}`;
  } catch (e) { console.error(e); box.innerHTML = errorState(e.message); }
}
content.querySelector('#sched')?.addEventListener('click', async () => {
  try { const cs = (await courses.listCourses()).filter((c) => c.status !== 'archived'); if (!cs.length) return toastError('Create a course first.'); classDialog({ courses: cs.map((c) => ({ id: c.id, title: c.title })), onDone: load }); } catch (e) { toastError(e.message); }
});
load();
