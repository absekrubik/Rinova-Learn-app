// "Topics" tab of a course (staff): class mastery, topic list, and tagging of lessons and quiz questions.
import { html, raw } from '../core/utils.js';
import { openModal, confirmDialog } from '../ui/modal.js';
import { toastSuccess, toastError } from '../ui/toast.js';
import { withBusy } from '../ui/form.js';
import { emptyState, errorState, skeletonRows } from '../ui/states.js';
import * as api from '../services/mastery.js';
import * as content from '../services/content.js';
import * as quizzes from '../services/quizzes.js';
import { tagPicker, levelBadge, masteryBar } from '../ui/mastery-ui.js';

export async function renderTopics(pane, { course }) {
  pane.innerHTML = skeletonRows(4);
  let topics, cls, curriculum, tags, quizList;
  try {
    [topics, cls, curriculum, tags, quizList] = await Promise.all([api.listTopics(course.id), api.classMastery(course.id), content.loadCurriculum(course.id), api.lessonTags(course.id), quizzes.listQuizzes({ courseId: course.id })]);
  } catch (e) { console.error(e); pane.innerHTML = errorState(e.message); return; }
  const refresh = () => renderTopics(pane, { course });
  const lessons = curriculum.flatMap((m) => m.lessons.map((l) => ({ ...l, module: m.title })));

  const classRow = (r) => html`<tr><td data-label="Topic"><strong>${r.topic}</strong></td>
    <td data-label="Covered in">${r.lessons_total} lesson${r.lessons_total === 1 ? '' : 's'} · ${r.questions_tagged} question${r.questions_tagged === 1 ? '' : 's'}</td>
    <td data-label="Tested">${r.students_tested} of ${r.enrolled}</td>
    <td data-label="Class average">${r.avg_percent == null ? html`<span class="text-muted">–</span>` : raw(html`<div style="min-width:120px">${api.pct(r.avg_percent)} ${levelBadge(api.levelOf(r.avg_percent))}${masteryBar(r.avg_percent, api.levelOf(r.avg_percent))}</div>`)}</td>
    <td data-label="Struggling">${r.weak_students ? raw(`<span class="badge badge-orange">${r.weak_students} student${r.weak_students === 1 ? '' : 's'}</span>`) : '<span class="text-muted">–</span>'}</td>
    <td><button class="btn btn-ghost btn-sm" data-who="${r.topic_id}" data-name="${r.topic.replace(/"/g, '&quot;')}">Who?</button></td></tr>`;

  pane.innerHTML = html`<div class="stack">
    <div class="card" style="padding:var(--sp-4)"><div class="row row-between" style="margin-bottom:var(--sp-3)"><div><h3 style="margin:0">Class mastery</h3><div class="text-muted text-sm">How the class is doing in each topic, from quiz results. Only questions you tag below count.</div></div></div>
      ${raw(cls.length ? `<div class="table-wrap"><table class="table mtable"><thead><tr><th>Topic</th><th>Covered in</th><th>Tested</th><th>Class average</th><th>Struggling</th><th></th></tr></thead><tbody>${cls.map(classRow).join('')}</tbody></table></div>` : emptyState('No topics yet', 'Add your first topic below, for example "Fractions".'))}</div>

    <div class="card" style="padding:var(--sp-4)"><h3 style="margin:0 0 var(--sp-1)">Topics</h3><div class="text-muted text-sm" style="margin-bottom:var(--sp-3)">Short names for what a course teaches. Up to 40 per course.</div>
      <form id="addtopic" class="row" style="gap:var(--sp-2);margin-bottom:var(--sp-3)" novalidate><label class="sr-only" for="tname" style="position:absolute;left:-9999px">Topic name</label><input class="input" id="tname" maxlength="60" placeholder="New topic, e.g. Fractions" style="max-width:320px"><button class="btn btn-primary" type="submit">Add topic</button></form>
      <div id="terr" class="field-error" role="alert" hidden></div>
      <div class="tag-row">${raw(topics.length ? topics.map((t) => html`<span class="tag-chip tag-static">${t.name}<button type="button" class="tag-x" data-deltopic="${t.id}" data-name="${t.name}" aria-label="Delete topic ${t.name}">&times;</button></span>`).join('') : '<span class="text-muted text-sm">No topics yet.</span>')}</div></div>

    <div class="card" style="padding:var(--sp-4)"><h3 style="margin:0 0 var(--sp-1)">Tag lessons</h3><div class="text-muted text-sm" style="margin-bottom:var(--sp-3)">Pick up to 3 topics for each lesson. Students are sent to these lessons to revise weak topics.</div>
      ${raw(lessons.length ? `<div class="list">${lessons.map((l) => `<div class="tagrow"><div class="tagrow-name"><span>${html`${l.title}`}</span>${l.is_published ? '' : ' <span class="badge badge-orange">Draft</span>'}<div class="text-muted text-sm">${html`${l.module}`}</div></div><div class="tag-row" data-lesson-tags="${l.id}"></div></div>`).join('')}</div>` : emptyState('No lessons yet', 'Add lessons in the Content tab first.'))}</div>

    <div class="card" style="padding:var(--sp-4)"><h3 style="margin:0 0 var(--sp-1)">Tag quiz questions</h3><div class="text-muted text-sm" style="margin-bottom:var(--sp-3)">Each question counts towards the topics you pick. Untagged questions are ignored here.</div>
      ${raw(quizList.length ? html`<div class="field" style="max-width:420px"><label for="qsel">Quiz</label><select class="select" id="qsel">${raw(quizList.map((q) => html`<option value="${q.id}">${q.title}</option>`).join(''))}</select></div><div id="qlist"></div>` : emptyState('No quizzes yet', 'Create a quiz in the Quizzes tab first.'))}</div></div>`;

  // add / delete topics
  const form = pane.querySelector('#addtopic'), terr = pane.querySelector('#terr');
  form.addEventListener('submit', async (e) => {
    e.preventDefault(); terr.hidden = true;
    const name = form.querySelector('#tname').value, msg = api.validateTopicName(name, topics.map((t) => t.name));
    if (msg) { terr.textContent = msg; terr.hidden = false; return; }
    if (topics.length >= api.MAX_TOPICS) { terr.textContent = `A course can have at most ${api.MAX_TOPICS} topics`; terr.hidden = false; return; }
    await withBusy(form.querySelector('button'), async () => { try { await api.addTopic(course.id, name); toastSuccess('Topic added'); refresh(); } catch (err) { terr.textContent = err.message; terr.hidden = false; } });
  });
  pane.querySelectorAll('[data-deltopic]').forEach((b) => b.addEventListener('click', async () => {
    if (!await confirmDialog('Delete this topic?', `"${b.dataset.name}" will be removed from every lesson and question. The lessons and questions themselves stay.`, { confirmLabel: 'Delete topic', danger: true })) return;
    try { await api.deleteTopic(b.dataset.deltopic); toastSuccess('Topic deleted'); refresh(); } catch (err) { toastError(err.message); }
  }));
  pane.querySelectorAll('[data-who]').forEach((b) => b.addEventListener('click', () => whoDialog(course.id, b.dataset.who, b.dataset.name)));

  // lesson tags
  pane.querySelectorAll('[data-lesson-tags]').forEach((el) => {
    const lid = el.dataset.lessonTags; if (!tags.has(lid)) tags.set(lid, new Set());
    tagPicker(el, topics, tags.get(lid), (tid, on) => api.setLessonTag(lid, tid, on));
  });

  // question tags (loaded per quiz)
  const sel = pane.querySelector('#qsel');
  if (sel) {
    const qtags = await api.questionTags(course.id).catch(() => new Map());
    const draw = async () => {
      const box = pane.querySelector('#qlist'); box.innerHTML = skeletonRows(2);
      try {
        const qs = await quizzes.loadQuestions(sel.value);
        box.innerHTML = qs.length ? `<div class="list">${qs.map((q, i) => `<div class="tagrow"><div class="tagrow-name"><span>${i + 1}. ${html`${q.prompt.length > 110 ? q.prompt.slice(0, 110) + '…' : q.prompt}`}</span><div class="text-muted text-sm">${html`${quizzes.TYPES[q.type] ?? q.type}`} · ${q.points} point${q.points === 1 ? '' : 's'}</div></div><div class="tag-row" data-q-tags="${q.id}"></div></div>`).join('')}</div>` : emptyState('No questions in this quiz', 'Add questions on the quiz page.');
        box.querySelectorAll('[data-q-tags]').forEach((el) => { const id = el.dataset.qTags; if (!qtags.has(id)) qtags.set(id, new Set()); tagPicker(el, topics, qtags.get(id), (tid, on) => api.setQuestionTag(id, tid, on)); });
      } catch (e) { box.innerHTML = errorState(e.message); }
    };
    sel.addEventListener('change', draw); draw();
  }
}

async function whoDialog(courseId, topicId, name) {
  const body = document.createElement('div'); body.innerHTML = skeletonRows(3);
  const dlg = openModal({ title: `Who is finding "${name}" hard?`, body, actions: [{ label: 'Close', onClick: ({ close }) => close() }] });
  try {
    const rows = await api.topicStudents(courseId, topicId);
    body.innerHTML = rows.length ? html`<div class="list">${rows.map((r) => raw(html`<div class="list-item"><div style="min-width:0"><strong>${r.full_name}</strong><div class="meta">${r.email}</div></div><div class="row" style="gap:var(--sp-2)">${raw(r.percent == null ? '<span class="text-muted text-sm">Not tested</span>' : `<span>${api.pct(r.percent)}</span>`)}${levelBadge(r.level)}</div></div>`))}</div>` : '<p class="text-muted">No students are enrolled yet.</p>';
  } catch (e) { body.innerHTML = errorState(e.message); }
  return dlg;
}
