// Shared quiz UI: badges, settings dialog, question editor, review renderer.
import { html, raw, formatDateTime } from '../core/utils.js';
import { openModal } from './modal.js';
import { toastSuccess, toastError } from './toast.js';
import { formData, setFieldError, clearErrors, withBusy } from './form.js';
import * as api from '../services/quizzes.js';
import { toLocalInput, fromLocalInput } from '../services/live.js';

export const availBadge = (q) => ({ draft: '<span class="badge badge-orange">Draft</span>', upcoming: '<span class="badge badge-blue">Opens later</span>', closed: '<span class="badge badge-red">Closed</span>', open: '' }[api.availability(q)]);
export const windowText = (q) => (q.available_from || q.available_until
  ? [q.available_from ? `Opens ${formatDateTime(q.available_from)}` : '', q.available_until ? `closes ${formatDateTime(q.available_until)}` : ''].filter(Boolean).join(', ') : 'Always open');
export const attemptBadge = (q, attempts) => {
  const mine = attempts.filter((a) => a.quiz_id === q.id), open = mine.find((a) => a.status === 'in_progress'), done = mine.filter((a) => a.status !== 'in_progress');
  if (open) return '<span class="badge badge-orange">In progress</span>';
  if (!done.length) return '<span class="badge">Not started</span>';
  const best = done.filter((a) => a.score != null).map((a) => api.percent(a.score, a.max_score));
  if (!q.show_results) return '<span class="badge badge-blue">Submitted</span>';
  if (done.some((a) => a.status === 'submitted') && !best.length) return '<span class="badge badge-blue">Waiting for grade</span>';
  return `<span class="badge ${Math.max(...best) >= Number(q.pass_percent) ? 'badge-green' : 'badge-red'}">Best ${Math.max(...best)}%</span>`;
};

/** Settings dialog for creating / editing a quiz. */
export function quizDialog({ courseId = null, courses = [], quiz = null, onDone }) {
  const editing = !!quiz;
  const form = document.createElement('form'); form.noValidate = true;
  form.innerHTML = html`${raw(!courseId && !editing ? html`<div class="field"><label for="qz-course">Course</label><select class="select" id="qz-course" name="course_id">${raw(courses.map((c) => html`<option value="${c.id}">${c.title}</option>`).join(''))}</select></div>` : '')}
    <div class="field"><label for="qz-title">Title</label><input class="input" id="qz-title" name="title" maxlength="${api.LIMITS.title}" required value="${quiz?.title ?? ''}"></div>
    <div class="field"><label for="qz-desc">Description (optional)</label><textarea class="textarea" id="qz-desc" name="description" rows="3" maxlength="${api.LIMITS.description}">${quiz?.description ?? ''}</textarea></div>
    <div class="grid grid-3"><div class="field"><label for="qz-time">Time limit (min)</label><input class="input" id="qz-time" name="time" type="number" min="1" max="${api.LIMITS.minutesMax}" placeholder="None" value="${quiz?.time_limit_minutes ?? ''}"></div>
      <div class="field"><label for="qz-att">Attempts</label><input class="input" id="qz-att" name="attempts" type="number" min="1" max="${api.LIMITS.attemptsMax}" placeholder="Unlimited" value="${quiz?.max_attempts ?? ''}"></div>
      <div class="field"><label for="qz-pass">Pass mark (%)</label><input class="input" id="qz-pass" name="pass" type="number" min="0" max="100" step="1" value="${quiz ? Number(quiz.pass_percent) : 50}"></div></div>
    <div class="grid grid-2"><div class="field"><label for="qz-from">Opens (optional)</label><input class="input" id="qz-from" name="from" type="datetime-local" value="${quiz?.available_from ? toLocalInput(quiz.available_from) : ''}"></div>
      <div class="field"><label for="qz-until">Closes (optional)</label><input class="input" id="qz-until" name="until" type="datetime-local" value="${quiz?.available_until ? toLocalInput(quiz.available_until) : ''}"></div></div>
    <label class="row" style="gap:var(--sp-2);margin-bottom:var(--sp-2)"><input type="checkbox" name="shuffle" ${raw(quiz?.shuffle_questions ? 'checked' : '')}> Shuffle the order of questions for each student</label>
    <label class="row" style="gap:var(--sp-2);margin-bottom:var(--sp-2)"><input type="checkbox" name="show" ${raw(!quiz || quiz.show_results ? 'checked' : '')}> Students see their score after submitting</label>
    <label class="row" style="gap:var(--sp-2)"><input type="checkbox" name="reveal" ${raw(quiz?.reveal_answers ? 'checked' : '')}> Also show the correct answers and explanations</label>`;
  const syncReveal = () => { const on = form.elements.show.checked; form.elements.reveal.disabled = !on; if (!on) form.elements.reveal.checked = false; };
  form.elements.show.addEventListener('change', syncReveal); syncReveal();
  const dlg = openModal({ title: editing ? 'Quiz settings' : 'New quiz', body: form, actions: [{ label: 'Cancel', onClick: ({ close }) => close() },
    { label: editing ? 'Save changes' : 'Create', variant: 'primary', onClick: async ({ el }) => {
      clearErrors(form); const d = formData(form); let ok = true;
      const bad = (n, m) => { setFieldError(form.elements[n], m); ok = false; };
      if (!d.title) bad('title', 'Enter a title');
      const num = (k, min, max, name) => { if (d[k] === '' || d[k] == null) return null; const n = Number(d[k]); if (!Number.isInteger(n) || n < min || n > max) { bad(name, `Enter a whole number from ${min} to ${max}`); return null; } return n; };
      const time = num('time', 1, api.LIMITS.minutesMax, 'time'), att = num('attempts', 1, api.LIMITS.attemptsMax, 'attempts');
      const pass = Number(d.pass); if (!(pass >= 0 && pass <= 100)) bad('pass', 'Enter 0 to 100');
      const from = d.from ? fromLocalInput(d.from) : null, until = d.until ? fromLocalInput(d.until) : null;
      if (from && until && new Date(until) <= new Date(from)) bad('until', 'Closing time must be after the opening time');
      const cid = courseId ?? quiz?.course_id ?? d.course_id; if (!cid) { toastError('Choose a course'); ok = false; }
      if (!ok) return;
      const v = { title: d.title, description: d.description, time_limit_minutes: time, max_attempts: att, pass_percent: pass, available_from: from, available_until: until,
        shuffle_questions: form.elements.shuffle.checked, show_results: form.elements.show.checked, reveal_answers: form.elements.reveal.checked };
      await withBusy(el.querySelector('.modal-actions .btn-primary'), async () => {
        try { const r = editing ? await api.updateQuiz(quiz.id, v) : await api.createQuiz(cid, v); toastSuccess(editing ? 'Quiz updated' : 'Quiz created'); dlg.close(); onDone?.(r); } catch (e) { toastError(e.message); }
      });
    } }] });
}

