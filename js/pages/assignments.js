// All assignments the signed-in user can see. Old notification links (assignments.html?id=...) are forwarded to the detail page.
import { param, url } from '../core/utils.js';
const old = param('id');
if (old && /^[0-9a-f-]{36}$/i.test(old)) location.replace(`${url(`${document.body.dataset.role}/assignment.html`)}?id=${old}`);
else await start();

async function start() {
  const [{ mountShell }, { html, raw }, { emptyState, errorState, skeletonRows }, api, courses, ui, { toastError }] = await Promise.all([
    import('../ui/shell.js'), import('../core/utils.js'), import('../ui/states.js'), import('../services/assignments.js'),
    import('../services/courses.js'), import('../ui/assignment-ui.js'), import('../ui/toast.js')]);
  const role = document.body.dataset.role, staff = role !== 'student';
  const { me, content } = await mountShell({ roles: [role], active: `${role}/assignments.html`, title: 'Assignments' });
  content.innerHTML = `<div class="page-head"><div><h1>Assignments</h1><p>${staff ? 'Create assignments and review student work.' : 'Your assignments across all courses.'}</p></div>${staff ? '<button class="btn btn-primary" id="new">+ New assignment</button>' : ''}</div><div id="list"></div>`;
  const box = content.querySelector('#list');
  async function load() {
    box.innerHTML = skeletonRows(4);
    try {
      const rows = await api.listAssignments();
      const st = staff ? await api.stats() : null, mine = staff ? null : await api.mySubmissions(me.id);
      const link = (a) => `${url(`${role}/assignment.html`)}?id=${a.id}`;
      const item = (a) => html`<div class="list-item"><div style="min-width:0"><a href="${link(a)}" style="font-weight:560;overflow-wrap:anywhere">${a.title}</a>
        <div class="meta">${a.courses?.title ?? ''} · ${ui.dueText(a)}${raw(staff ? ` · ${st.get(a.id)?.submitted ?? 0} submitted, ${st.get(a.id)?.graded ?? 0} graded` : '')}</div></div>
        <div class="row" style="gap:var(--sp-2);flex-wrap:nowrap">${raw(staff ? ui.dueBadge(a) : ui.submissionBadge(mine.get(a.id), a))}</div></div>`;
      // to do first (student) / newest deadlines first, finished work last
      const done = (a) => (staff ? false : ['graded'].includes(mine.get(a.id)?.status));
      const open = rows.filter((a) => !done(a)), finished = rows.filter(done);
      box.innerHTML = html`<div class="card" style="padding:var(--sp-4)">${raw(open.length ? `<div class="list">${open.map(item).join('')}</div>` : emptyState('No assignments', staff ? 'Use "New assignment" to add one.' : 'Nothing to do right now.'))}</div>
        ${raw(finished.length ? html`<div class="card" style="padding:var(--sp-4);margin-top:var(--sp-4)"><h3 style="margin:0 0 var(--sp-2)">Graded</h3><div class="list">${raw(finished.map(item).join(''))}</div></div>` : '')}`;
    } catch (e) { console.error(e); box.innerHTML = errorState(e.message); }
  }
  content.querySelector('#new')?.addEventListener('click', async () => {
    try { const cs = (await courses.listCourses()).filter((c) => c.status !== 'archived'); if (!cs.length) return toastError('Create a course first.'); ui.assignmentDialog({ courses: cs.map((c) => ({ id: c.id, title: c.title })), onDone: load }); } catch (e) { toastError(e.message); }
  });
  load();
}
