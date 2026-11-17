// The live class "pulse" and quick polls, shown on the live class page while the class is on.
import { html, raw } from '../core/utils.js';
import { openModal, confirmDialog } from './modal.js';
import { toastSuccess, toastError } from './toast.js';
import { withBusy } from './form.js';
import * as api from '../services/pulse.js';
import { canJoinNow } from '../services/live.js';

const SHOWN_POLLS = 5;

/** Starts the box. Returns { stop() }. `cls` is the live class row. */
export function mountPulse(el, { cls, canManage }) {
  let timer = null, last = '', stopped = false;
  const open = () => canJoinNow(cls);

  const bars = (res, mine, clickable, pollId) => res.map((r) => {
    const pctv = r.total ? Math.round(100 * r.votes / r.total) : 0;
    const inner = html`<span class="pbar" style="width:${pctv}%"></span><span class="pbar-label">${mine === r.option_idx ? '✓ ' : ''}${r.label}</span><span class="pbar-num">${r.votes} · ${pctv}%</span>`;
    return clickable ? `<button type="button" class="popt${mine === r.option_idx ? ' popt-mine' : ''}" data-vote="${pollId}" data-idx="${r.option_idx}">${inner}</button>` : `<div class="popt popt-static${mine === r.option_idx ? ' popt-mine' : ''}">${inner}</div>`;
  }).join('');

  async function snapshot() {
    const polls = (await api.listPolls(cls.id)).slice(0, SHOWN_POLLS);
    const votes = canManage ? new Map() : await api.myVotes(polls.map((p) => p.id));
    const items = [];
    for (const p of polls) {
      const showResults = canManage || p.status === 'closed' || votes.has(p.id);
      items.push({ p, mine: votes.get(p.id) ?? null, res: showResults ? await api.pollResults(p.id) : null });
    }
    if (canManage) return { sum: await api.pulseSummary(cls.id), items };
    return { mine: await api.myPulse(cls.id), items };
  }

  function paint(s) {
    const pollHtml = s.items.length ? s.items.map(({ p, mine, res }) => html`<div class="poll" data-poll="${p.id}">
      <div class="row row-between" style="gap:var(--sp-2);align-items:flex-start"><strong style="overflow-wrap:anywhere">${p.question}</strong>
        <span class="row" style="gap:var(--sp-1);flex:none">${raw(p.status === 'open' ? '<span class="badge badge-green">Open</span>' : '<span class="badge">Closed</span>')}
          ${raw(canManage ? `${p.status === 'open' ? `<button class="btn btn-ghost btn-sm" data-close="${p.id}">Close</button>` : ''}<button class="btn btn-ghost btn-sm qa-danger" data-delpoll="${p.id}" aria-label="Delete poll">Delete</button>` : '')}</span></div>
      <div class="popts">${raw(res ? bars(res, mine, !canManage && p.status === 'open', p.id) : p.options.map((o, i) => html`<button type="button" class="popt" data-vote="${p.id}" data-idx="${i}"><span class="pbar-label">${o}</span></button>`).join(''))}</div>
      ${raw(!canManage && p.status === 'open' && mine == null ? '<div class="text-muted text-sm">Your answer is anonymous. You see the totals after you answer.</div>' : '')}</div>`.toString()).join('') : '';

    if (canManage) {
      const { sum } = s, answered = sum.got_it + sum.lost, w = (n) => (sum.enrolled ? Math.round(100 * n / sum.enrolled) : 0);
      el.innerHTML = html`<div class="card pulse"><div class="row row-between" style="margin-bottom:var(--sp-3)"><div><h3 style="margin:0">Class pulse</h3><div class="text-muted text-sm">Anonymous. Students tap during the class; a tap counts for 5 minutes. Updates every few seconds.</div></div><button class="btn btn-secondary btn-sm" id="newpoll">Start a poll</button></div>
        <div class="pulse-nums"><div class="pulse-num pulse-ok"><strong>${sum.got_it}</strong><span>Got it</span></div><div class="pulse-num pulse-lost"><strong>${sum.lost}</strong><span>I'm lost</span></div><div class="pulse-num"><strong>${Math.max(0, sum.enrolled - answered)}</strong><span>No signal</span></div></div>
        <div class="pulse-track" role="img" aria-label="${sum.got_it} got it, ${sum.lost} lost, out of ${sum.enrolled} students"><span class="pulse-seg-ok" style="width:${w(sum.got_it)}%"></span><span class="pulse-seg-lost" style="width:${w(sum.lost)}%"></span></div>
        ${raw(sum.lost && sum.enrolled && sum.lost / sum.enrolled >= 0.3 ? '<div class="alert alert-warning" style="margin-top:var(--sp-3)">Many students feel lost. It may be a good moment to slow down or recap.</div>' : '')}
        ${raw(pollHtml ? `<div class="polls">${pollHtml}</div>` : '')}</div>`;
    } else {
      el.innerHTML = html`<div class="card pulse"><h3 style="margin:0 0 var(--sp-1)">How are you following?</h3><div class="text-muted text-sm" style="margin-bottom:var(--sp-3)">Tap anytime. Your teacher only sees how many students feel each way, never who.</div>
        <div class="pulse-btns"><button class="pulse-btn pulse-btn-ok" data-pulse="got_it" aria-pressed="${s.mine?.state === 'got_it'}">&#10003; Got it</button><button class="pulse-btn pulse-btn-lost" data-pulse="lost" aria-pressed="${s.mine?.state === 'lost'}">? I'm lost</button></div>
        ${raw(s.mine ? '<button class="qa-link" data-pulse-clear style="margin-top:var(--sp-2)">Clear my answer</button>' : '')}
        ${raw(pollHtml ? `<div class="polls">${pollHtml}</div>` : '')}</div>`;
    }
  }

  async function tick(force = false) {
    if (stopped) return;
    if (!open()) { el.innerHTML = ''; return; }
    if (document.hidden && !force) return;
    try {
      const s = await snapshot(), key = JSON.stringify(s);
      if (key !== last) { last = key; paint(s); }
    } catch (e) { console.warn('pulse', e); }
  }

  el.addEventListener('click', async (e) => {
    const t = e.target.closest('button'); if (!t) return;
    try {
      if (t.dataset.pulse) { await api.sendPulse(cls.id, t.dataset.pulse); toastSuccess(t.dataset.pulse === 'lost' ? 'Your teacher will see that some students are lost' : 'Thanks, noted'); await tick(true); }
      else if ('pulseClear' in t.dataset) { await api.clearPulse(cls.id); await tick(true); }
      else if (t.dataset.vote) { await api.vote(t.dataset.vote, Number(t.dataset.idx)); await tick(true); }
      else if (t.dataset.close) { await api.setPollStatus(t.dataset.close, 'closed'); toastSuccess('Poll closed'); await tick(true); }
      else if (t.dataset.delpoll) { if (await confirmDialog('Delete this poll?', 'Its votes are deleted too.', { confirmLabel: 'Delete poll', danger: true })) { await api.deletePoll(t.dataset.delpoll); await tick(true); } }
      else if (t.id === 'newpoll') pollDialog(cls.id, () => tick(true));
    } catch (err) { toastError(err.message ?? 'Something went wrong'); }
  });

  tick(true); timer = setInterval(() => tick(), api.REFRESH_MS);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(true); });
  return { stop() { stopped = true; clearInterval(timer); } };
}