/** Question editor. `q` = existing question from loadQuestions (or null). `locked` = quiz already has attempts. */
export function questionDialog({ quizId, q = null, position = 0, locked = false, onDone }) {
  const editing = !!q;
  const form = document.createElement('form'); form.noValidate = true;
  const type0 = q?.type ?? 'single';
  const rows = (q?.options ?? []).map((o) => ({ id: o.id, label: o.label, correct: (q.correct_ids ?? []).includes(o.id) }));
  const existing = rows.map((r) => r.id);
  form.innerHTML = html`<div class="grid grid-2"><div class="field"><label for="qq-type">Type</label><select class="select" id="qq-type" name="type" ${raw(locked ? 'disabled' : '')}>${raw(Object.entries(api.TYPES).map(([k, l]) => `<option value="${k}" ${k === type0 ? 'selected' : ''}>${l}</option>`).join(''))}</select></div>
      <div class="field"><label for="qq-pts">Points</label><input class="input" id="qq-pts" name="points" type="number" min="0" max="1000" step="0.5" value="${q?.points ?? 1}" ${raw(locked ? 'disabled' : '')}></div></div>
    ${raw(locked ? '<div class="alert" role="note" style="margin-bottom:var(--sp-3)">Students have already started this quiz, so only the wording can change.</div>' : '')}
    <div class="field"><label for="qq-prompt">Question</label><textarea class="textarea" id="qq-prompt" name="prompt" rows="3" maxlength="${api.LIMITS.prompt}">${q?.prompt ?? ''}</textarea></div>
    <div id="qq-choice"><div class="field-label" style="font-weight:560;margin-bottom:var(--sp-2)">Options <span class="text-muted text-sm" id="qq-hint"></span></div><div id="qq-rows"></div>
      ${raw(locked ? '' : '<button type="button" class="btn btn-ghost btn-sm" id="qq-add">+ Add option</button>')}</div>
    <div id="qq-text" class="field"><label for="qq-acc">Accepted answers</label><textarea class="textarea" id="qq-acc" name="accepted" rows="3" ${raw(locked ? 'disabled' : '')}>${(q?.accepted_text ?? []).join('\n')}</textarea>
      <span class="field-hint">One per line, capitals do not matter. Leave empty to grade this question yourself.</span></div>
    <div class="field"><label for="qq-exp">Explanation (optional)</label><textarea class="textarea" id="qq-exp" name="explanation" rows="2" maxlength="${api.LIMITS.explanation}">${q?.explanation ?? ''}</textarea><span class="field-hint">Shown to students after submitting, only if you turned on "show the correct answers".</span></div>`;
  const rowsEl = form.querySelector('#qq-rows');
  const typeNow = () => form.elements.type.value;
  const paint = () => {
    const t = typeNow(); form.querySelector('#qq-choice').hidden = t === 'short_text'; form.querySelector('#qq-text').hidden = t !== 'short_text';
    form.querySelector('#qq-hint').textContent = t === 'multiple' ? '(tick every correct option)' : '(choose the correct option)';
    const single = t !== 'multiple';
    rowsEl.innerHTML = rows.map((r, i) => `<div class="row" style="gap:var(--sp-2);margin-bottom:var(--sp-2);flex-wrap:nowrap" data-i="${i}">
      <input type="${single ? 'radio' : 'checkbox'}" name="corr" ${r.correct ? 'checked' : ''} ${locked ? 'disabled' : ''} aria-label="Correct option ${i + 1}">
      <input class="input" data-label maxlength="${api.LIMITS.option}" value="" aria-label="Option ${i + 1}" ${t === 'true_false' ? 'readonly' : ''}>
      ${locked || t === 'true_false' ? '' : `<button type="button" class="btn btn-ghost btn-sm" data-rm aria-label="Remove option ${i + 1}" style="color:var(--red-600)">&times;</button>`}</div>`).join('');
    rowsEl.querySelectorAll('[data-i]').forEach((el) => {
      const r = rows[+el.dataset.i]; const lab = el.querySelector('[data-label]'); lab.value = r.label;   // set via property: no HTML injection
      lab.addEventListener('input', () => { r.label = lab.value; });
      el.querySelector('[name=corr]').addEventListener('change', (e) => { if (single) rows.forEach((x) => { x.correct = false; }); r.correct = e.target.checked; paint(); });
      el.querySelector('[data-rm]')?.addEventListener('click', () => { rows.splice(+el.dataset.i, 1); paint(); });
    });
    const add = form.querySelector('#qq-add'); if (add) add.hidden = t === 'true_false' || rows.length >= api.LIMITS.options;
  };
  const onType = () => {
    const t = typeNow();
    if (t === 'true_false') { rows.length = 0; rows.push({ label: 'True', correct: false }, { label: 'False', correct: false }); }
    else if (t !== 'short_text' && rows.length < 2) { while (rows.length < 3) rows.push({ label: '', correct: false }); }
    if (t === 'single' || t === 'true_false') { const first = rows.findIndex((x) => x.correct); rows.forEach((x, i) => { x.correct = i === first; }); }
    paint();
  };
  if (!editing && type0 !== 'short_text') while (rows.length < 3) rows.push({ label: '', correct: false });
  form.elements.type.addEventListener('change', onType);
  form.querySelector('#qq-add')?.addEventListener('click', () => { rows.push({ label: '', correct: false }); paint(); rowsEl.querySelector('[data-i]:last-child [data-label]')?.focus(); });
  paint();
  const dlg = openModal({ title: editing ? 'Edit question' : 'Add question', body: form, actions: [{ label: 'Cancel', onClick: ({ close }) => close() },
    { label: editing ? 'Save question' : 'Add question', variant: 'primary', onClick: async ({ el }) => {
      clearErrors(form);
      const t = typeNow();
      const draft = { id: q?.id, type: t, prompt: form.elements.prompt.value, points: form.elements.points.value, explanation: form.elements.explanation.value,
        options: rows.map((r) => ({ id: r.id, label: r.label, correct: r.correct })), accepted: form.elements.accepted.value.split('\n').map((x) => x.trim()).filter(Boolean), existingOptionIds: existing };
      const err = api.validateQuestion(draft);
      if (err) { setFieldError(err.startsWith('Write') ? form.elements.prompt : err.startsWith('Points') ? form.elements.points : t === 'short_text' ? form.elements.accepted : rowsEl.firstElementChild?.querySelector('input.input') ?? form.elements.prompt, err); if (!form.querySelector('.field-error')) toastError(err); return; }
      await withBusy(el.querySelector('.modal-actions .btn-primary'), async () => {
        try { await api.saveQuestion(quizId, draft, { position, locked }); toastSuccess(editing ? 'Question saved' : 'Question added'); dlg.close(); onDone?.(); } catch (e) { toastError(e.message); }
      });
    } }] });
}

