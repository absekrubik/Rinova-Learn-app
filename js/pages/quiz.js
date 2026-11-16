// One quiz. Teachers/admins: settings, question builder, attempts and grading. Students: details, take the quiz, see results.
import { mountShell } from '../ui/shell.js';
import { html, raw, url, param, formatDateTime } from '../core/utils.js';
import { avatarInner } from '../core/avatar.js';
import { openModal, confirmDialog } from '../ui/modal.js';
import { toastSuccess, toastError } from '../ui/toast.js';
import { withBusy } from '../ui/form.js';
import { emptyState, errorState, skeletonRows } from '../ui/states.js';
import * as api from '../services/quizzes.js';
import * as courses from '../services/courses.js';
import { quizDialog, questionDialog, availBadge, windowText, renderReview } from '../ui/quiz-ui.js';

const role = document.body.dataset.role;
const { me, content } = await mountShell({ roles: [role], active: `${role}/quizzes.html`, title: 'Quiz' });
const id = param('id');
const listUrl = url(`${role}/quizzes.html`);
let timer = null, guard = null;
const notFound = () => { content.innerHTML = `<a class="text-sm" href="${listUrl}">&larr; Quizzes</a><div class="card" style="margin-top:var(--sp-4)">${emptyState('Quiz not found', 'It may have been removed, or you may not have access to it.')}</div>`; };
const stopTimers = () => { clearInterval(timer); timer = null; if (guard) { removeEventListener('beforeunload', guard); guard = null; } };

async function load() {
  stopTimers();
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return notFound();
  content.innerHTML = skeletonRows(3);
  let quiz, course;
  try { quiz = await api.getQuiz(id); if (!quiz) return notFound(); course = await courses.getCourse(quiz.course_id); } catch (e) { console.error(e); content.innerHTML = errorState(e.message); return; }
  const canManage = role === 'admin' || (course?.course_teachers ?? []).some((t) => t.teacher_id === me.id);
  document.title = `${quiz.title} · Rinova Learn`;
  const courseUrl = `${url(`${role}/course.html`)}?id=${quiz.course_id}&tab=quizzes`;
  const facts = html`<div class="row" style="gap:var(--sp-2);flex-wrap:wrap"><span class="badge">${quiz.time_limit_minutes ? `${quiz.time_limit_minutes} minutes` : 'No time limit'}</span><span class="badge">${quiz.max_attempts ? `${quiz.max_attempts} attempt${quiz.max_attempts === 1 ? '' : 's'}` : 'Unlimited attempts'}</span><span class="badge">Pass mark ${Number(quiz.pass_percent)}%</span></div>`;
  content.innerHTML = html`<div class="lesson-layout"><div><a class="text-sm" href="${listUrl}">&larr; Quizzes</a>
    <div class="page-head" style="margin:var(--sp-3) 0 0"><div><div class="text-muted text-sm"><a href="${courseUrl}">${quiz.courses?.title ?? course?.title ?? ''}</a></div><h1>${quiz.title}</h1>
      <div class="row" style="gap:var(--sp-2);margin-top:var(--sp-2)">${raw(availBadge(quiz))}</div></div>
      ${raw(canManage ? `<div class="row"><button class="btn btn-secondary" id="settings">Settings</button><button class="btn btn-secondary" id="pub">${quiz.is_published ? 'Unpublish' : 'Publish'}</button><button class="btn btn-ghost" id="del" style="color:var(--red-600)">Delete</button></div>` : '')}</div></div>
    <div class="card">${raw(quiz.description ? html`<p class="pre-wrap" style="margin:0 0 var(--sp-3)">${quiz.description}</p>` : '')}${raw(facts)}<div class="text-muted text-sm" style="margin-top:var(--sp-3)">${windowText(quiz)}</div></div>
    <div id="main"></div></div>`;
  const main = content.querySelector('#main');
  if (canManage) {
    content.querySelector('#settings').addEventListener('click', () => quizDialog({ quiz, onDone: load }));
    content.querySelector('#pub').addEventListener('click', async () => { try { await api.setPublished(quiz.id, !quiz.is_published); toastSuccess(quiz.is_published ? 'Quiz hidden from students' : 'Quiz published'); load(); } catch (e) { toastError(e.message); } });
    content.querySelector('#del').addEventListener('click', async () => {
      if (!await confirmDialog('Delete this quiz?', 'All questions and every student attempt for it will be permanently deleted.', { confirmLabel: 'Delete quiz', danger: true })) return;
      try { await api.deleteQuiz(quiz.id); toastSuccess('Quiz deleted'); location.href = listUrl; } catch (e) { toastError(e.message); }
    });
    return staffView(main, quiz);
  }
  return studentView(main, quiz);
}

