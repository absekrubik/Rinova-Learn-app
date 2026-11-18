import { showSplash } from '../ui/splash.js';
import { mountShell } from '../ui/shell.js';
import { html, raw, formatDate } from '../core/utils.js';
import { renderAsync } from '../ui/states.js';
import { newest } from '../services/profiles.js';
import { layout, loadStats, loadLive, loadNews } from './dashboard-common.js';
showSplash();

const { me, content } = await mountShell({ roles: ['admin'], active: 'admin/index.html', title: 'Dashboard' });
const el = layout(content, { me, subtitle: 'Platform overview.', statCount: 4 });
loadStats(el.stats, 'admin', (s) => [[s.students, 'Students'], [s.teachers, 'Teachers'], [`${s.published_courses} / ${s.courses}`, 'Courses published'], [s.enrollments, 'Active enrollments']]);
loadLive(el.live); loadNews(el.news);

el.extra.innerHTML = '<div class="card"><h3 class="card-title" style="margin-bottom:var(--sp-3)">Newest users</h3><div id="users"></div></div>';
renderAsync(el.extra.querySelector('#users'), () => newest(6), (rows) => `<div class="table-wrap"><table class="table"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Joined</th></tr></thead><tbody>${rows.map((u) => html`
  <tr><td>${u.full_name || '—'}</td><td>${u.email}</td><td><span class="badge badge-blue" style="text-transform:capitalize">${u.role}</span></td>
  <td>${raw(u.status === 'active' ? '<span class="badge badge-green">Active</span>' : '<span class="badge badge-red">Suspended</span>')}</td><td>${formatDate(u.created_at)}</td></tr>`).join('')}</tbody></table></div>`,
  { empty: 'No users yet.' });