/** Renders a review (from get_attempt_review) into `box`. Staff get point inputs for text questions via onGrade(responseId, points, max). */
export function renderReview(box, review, { staff = false, onGrade } = {}) {
  const a = review.attempt, q = review.quiz, pct = api.percent(a.score ?? 0, a.max_score);
  box.innerHTML = html`<div class="card"><div class="row row-between"><div><div class="text-muted text-sm">Score</div><div style="font-size:var(--fs-xl);font-weight:650">${Number(a.score ?? 0)} / ${Number(a.max_score)} <span class="text-muted text-sm">(${pct}%)</span></div></div>
      <div>${raw(a.status === 'submitted' ? '<span class="badge badge-blue">Waiting for grade</span>' : pct >= Number(q.pass_percent) ? '<span class="badge badge-green">Passed</span>' : '<span class="badge badge-red">Not passed</span>')}</div></div></div>
    ${raw(review.questions.map((x, i) => html`<div class="card" data-q="${x.id}"><div class="row row-between" style="align-items:flex-start;gap:var(--sp-3)"><div style="min-width:0"><div class="text-muted text-sm">Question ${i + 1} · ${api.TYPES[x.type]}</div><p class="pre-wrap" style="margin:var(--sp-1) 0 var(--sp-3);font-weight:560">${x.prompt}</p></div>
        <div style="white-space:nowrap">${raw(x.is_correct === true ? '<span class="badge badge-green">Correct</span>' : x.is_correct === false ? (Number(x.points_awarded) > 0 ? '<span class="badge badge-orange">Partly</span>' : '<span class="badge badge-red">Wrong</span>') : '<span class="badge badge-blue">Not graded</span>')} <span class="text-sm">${Number(x.points_awarded ?? 0)} / ${Number(x.points)}</span></div></div>
      ${raw(x.type === 'short_text'
        ? html`<div class="text-muted text-sm">Answer</div><p class="pre-wrap" style="margin:0 0 var(--sp-2)">${x.text_answer || '(no answer)'}</p>${raw(x.accepted_text?.length ? html`<div class="text-muted text-sm">Accepted: ${x.accepted_text.join(', ')}</div>` : '')}`
        : `<div class="list">${x.options.map((o) => html`<div class="list-item" style="padding:var(--sp-2) 0"><span>${o.label}</span><span class="row" style="gap:var(--sp-2)">${raw(o.selected ? '<span class="badge badge-blue">Your pick</span>' : '')}${raw(o.correct === true ? '<span class="badge badge-green">Correct</span>' : '')}</span></div>`).join('')}</div>`)}
      ${raw(x.explanation ? html`<div class="alert" role="note" style="margin-top:var(--sp-3)"><strong>Explanation:</strong> <span class="pre-wrap">${x.explanation}</span></div>` : '')}
      ${raw(staff && x.response_id ? html`<form class="row" data-grade="${x.response_id}" style="margin-top:var(--sp-3);gap:var(--sp-2)"><label class="text-sm" for="g-${x.response_id}">Points</label><input class="input" id="g-${x.response_id}" style="width:90px;height:36px" inputmode="decimal" value="${x.is_correct === null ? '' : Number(x.points_awarded)}"><span class="text-muted text-sm">of ${Number(x.points)}</span><button class="btn btn-secondary btn-sm" type="submit">Save points</button></form>` : '')}</div>`).join(''))}`;
  box.querySelectorAll('[data-grade]').forEach((f) => f.addEventListener('submit', (e) => {
    e.preventDefault(); const x = review.questions.find((y) => y.response_id === f.dataset.grade);
    onGrade?.(f.dataset.grade, f.querySelector('input').value, x.points, f.querySelector('button'));
  }));
}
