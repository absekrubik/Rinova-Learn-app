// "Quizzes" tab of a course.
import { html, raw, url } from '../core/utils.js';
import { emptyState, errorState, skeletonRows } from '../ui/states.js';
import * as api from '../services/quizzes.js';
import { quizDialog, availBadge, attemptBadge, windowText } from '../ui/quiz-ui.js';

export async function renderQuizzes(pane, { course, me, role, canManage }) {
  pane.innerHTML = skeletonRows(3);
  let rows, st, mine;
  try {
    rows = await api.listQuizzes({ courseId: course.id });
    if (canManage) st = await api.stats(course.id); else mine = await api.myAttempts(course.id);
  } catch (e) { console.error(e); pane.innerHTML = errorState(e.message); return; }
  const refresh = () => renderQuizzes(pane, { course, me, role, canManage });
  const link = (q) => `${url(`${role}/quiz.html`)}?id=${q.id}`;
  const item = (q) => html`<div class="list-item"><div style="min-width:0"><a href="${link(q)}" style="font-weight:560;overflow-wrap:anywhere">${q.title}</a>
      <div class="meta">${windowText(q)}${q.time_limit_minutes ? ` · ${q.time_limit_minutes} min` : ''}${raw(canManage ? ` · ${st.get(q.id)?.attempts ?? 0} attempt${(st.get(q.id)?.attempts ?? 0) === 1 ? '' : 's'}${st.get(q.id)?.pending ? `, ${st.get(q.id).pending} to grade` : ''}` : '')}</div></div>
    <div class="row" style="gap:var(--sp-2);flex-wrap:nowrap">${raw(canManage ? availBadge(q) : attemptBadge(q, mine))}</div></div>`;
  pane.innerHTML = html`${raw(canManage ? '<div class="row row-between" style="margin-bottom:var(--sp-4)"><span class="text-muted text-sm">Students only see published quizzes.</span><button class="btn btn-primary" id="new">+ New quiz</button></div>' : '')}
    <div class="card" style="padding:var(--sp-4)">${raw(rows.length ? `<div class="list">${rows.map(item).join('')}</div>` : emptyState('No quizzes yet', canManage ? 'Create one with the button above.' : 'Your teacher has not posted any quizzes.'))}</div>`;
  pane.querySelector('#new')?.addEventListener('click', () => quizDialog({ courseId: course.id, onDone: (q) => { location.href = `${link(q)}`; } }));
}
