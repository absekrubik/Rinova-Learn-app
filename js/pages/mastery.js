// "My mastery" page for students: how strong am I in each topic, and what should I revise?
import { mountShell } from '../ui/shell.js';
import { html, raw, url } from '../core/utils.js';
import { emptyState, errorState, skeletonRows } from '../ui/states.js';
import * as api from '../services/mastery.js';
import { masteryCards, levelBadge } from '../ui/mastery-ui.js';

const { content } = await mountShell({ roles: ['student'], active: 'student/mastery.html', title: 'My mastery' });
content.innerHTML = `<div class="page-head"><div><h1>My mastery</h1><p>How strong you are in each topic, worked out from your quiz results.</p></div></div><div id="body">${skeletonRows(4)}</div>`;
const body = content.querySelector('#body');

try {
  const rows = await api.myMastery();
  if (!rows.length) body.innerHTML = `<div class="card">${emptyState('No topics yet', 'Your teachers have not set up topics for your courses yet. Once they do, your strengths will show here.')}</div>`;
  else {
    const focus = api.weakTopics(rows, 4);
    const courses = [...new Map(rows.map((r) => [r.course_id, r.course_title])).entries()];
    body.innerHTML = html`${raw(focus.length ? html`<div class="card mfocus"><h3 style="margin:0 0 var(--sp-1)">Focus on these first</h3><div class="text-muted text-sm" style="margin-bottom:var(--sp-3)">Your weakest topics right now.</div>
        <div class="mfocus-list">${raw(focus.map((r) => html`<div class="mfocus-item"><div><strong>${r.topic}</strong><div class="text-muted text-sm">${r.course_title} · ${api.pct(r.percent)}</div></div>${r.lessons?.find((l) => !l.locked) ? raw(html`<a class="btn btn-secondary btn-sm" href="${url('student/lesson.html')}?id=${r.lessons.find((l) => !l.locked).id}">Revise</a>`) : ''}</div>`).join(''))}</div></div>` : '')}
      ${raw(courses.map(([cid, title]) => html`<section style="margin-top:var(--sp-6)"><div class="row row-between" style="margin-bottom:var(--sp-3)"><h2 style="margin:0;font-size:1.2rem">${title}</h2><a class="text-sm" href="${url('student/course.html')}?id=${cid}">Open course &rarr;</a></div>${raw(masteryCards(rows.filter((r) => r.course_id === cid)))}</section>`).join(''))}`;
  }
} catch (e) { console.error(e); body.innerHTML = errorState(e.message); }
