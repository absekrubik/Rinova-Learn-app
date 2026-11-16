import { mountShell } from '../ui/shell.js';
import { html, raw, url } from '../core/utils.js';
import { renderAsync } from '../ui/states.js';
import * as ew from '../services/earlyWarning.js';
import { layout, loadStats, loadLive, loadNews } from './dashboard-common.js';

const { me, content } = await mountShell({ roles: ['teacher'], active: 'teacher/index.html', title: 'Dashboard' });
const el = layout(content, { me, subtitle: 'Your classes and what needs your attention.' });
loadStats(el.stats, 'teacher', (s) => [[s.courses, 'My courses'], [s.students, 'Students'], [s.pending_submissions, 'Submissions to grade'], [s.upcoming_live_classes, 'Upcoming live classes']]);
loadLive(el.live); loadNews(el.news);

el.extra.innerHTML = html`<div class="card"><div class="row row-between" style="margin-bottom:var(--sp-3)"><h3 class="card-title" style="margin:0">Needs attention</h3><a class="btn btn-secondary btn-sm" href="${url('teacher/needs-attention.html')}">See all</a></div><div id="risk"></div></div>`;
renderAsync(el.extra.querySelector('#risk'), () => ew.list(), (rows) => `<div class="list">${rows.slice(0, 4).map((r) => html`<div class="list-item"><div style="min-width:0"><strong style="overflow-wrap:anywhere">${r.full_name}</strong><div class="meta">${r.course_title} · ${ew.reasons(r)[0] ?? ''}</div></div><span class="badge ${ew.LEVELS[ew.levelOf(r.risk_score)].badge}">${ew.LEVELS[ew.levelOf(r.risk_score)].label}</span></div>`.toString()).join('')}</div>${rows.length > 4 ? `<p class="text-muted text-sm" style="margin:var(--sp-2) 0 0">and ${rows.length - 4} more</p>` : ''}`,
  { empty: 'Everyone looks on track. No student has a warning sign right now.', skeleton: 2 });
