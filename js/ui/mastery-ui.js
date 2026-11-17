// Mastery UI pieces shared by the student pages and the teacher's Topics tab.
import { html, raw, url } from '../core/utils.js';
import { LEVELS, MAX_TAGS, pct } from '../services/mastery.js';
import { toastError } from './toast.js';

export const levelBadge = (level) => raw(`<span class="badge ${LEVELS[level]?.badge ?? ''}">${LEVELS[level]?.label ?? ''}</span>`);

/** One bar. Untested topics show an empty track so they are never mistaken for 0%. */
export const masteryBar = (percent, level) => raw(`<div class="mbar" role="img" aria-label="${percent == null ? 'Not tested yet' : `${Math.round(percent)} percent`}"><span class="mbar-${level}" style="width:${percent == null ? 0 : Math.max(3, Math.min(100, Number(percent)))}%"></span></div>`);

const lessonLink = (role, l) => (l.locked
  ? html`<span class="mlesson mlesson-locked" title="Locked: finish the earlier steps first">&#128274; ${l.title}</span>`
  : html`<a class="mlesson${l.completed ? ' mlesson-done' : ''}" href="${url(`${role}/lesson.html`)}?id=${l.id}">${raw(l.completed ? '&#10003; ' : '')}${l.title}</a>`);

/** A student's topic cards. `rows` come from my_mastery(). */
export function masteryCards(rows, { role = 'student' } = {}) {
  return html`<div class="mgrid">${rows.map((r) => raw(html`<div class="card mcard mcard-${r.level}">
    <div class="row row-between" style="align-items:flex-start;gap:var(--sp-2)"><h3 class="mcard-title">${r.topic}</h3>${levelBadge(r.level)}</div>
    <div class="mcard-pct">${pct(r.percent)}</div>${masteryBar(r.percent, r.level)}
    <div class="text-muted text-sm">${r.questions ? `${r.questions} question${r.questions === 1 ? '' : 's'} answered` : 'Take a quiz on this topic to see your level'}${r.lessons_total ? ` · ${r.lessons_done} of ${r.lessons_total} lesson${r.lessons_total === 1 ? '' : 's'} done` : ''}</div>
    ${raw(r.lessons?.length && (r.level === 'weak' || r.level === 'ok' || r.level === 'untested') ? html`<div class="mrev"><div class="text-sm" style="font-weight:600">${r.level === 'weak' ? 'Revise these lessons' : 'Lessons on this topic'}</div>${raw(r.lessons.map((l) => lessonLink(role, l)).join(''))}</div>` : '')}
  </div>`))}</div>`;
}

/**
 * Topic chips a teacher can switch on and off (max 3 per item). `onChange(topicId, on)` must return a promise;
 * on failure the chip goes back and an error is shown.
 */
export function tagPicker(el, topics, selected, onChange) {
  const draw = () => {
    const full = selected.size >= MAX_TAGS;
    el.innerHTML = topics.length ? topics.map((t) => html`<button type="button" class="tag-chip" data-topic="${t.id}" aria-pressed="${selected.has(t.id)}" ${raw(full && !selected.has(t.id) ? 'disabled title="At most 3 topics"' : '')}>${t.name}</button>`).join('') : '<span class="text-muted text-sm">Add topics first.</span>';
  };
  draw();
  el.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-topic]'); if (!b || b.disabled) return;
    const id = b.dataset.topic, on = !selected.has(id);
    on ? selected.add(id) : selected.delete(id); draw();
    try { await onChange(id, on); } catch (err) { on ? selected.delete(id) : selected.add(id); draw(); toastError(err.message ?? 'Could not save'); }
  });
  return { redraw: draw };
}
