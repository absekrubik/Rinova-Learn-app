// "Live classes" tab of a course.
import { html, raw, url } from '../core/utils.js';
import { emptyState, errorState, skeletonRows } from '../ui/states.js';
import * as live from '../services/live.js';
import { classDialog, stateBadge, whenText } from '../ui/live-ui.js';

export async function renderLive(pane, { course, me, role, canManage }) {
  pane.innerHTML = skeletonRows(3);
  let rows; try { rows = await live.listClasses({ courseId: course.id }); } catch (e) { console.error(e); pane.innerHTML = errorState(e.message); return; }
  const refresh = () => renderLive(pane, { course, me, role, canManage });
  const now = Date.now();
  const up = rows.filter((c) => c.status !== 'cancelled' && new Date(c.ends_at) >= now).sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at));
  const rest = rows.filter((c) => !up.includes(c)).sort((a, b) => new Date(b.starts_at) - new Date(a.starts_at));
  const item = (c) => html`<div class="list-item"><div style="min-width:0"><a href="${url(`${role}/live.html`)}?id=${c.id}" style="font-weight:560;overflow-wrap:anywhere">${c.title}</a>
      <div class="meta">${whenText(c)} · ${live.providerLabel(c)}</div></div>
    <div class="row" style="gap:var(--sp-2);flex-wrap:nowrap">${raw(stateBadge(live.classState(c)))}${raw(live.canJoinNow(c) || (canManage && c.status !== 'cancelled' && live.classState(c) !== 'ended') ? `<a class="btn btn-primary btn-sm" href="${url(`${role}/live.html`)}?id=${c.id}">${canManage ? 'Open' : 'Join'}</a>` : '')}</div></div>`;
  pane.innerHTML = html`${raw(canManage ? '<div class="row row-between" style="margin-bottom:var(--sp-4)"><span class="text-muted text-sm">Enrolled students are notified when you schedule, move or cancel a class.</span><button class="btn btn-primary" id="sched">+ Schedule class</button></div>' : '')}
    <div class="card" style="padding:var(--sp-4)"><h3 style="margin:0 0 var(--sp-2)">Upcoming</h3>${raw(up.length ? `<div class="list">${up.map(item).join('')}</div>` : emptyState('No upcoming classes', canManage ? 'Schedule one with the button above.' : 'Your teacher has not scheduled a class yet.'))}</div>
    ${raw(rest.length ? html`<div class="card" style="padding:var(--sp-4);margin-top:var(--sp-4)"><h3 style="margin:0 0 var(--sp-2)">Past and cancelled</h3><div class="list">${raw(rest.map(item).join(''))}</div></div>` : '')}`;
  pane.querySelector('#sched')?.addEventListener('click', () => classDialog({ courseId: course.id, onDone: refresh }));
}
