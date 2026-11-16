// All quizzes the signed-in user can see. Old-style links (quizzes.html?id=...) forward to the quiz page.
import { param, url } from '../core/utils.js';
const old = param('id');
if (old && /^[0-9a-f-]{36}$/i.test(old)) location.replace(`${url(`${document.body.dataset.role}/quiz.html`)}?id=${old}`);
else await start();

async function start() {
  const [{ mountShell }, { html, raw }, { emptyState, errorState, skeletonRows }, api, courses, ui, { toastError }] = await Promise.all([
    import('../ui/shell.js'), import('../core/utils.js'), import('../ui/states.js'), import('../services/quizzes.js'),
    import('../services/courses.js'), import('../ui/quiz-ui.js'), import('../ui/toast.js')]);
  const role = document.body.dataset.role, staff = role !== 'student';
  const { content } = await mountShell({ roles: [role], active: `${role}/quizzes.html`, title: 'Quizzes' });
  content.innerHTML = `<div class="page-head"><div><h1>Quizzes</h1><p>${staff ? 'Build quizzes and review results.' : 'Your quizzes across all courses.'}</p></div>${staff ? '<button class="btn btn-primary" id="new">+ New quiz</button>' : ''}</div><div id="list"></div>`;
  const box = content.querySelector('#list');
  const link = (q) => `${url(`${role}/quiz.html`)}?id=${q.id}`;
  async function load() {
    box.innerHTML = skeletonRows(4);
    try {
      const rows = await api.listQuizzes();
      const st = staff ? await api.stats() : null, mine = staff ? null : await api.myAttempts();
      const item = (q) => html`<div class="list-item"><div style="min-width:0"><a href="${link(q)}" style="font-weight:560;overflow-wrap:anywhere">${q.title}</a>
        <div class="meta">${q.courses?.title ?? ''} · ${ui.windowText(q)}${raw(staff ? ` · ${st.get(q.id)?.attempts ?? 0} attempts${st.get(q.id)?.pending ? `, ${st.get(q.id).pending} to grade` : ''}` : '')}</div></div>
        <div class="row" style="gap:var(--sp-2);flex-wrap:nowrap">${raw(staff ? ui.availBadge(q) : ui.attemptBadge(q, mine))}</div></div>`;
      box.innerHTML = html`<div class="card" style="padding:var(--sp-4)">${raw(rows.length ? `<div class="list">${rows.map(item).join('')}</div>` : emptyState('No quizzes', staff ? 'Use "New quiz" to add one.' : 'Nothing to take right now.'))}</div>`;
    } catch (e) { console.error(e); box.innerHTML = errorState(e.message); }
  }
  content.querySelector('#new')?.addEventListener('click', async () => {
    try { const cs = (await courses.listCourses()).filter((c) => c.status !== 'archived'); if (!cs.length) return toastError('Create a course first.'); ui.quizDialog({ courses: cs.map((c) => ({ id: c.id, title: c.title })), onDone: (q) => { location.href = link(q); } }); } catch (e) { toastError(e.message); }
  });
  load();
}