// ---------------- staff ----------------
async function staffView(box, quiz) {
  box.innerHTML = skeletonRows(3);
  let qs, locked, attempts;
  try { [qs, locked, attempts] = await Promise.all([api.loadQuestions(quiz.id), api.hasAttempts(quiz.id), api.listAttempts(quiz.id)]); } catch (e) { console.error(e); box.innerHTML = errorState(e.message); return; }
  const refresh = () => staffView(box, quiz);
  const total = qs.reduce((s, q) => s + q.points, 0);
  const correctText = (q) => (q.type === 'short_text' ? (q.accepted_text.length ? `Accepted: ${q.accepted_text.join(', ')}` : 'You grade this by hand') : `Correct: ${q.options.filter((o) => q.correct_ids.includes(o.id)).map((o) => o.label).join(', ') || '— not set'}`);
  box.innerHTML = html`<div class="card" style="padding:var(--sp-4)"><div class="row row-between" style="margin-bottom:var(--sp-3)"><h3 style="margin:0">Questions <span class="text-muted text-sm">${qs.length} · ${total} points</span></h3>${raw(locked ? '' : '<button class="btn btn-primary btn-sm" id="addq">+ Add question</button>')}</div>
      ${raw(locked ? '<div class="alert" role="note" style="margin-bottom:var(--sp-3)">Students have started this quiz, so questions cannot be added or removed and answers cannot change. You can still fix wording.</div>' : '')}
      ${raw(qs.length ? `<div class="list">${qs.map((q, i) => html`<div class="list-item" data-q="${q.id}"><div style="min-width:0"><div class="text-muted text-sm">${i + 1}. ${api.TYPES[q.type]} · ${q.points} pt${q.points === 1 ? '' : 's'}</div>
        <div class="pre-wrap" style="font-weight:560">${q.prompt}</div><div class="text-muted text-sm" style="overflow-wrap:anywhere">${correctText(q)}</div></div>
        <div class="row" style="gap:2px;flex-wrap:nowrap"><button class="btn btn-ghost btn-sm" data-move="-1" aria-label="Move up" ${raw(i === 0 ? 'disabled' : '')}>&uarr;</button><button class="btn btn-ghost btn-sm" data-move="1" aria-label="Move down" ${raw(i === qs.length - 1 ? 'disabled' : '')}>&darr;</button>
          <button class="btn btn-ghost btn-sm" data-edit>Edit</button>${raw(locked ? '' : '<button class="btn btn-ghost btn-sm" data-del style="color:var(--red-600)">Delete</button>')}</div></div>`).join('')}</div>` : emptyState('No questions yet', 'Add your first question. A quiz needs at least one before it can be published.'))}</div>
    <div class="card" style="padding:var(--sp-4)"><h3 style="margin:0 0 var(--sp-3)">Attempts <span class="text-muted text-sm">${attempts.length}</span></h3>
      ${raw(attempts.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Student</th><th>Status</th><th>Score</th><th>Submitted</th><th></th></tr></thead><tbody>${attempts.map((a) => html`<tr data-a="${a.id}"><td><div class="row"><span class="avatar">${raw(avatarInner(a.profiles))}</span><strong>${a.profiles?.full_name || a.profiles?.email}</strong></div></td>
        <td>${raw(a.status === 'submitted' ? '<span class="badge badge-blue">Needs grading</span>' : '<span class="badge badge-green">Graded</span>')}</td><td>${Number(a.score ?? 0)} / ${Number(a.max_score)} (${api.percent(a.score ?? 0, a.max_score)}%)</td><td class="text-sm">${formatDateTime(a.submitted_at)}</td><td style="text-align:right"><button class="btn btn-secondary btn-sm" data-review>Review</button></td></tr>`).join('')}</tbody></table></div>` : emptyState('No attempts yet', quiz.is_published ? 'Results appear here once students submit.' : 'Publish the quiz so students can take it.'))}</div>`;
  box.querySelector('#addq')?.addEventListener('click', () => questionDialog({ quizId: quiz.id, position: qs.length, onDone: refresh }));
  const byId = Object.fromEntries(qs.map((q) => [q.id, q]));
  box.querySelectorAll('[data-q]').forEach((row) => {
    const q = byId[row.dataset.q], i = qs.indexOf(q);
    row.querySelector('[data-edit]').addEventListener('click', () => questionDialog({ quizId: quiz.id, q, locked, onDone: refresh }));
    row.querySelector('[data-del]')?.addEventListener('click', async () => {
      if (!await confirmDialog('Delete this question?', 'It will be removed from the quiz.', { confirmLabel: 'Delete question', danger: true })) return;
      try { await api.deleteQuestion(q.id); toastSuccess('Question deleted'); await api.reorderQuestions(qs.filter((x) => x !== q)); refresh(); } catch (e) { toastError(e.message); }
    });
    row.querySelectorAll('[data-move]').forEach((b) => b.addEventListener('click', async () => {
      const j = i + +b.dataset.move; if (j < 0 || j >= qs.length) return; const order = qs.slice(); [order[i], order[j]] = [order[j], order[i]];
      try { await api.reorderQuestions(order); refresh(); } catch (e) { toastError(e.message); }
    }));
  });
  box.querySelectorAll('[data-a]').forEach((tr) => tr.querySelector('[data-review]').addEventListener('click', () => reviewDialog(tr.dataset.a, refresh)));
}

async function reviewDialog(attemptId, onClose) {
  const body = document.createElement('div'); body.innerHTML = skeletonRows(3);
  const dlg = openModal({ title: 'Review attempt', body, actions: [{ label: 'Close', onClick: ({ close }) => close() }], onClose });
  dlg.el.querySelector('.modal').style.maxWidth = '760px';
  async function paint() {
    try {
      const review = await api.attemptReview(attemptId);
      renderReview(body, review, { staff: true, onGrade: async (rid, pts, max, button) => {
        await withBusy(button, async () => { try { await api.gradeResponse(rid, pts, max); toastSuccess('Points saved'); await paint(); } catch (e) { toastError(e.message); } });
      } });
    } catch (e) { body.innerHTML = errorState(e.message); }
  }
  paint();
}

// ---------------- student ----------------
async function studentView(box, quiz) {
  box.innerHTML = skeletonRows(2);
  let mine; try { mine = (await api.myAttempts(quiz.course_id)).filter((a) => a.quiz_id === quiz.id); } catch (e) { console.error(e); box.innerHTML = errorState(e.message); return; }
  const open = mine.find((a) => a.status === 'in_progress'), done = mine.filter((a) => a.status !== 'in_progress');
  const avail = api.availability(quiz), left = api.attemptsLeft(quiz, mine);
  let note = '';
  if (!open) { if (avail === 'upcoming') note = `This quiz opens ${formatDateTime(quiz.available_from)}.`; else if (avail === 'closed') note = 'This quiz is closed.'; else if (left === 0) note = 'You have used all your attempts.'; }
  box.innerHTML = html`<div class="card"><div class="row row-between"><div><strong>${open ? 'You have an attempt in progress' : done.length ? 'Your attempts' : 'Ready when you are'}</strong>
      <div class="text-muted text-sm">${note || (quiz.time_limit_minutes ? `The ${quiz.time_limit_minutes}-minute timer starts as soon as you begin.` : 'Take your time. There is no timer.')}${raw(left !== Infinity && !note ? ` ${left} attempt${left === 1 ? '' : 's'} left.` : '')}</div></div>
      <button class="btn btn-primary" id="start" ${raw(note ? 'disabled' : '')}>${open ? 'Continue' : done.length ? 'Try again' : 'Start quiz'}</button></div></div>
    ${raw(done.length ? html`<div class="card" style="padding:var(--sp-4)"><div class="table-wrap"><table class="table"><thead><tr><th>#</th><th>Submitted</th><th>Result</th><th></th></tr></thead><tbody>${raw(done.map((a, i) => html`<tr data-a="${a.id}"><td>${i + 1}</td><td class="text-sm">${formatDateTime(a.submitted_at)}</td>
      <td>${raw(!quiz.show_results ? '<span class="badge badge-blue">Submitted</span>' : a.status === 'submitted' ? '<span class="badge badge-blue">Waiting for grade</span>' : html`<strong>${Number(a.score)} / ${Number(a.max_score)}</strong> <span class="text-muted text-sm">(${api.percent(a.score, a.max_score)}%)</span> ${raw(api.percent(a.score, a.max_score) >= Number(quiz.pass_percent) ? '<span class="badge badge-green">Passed</span>' : '<span class="badge badge-red">Not passed</span>')}`)}</td>
      <td style="text-align:right">${raw(quiz.show_results ? '<button class="btn btn-secondary btn-sm" data-review>Details</button>' : '')}</td></tr>`).join(''))}</tbody></table></div></div>` : '')}
    <div id="detail"></div>`;
  box.querySelector('#start')?.addEventListener('click', (e) => withBusy(e.currentTarget, async () => {
    try { const aid = await api.startAttempt(quiz.id); if (!aid) { toastError('No attempts left.'); return load(); } await take(box, quiz, aid); } catch (er) { toastError(er.message); }
  }));
  box.querySelectorAll('tr[data-a] [data-review]').forEach((b) => b.addEventListener('click', async () => {
    const aid = b.closest('tr').dataset.a, d = box.querySelector('#detail'); d.innerHTML = skeletonRows(2);
    try { renderReview(d, await api.attemptReview(aid)); d.scrollIntoView?.({ behavior: 'smooth' }); } catch (e) { d.innerHTML = errorState(e.message); }
  }));
}

async function take(box, quiz, attemptId) {
  box.innerHTML = skeletonRows(4);
  let data; try { data = await api.attemptQuestions(attemptId); } catch (e) { toastError(e.message); return load(); }
  const answers = new Map(data.questions.map((q) => [q.id, { option_ids: [], text: '' }]));
  const answered = (a) => a.option_ids.length > 0 || a.text.trim().length > 0;
  box.innerHTML = html`<div class="card" id="bar" style="position:sticky;top:var(--sp-2);z-index:5"><div class="row row-between"><span id="prog" class="text-sm"></span><strong id="clock" aria-live="off"></strong></div></div>
    <form id="qz" novalidate>${raw(data.questions.map((q, i) => html`<div class="card" data-q="${q.id}"><div class="text-muted text-sm">Question ${i + 1} of ${data.questions.length} · ${Number(q.points)} point${Number(q.points) === 1 ? '' : 's'}${raw(q.type === 'multiple' ? ' · choose all that apply' : '')}</div>
      <p class="pre-wrap" style="margin:var(--sp-1) 0 var(--sp-3);font-weight:560">${q.prompt}</p>
      ${raw(q.type === 'short_text' ? html`<input class="input" data-text maxlength="${api.LIMITS.text}" aria-label="Your answer to question ${i + 1}" autocomplete="off">`
        : `<div class="list">${q.options.map((o) => html`<label class="row" style="gap:var(--sp-3);padding:var(--sp-2) 0;cursor:pointer;flex-wrap:nowrap"><input type="${q.type === 'multiple' ? 'checkbox' : 'radio'}" name="q-${q.id}" value="${o.id}"><span style="overflow-wrap:anywhere">${o.label}</span></label>`).join('')}</div>`)}</div>`).join(''))}
      <div class="row" style="justify-content:flex-end"><button class="btn btn-primary" type="submit" id="send">Submit quiz</button></div></form>`;
  const form = box.querySelector('#qz'), prog = box.querySelector('#prog'), clock = box.querySelector('#clock');
  const paintProg = () => { const n = [...answers.values()].filter(answered).length; prog.textContent = `${n} of ${data.questions.length} answered`; };
  form.addEventListener('input', (e) => {
    const card = e.target.closest('[data-q]'); if (!card) return; const a = answers.get(card.dataset.q);
    if (e.target.matches('[data-text]')) a.text = e.target.value; else a.option_ids = [...card.querySelectorAll('input:checked')].map((x) => x.value);
    paintProg();
  });
  paintProg();
  guard = (e) => { e.preventDefault(); e.returnValue = ''; }; addEventListener('beforeunload', guard);
  let sending = false;
  async function send(auto) {
    if (sending) return; sending = true; clearInterval(timer); timer = null;
    const btn = box.querySelector('#send'); btn.disabled = true; btn.setAttribute('aria-busy', 'true');
    try {
      const res = await api.submitAttempt(attemptId, answers); stopTimers();
      if (auto) toastError('Time is up. Your answers were submitted.');
      return finished(box, quiz, attemptId, res);
    } catch (e) { toastError(e.message); sending = false; btn.disabled = false; btn.removeAttribute('aria-busy'); if (/already submitted|not found/i.test(e.message)) { stopTimers(); load(); } }
  }
  form.addEventListener('submit', async (e) => {
    e.preventDefault(); const missing = data.questions.length - [...answers.values()].filter(answered).length;
    if (missing > 0 && !await confirmDialog('Submit with unanswered questions?', `${missing} question${missing === 1 ? ' is' : 's are'} still empty. You cannot change your answers after submitting.`, { confirmLabel: 'Submit anyway' })) return;
    send(false);
  });
  if (data.deadline) {
    const end = new Date(data.deadline).getTime();
    const tick = () => { const ms = end - Date.now(); if (ms <= 0) { clock.textContent = '0:00'; send(true); return; } const s = Math.ceil(ms / 1000); clock.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; clock.style.color = s <= 60 ? 'var(--red-600)' : ''; };
    tick(); timer = setInterval(tick, 1000);
  } else clock.textContent = 'No time limit';
}

async function finished(box, quiz, attemptId, res) {
  box.innerHTML = html`<div class="card" style="text-align:center;padding:var(--sp-6)"><h2 style="margin-top:0">Quiz submitted</h2>
    ${raw(res.score != null ? html`<div style="font-size:var(--fs-xl);font-weight:650">${Number(res.score)} / ${Number(res.max_score)} <span class="text-muted text-sm">(${Number(res.percent)}%)</span></div><div style="margin:var(--sp-2) 0">${raw(res.pending_manual_grading ? '<span class="badge badge-blue">Some answers are waiting for your teacher</span>' : res.passed ? '<span class="badge badge-green">Passed</span>' : '<span class="badge badge-red">Not passed</span>')}</div>` : '<p class="text-muted">Your answers were saved. Your teacher will share the results.</p>')}
    <div class="row" style="justify-content:center;margin-top:var(--sp-4)">${raw(quiz.show_results ? '<button class="btn btn-secondary" id="det">See details</button>' : '')}<button class="btn btn-primary" id="back">Back to quiz</button></div></div><div id="detail"></div>`;
  box.querySelector('#back').addEventListener('click', load);
  box.querySelector('#det')?.addEventListener('click', async (e) => {
    const d = box.querySelector('#detail'); d.innerHTML = skeletonRows(2);
    try { renderReview(d, await api.attemptReview(attemptId)); e.target.remove(); } catch (er) { d.innerHTML = errorState(er.message); }
  });
}
load();
