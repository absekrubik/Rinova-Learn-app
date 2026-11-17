// Questions & answers box on the lesson page.
import { html, raw, timeAgo } from '../core/utils.js';
import { confirmDialog } from './modal.js';
import { toastSuccess, toastError } from './toast.js';
import { withBusy } from './form.js';
import * as api from '../services/lessonQuestions.js';

/**
 * el      container to fill
 * opts    { lesson, me, canManage, player }  player = { seek(sec), current() | null, canRead:boolean } or null (no video)
 */
export async function mountQA(el, { lesson, me, canManage, player = null, focusId = null }) {
  let rows;
  const draw = async () => {
    try { rows = await api.thread(lesson.id); } catch (e) { console.error(e); el.innerHTML = html`<div class="card"><h3 class="card-title">Questions</h3><p class="text-muted" style="margin:0">Could not load questions: ${e.message}</p></div>`; return; }
    paint();
  };
  const paint = () => {
    const qs = api.groupThread(rows), timed = qs.filter((q) => q.at_seconds != null).sort((a, b) => a.at_seconds - b.at_seconds);
    const hasVideo = lesson.type === 'video' && !!player;
    el.innerHTML = html`<div class="card qa" style="padding:var(--sp-4)">
      <div class="row row-between" style="margin-bottom:var(--sp-3)"><div><h3 style="margin:0">Questions</h3><div class="text-muted text-sm">${qs.length ? `${qs.length} question${qs.length === 1 ? '' : 's'}` : 'Ask anything about this lesson.'}${canManage ? '' : ' Your teacher and classmates can see and answer.'}</div></div></div>
      ${raw(timed.length && hasVideo ? html`<div class="qa-moments" aria-label="Moments with questions"><span class="text-muted text-sm">Jump to:</span>${raw(timed.map((q) => html`<button type="button" class="qa-time" data-seek="${q.at_seconds}" title="${q.body.slice(0, 80)}">${api.fmtTime(q.at_seconds)}</button>`).join(''))}</div>` : '')}
      <form id="qa-form" class="qa-form" novalidate>
        <label class="sr-only" for="qa-body" style="position:absolute;left:-9999px">Your question</label>
        <textarea class="textarea" id="qa-body" rows="2" maxlength="1000" placeholder="${canManage ? 'Post a note or question for students…' : 'Type your question…'}"></textarea>
        <div class="qa-form-row">${raw(hasVideo ? html`<label class="qa-at">At <input class="input" id="qa-at" inputmode="numeric" placeholder="m:ss" maxlength="8" aria-label="Moment of the video (minutes and seconds)"></label>${raw(player.canRead ? '<button type="button" class="btn btn-ghost btn-sm" id="qa-now">Use current time</button>' : '')}` : '<span></span>')}
          <button class="btn btn-primary" type="submit">${canManage ? 'Post' : 'Ask'}</button></div>
        <div class="field-error" id="qa-err" role="alert" hidden></div></form>
      <div class="qa-list" id="qa-list">${raw(qs.length ? qs.map(item).join('') : '')}</div></div>`;
    wire();
    if (focusId) { const t = el.querySelector(`[data-qid="${focusId}"]`); t?.scrollIntoView({ block: 'center' }); t?.classList.add('qa-focus'); focusId = null; }
  };
  const mine = (r) => r.mine || r.author_id === me.id;
  const who = (r) => html`<strong>${mine(r) ? 'You' : r.author_name}</strong>${raw(r.author_is_staff ? ' <span class="badge badge-blue">Teacher</span>' : '')}`;
  const item = (q) => html`<article class="qa-item${q.is_resolved ? ' qa-done' : ''}" data-qid="${q.id}">
    <div class="qa-head">${raw(q.at_seconds != null && lesson.type === 'video' ? html`<button type="button" class="qa-time" data-seek="${q.at_seconds}" ${raw(player ? '' : 'disabled')}>&#9654; ${api.fmtTime(q.at_seconds)}</button>` : '')}
      ${raw(who(q))}<span class="text-muted text-sm">${timeAgo(q.created_at)}</span>${raw(q.is_pinned ? '<span class="badge badge-orange">Pinned</span>' : '')}${raw(q.is_resolved ? '<span class="badge badge-green">Answered</span>' : '')}</div>
    <p class="pre-wrap qa-body">${q.body}</p>
    ${raw(q.replies.map((r) => html`<div class="qa-reply" data-qid="${r.id}"><div class="qa-head">${raw(who(r))}<span class="text-muted text-sm">${timeAgo(r.created_at)}</span>${raw(mine(r) || canManage ? `<button type="button" class="qa-link qa-danger" data-del="${r.id}">Delete</button>` : '')}</div><p class="pre-wrap qa-body">${r.body}</p></div>`).join(''))}
    <div class="qa-actions"><button type="button" class="qa-link" data-reply="${q.id}">Reply</button>
      ${raw(canManage ? `<button type="button" class="qa-link" data-pin="${q.id}" data-on="${!q.is_pinned}">${q.is_pinned ? 'Unpin' : 'Pin'}</button>` : '')}
      ${raw(canManage || mine(q) ? `<button type="button" class="qa-link" data-resolve="${q.id}" data-on="${!q.is_resolved}">${q.is_resolved ? 'Reopen' : 'Mark answered'}</button>` : '')}
      ${raw(canManage || mine(q) ? `<button type="button" class="qa-link qa-danger" data-del="${q.id}">Delete</button>` : '')}</div>
    <form class="qa-reply-form" data-form="${q.id}" hidden novalidate><textarea class="textarea" rows="2" maxlength="1000" aria-label="Your reply" placeholder="Write a reply…"></textarea><div class="qa-form-row"><span></span><button class="btn btn-primary btn-sm" type="submit">Send reply</button></div><div class="field-error" role="alert" hidden></div></form></article>`;

  const wire = () => {
    el.querySelectorAll('[data-seek]').forEach((b) => b.addEventListener('click', () => player?.seek(Number(b.dataset.seek))));
    const form = el.querySelector('#qa-form'), err = el.querySelector('#qa-err');
    el.querySelector('#qa-now')?.addEventListener('click', () => { const t = player?.current?.(); if (t != null) form.querySelector('#qa-at').value = api.fmtTime(t); });
    form.addEventListener('submit', async (e) => {
      e.preventDefault(); err.hidden = true;
      const body = form.querySelector('#qa-body').value, at = api.parseTime(form.querySelector('#qa-at')?.value);
      const msg = api.validateBody(body) ?? at.error; if (msg) { err.textContent = msg; err.hidden = false; return; }
      await withBusy(form.querySelector('[type=submit]'), async () => { try { await api.ask(lesson.id, body, at.value ?? null); toastSuccess(canManage ? 'Posted' : 'Question sent'); await draw(); } catch (ex) { err.textContent = ex.message; err.hidden = false; } });
    });
    el.querySelectorAll('[data-reply]').forEach((b) => b.addEventListener('click', () => { const f = el.querySelector(`[data-form="${b.dataset.reply}"]`); f.hidden = !f.hidden; if (!f.hidden) f.querySelector('textarea').focus(); }));
    el.querySelectorAll('.qa-reply-form').forEach((f) => f.addEventListener('submit', async (e) => {
      e.preventDefault(); const er = f.querySelector('.field-error'); er.hidden = true;
      const body = f.querySelector('textarea').value, msg = api.validateBody(body); if (msg) { er.textContent = msg; er.hidden = false; return; }
      await withBusy(f.querySelector('[type=submit]'), async () => { try { await api.reply(lesson.id, f.dataset.form, body); toastSuccess('Reply sent'); await draw(); } catch (ex) { er.textContent = ex.message; er.hidden = false; } });
    }));
    el.querySelectorAll('[data-pin]').forEach((b) => b.addEventListener('click', async () => { try { await api.setPinned(b.dataset.pin, b.dataset.on === 'true'); await draw(); } catch (ex) { toastError(ex.message); } }));
    el.querySelectorAll('[data-resolve]').forEach((b) => b.addEventListener('click', async () => { try { await api.setResolved(b.dataset.resolve, b.dataset.on === 'true'); await draw(); } catch (ex) { toastError(ex.message); } }));
    el.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
      if (!await confirmDialog('Delete this post?', 'If it is a question, its replies are deleted too.', { confirmLabel: 'Delete', danger: true })) return;
      try { await api.remove(b.dataset.del); toastSuccess('Deleted'); await draw(); } catch (ex) { toastError(ex.message); }
    }));
  };
  await draw();
}