function pollDialog(classId, onDone) {
  const form = document.createElement('form'); form.noValidate = true;
  const optRow = (v = '') => html`<div class="row" style="gap:var(--sp-2);margin-bottom:var(--sp-2)"><input class="input" name="opt" maxlength="80" placeholder="Answer" aria-label="Answer" value="${v}"><button type="button" class="btn btn-ghost btn-sm" data-rm aria-label="Remove answer">&times;</button></div>`;
  form.innerHTML = html`<div class="field"><label for="pl-q">Question</label><input class="input" id="pl-q" name="q" maxlength="200" placeholder="Which method did you use?"></div>
    <div class="field"><label>Answers (2 to 6)</label><div id="pl-opts">${raw(optRow() + optRow())}</div><button type="button" class="btn btn-secondary btn-sm" id="pl-add">+ Add answer</button></div><div class="field-error" id="pl-err" role="alert" hidden></div>`;
  const box = form.querySelector('#pl-opts'), err = form.querySelector('#pl-err');
  form.querySelector('#pl-add').addEventListener('click', () => { if (box.children.length >= api.MAX_OPTIONS) return; box.insertAdjacentHTML('beforeend', optRow()); box.lastElementChild.querySelector('input').focus(); });
  box.addEventListener('click', (e) => { if (e.target.closest('[data-rm]') && box.children.length > api.MIN_OPTIONS) e.target.closest('.row').remove(); });
  const dlg = openModal({ title: 'Start a poll', body: form, actions: [{ label: 'Cancel', onClick: ({ close }) => close() },
    { label: 'Start poll', variant: 'primary', onClick: async ({ el }) => {
      err.hidden = true; const q = form.elements.q.value, opts = [...form.querySelectorAll('[name=opt]')].map((i) => i.value), msg = api.validatePoll(q, opts);
      if (msg) { err.textContent = msg; err.hidden = false; return; }
      await withBusy(el.querySelector('.modal-actions .btn-primary'), async () => { try { await api.createPoll(classId, q, opts); toastSuccess('Poll started'); dlg.close(); onDone?.(); } catch (e) { err.textContent = e.message; err.hidden = false; } });
    } }] });
}
