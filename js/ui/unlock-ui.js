// Unlock rules UI: the teacher's rule editor, and what a student sees for a locked lesson.
import { html, raw, url } from '../core/utils.js';
import { openModal } from './modal.js';
import { toastError, toastSuccess } from './toast.js';
import { withBusy } from './form.js';
import { emptyState } from './states.js';
import * as api from '../services/unlock.js';
import * as quizApi from '../services/quizzes.js';
import * as asgApi from '../services/assignments.js';

export const lockIcon = () => '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-2px"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>';
const PAGE = { lesson: 'lesson', quiz: 'quiz', assignment: 'assignment' };

/** Student: the list of things to do first. Each item shows whether it is done and links to it. */
export function requirementList(reqs, role) {
  return `<ul class="list" style="margin:0;padding:0;list-style:none">${reqs.map((r) => html`<li class="list-item"><div class="row" style="gap:var(--sp-3);flex-wrap:nowrap;min-width:0">
    <span class="check ${r.met ? 'check-done' : ''}" aria-label="${r.met ? 'Done' : 'Not done yet'}">${raw(r.met ? '&#10003;' : '')}</span>
    <span style="overflow-wrap:anywhere">${api.requirementText(r)}</span></div>
    ${raw(r.id && r.title && !r.met ? `<a class="btn btn-secondary btn-sm" href="${url(`${role}/${PAGE[r.type]}.html`)}?id=${encodeURIComponent(r.id)}">Open</a>` : '')}</li>`.toString()).join('')}</ul>`;
}

/** Student opened a lesson that is locked: explain what to do first. */
export function renderGate(box, gate, { role }) {
  box.innerHTML = html`<a class="text-sm" href="${url(`${role}/course.html`)}?id=${gate.course_id}&amp;tab=content">&larr; Back to the course</a>
    <div class="card" style="margin-top:var(--sp-4);padding:var(--sp-5, 24px);max-width:640px">
      <div class="row" style="gap:var(--sp-2)">${raw(lockIcon())}<span class="badge">Locked</span></div>
      <h1 style="margin:var(--sp-2) 0">${gate.title}</h1>
      <p class="text-muted">This lesson opens when you have done the following. It unlocks by itself as soon as you have.</p>
      ${raw(requirementList(gate.requirements ?? [], role))}</div>`;
}

/** Teacher: rules for one lesson. `mods` is the curriculum (for the lesson choices). */
export async function rulesDialog({ course, mods, lesson, onDone }) {
  let rules, quizzes, assignments;
  try {
    [rules, quizzes, assignments] = await Promise.all([api.listRules(course.id), quizApi.listQuizzes({ courseId: course.id }), asgApi.listAssignments({ courseId: course.id })]);
  } catch (e) { return toastError(e.message); }
  const lessons = mods.flatMap((m) => m.lessons.map((l) => ({ ...l, module: m.title }))).filter((l) => l.id !== lesson.id);
  const pool = { lesson: lessons, quiz: quizzes, assignment: assignments };
  const mine = () => rules.filter((r) => r.lesson_id === lesson.id);
  const body = document.createElement('div');
  body.innerHTML = html`<p class="text-sm" style="margin-top:0">A student can open this lesson only when <strong>every</strong> rule below is met. You and other teachers always see every lesson.</p>
    <div id="ur-list"></div>
    <h4 style="margin:var(--sp-4) 0 var(--sp-2)">Add a rule</h4>
    <div class="field"><label for="ur-type">The student must</label><select class="select" id="ur-type">${raw(Object.entries(api.TYPES).map(([k, v]) => `<option value="${k}">${v}</option>`).join(''))}</select></div>
    <div class="field"><label for="ur-item">Which one</label><select class="select" id="ur-item"></select></div>
    <div class="field" id="ur-minbox" hidden><label for="ur-min">Minimum score % (optional)</label><input class="input" id="ur-min" type="number" min="0" max="100" step="1" placeholder="Leave empty to use the quiz pass mark"></div>
    <div class="field-error" id="ur-err" role="alert" style="color:var(--red-600)"></div>
    <button class="btn btn-secondary" type="button" id="ur-add">Add rule</button>`;
  const $ = (s) => body.querySelector(s);
  const drawList = () => {
    const list = mine();
    $('#ur-list').innerHTML = list.length ? `<div class="list">${list.map((r) => {
      const item = pool[r.req_type].find((x) => x.id === r.req_id);
      const text = api.requirementText({ type: r.req_type, title: item?.title, min_percent: r.min_percent, pass_percent: item?.pass_percent });
      return html`<div class="list-item"><span style="overflow-wrap:anywhere">${text}</span><button class="btn btn-ghost btn-sm" data-rm="${r.id}" style="color:var(--red-600)" aria-label="Remove rule: ${text}">Remove</button></div>`.toString();
    }).join('')}</div>` : emptyState('No rules', 'This lesson is open to every student.');
  };
  const drawItems = () => {
    const t = $('#ur-type').value, items = pool[t];
    $('#ur-minbox').hidden = t !== 'quiz';
    $('#ur-item').innerHTML = items.length ? items.map((x) => html`<option value="${x.id}">${x.title}${raw(t === 'lesson' && x.module ? ` (${html`${x.module}`})` : '')}</option>`.toString()).join('') : '<option value="">Nothing to choose yet</option>';
  };
  $('#ur-type').addEventListener('change', drawItems);
  body.addEventListener('click', async (e) => {
    const rm = e.target.closest('[data-rm]');
    if (rm) { try { await api.removeRule(rm.dataset.rm); rules = rules.filter((r) => r.id !== rm.dataset.rm); drawList(); toastSuccess('Rule removed'); } catch (err) { toastError(err.message); } }
  });
  $('#ur-add').addEventListener('click', (e) => withBusy(e.currentTarget, async () => {
    const type = $('#ur-type').value, reqId = $('#ur-item').value, raw_min = $('#ur-min').value.trim(), minPercent = type === 'quiz' && raw_min !== '' ? Number(raw_min) : null;
    const bad = api.validateRule({ type, reqId, minPercent }, mine().length); $('#ur-err').textContent = bad; if (bad) return;
    try { await api.addRule({ lessonId: lesson.id, type, reqId, minPercent }); rules = await api.listRules(course.id); drawList(); $('#ur-min').value = ''; toastSuccess('Rule added'); }
    catch (err) { $('#ur-err').textContent = err.message || 'Could not add the rule.'; }
  }));
  drawList(); drawItems();
  openModal({ title: `Unlock rules: ${lesson.title}`, body, onClose: onDone, actions: [{ label: 'Done', variant: 'primary', onClick: ({ close }) => close() }] });
}
