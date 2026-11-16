// "Assignments" tab of a course.
import { html, raw, url } from '../core/utils.js';
import { emptyState, errorState, skeletonRows } from '../ui/states.js';
import * as api from '../services/assignments.js';
import { assignmentDialog, dueText, dueBadge, submissionBadge } from '../ui/assignment-ui.js';

export async function renderAssignments(pane, { course, me, role, canManage }) {
  pane.innerHTML = skeletonRows(3);
  let rows, st, mine;
  try {
    rows = await api.listAssignments({ courseId: course.id });
    if (canManage) st = await api.stats(course.id); else mine = await api.mySubmissions(me.id, course.id);
  } catch (e) { console.error(e); pane.innerHTML = errorState(e.message); return; }
  const refresh = () => renderAssignments(pane, { course, me, role, canManage });
  const link = (a) => `${url(`${role}/assignment.html`)}?id=${a.id}`;
  const item = (a) => html`<div class="list-item"><div style="min-width:0"><a href="${link(a)}" style="font-weight:560;overflow-wrap:anywhere">${a.title}</a>
      <div class="meta">${dueText(a)} · ${Number(a.max_points)} points${raw(canManage ? ` · ${st.get(a.id)?.submitted ?? 0} submitted, ${st.get(a.id)?.graded ?? 0} graded` : '')}</div></div>
    <div class="row" style="gap:var(--sp-2);flex-wrap:nowrap">${raw(canManage ? dueBadge(a) : submissionBadge(mine.get(a.id), a))}</div></div>`;
  pane.innerHTML = html`${raw(canManage ? '<div class="row row-between" style="margin-bottom:var(--sp-4)"><span class="text-muted text-sm">Students only see published assignments.</span><button class="btn btn-primary" id="new">+ New assignment</button></div>' : '')}
    <div class="card" style="padding:var(--sp-4)">${raw(rows.length ? `<div class="list">${rows.map(item).join('')}</div>` : emptyState('No assignments yet', canManage ? 'Create one with the button above.' : 'Your teacher has not posted any assignments.'))}</div>`;
  pane.querySelector('#new')?.addEventListener('click', () => assignmentDialog({ courseId: course.id, onDone: refresh }));
}
