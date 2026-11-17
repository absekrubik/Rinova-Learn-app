// "Study plan" for students: a 7-day plan from deadlines, weak topics and the next lesson in each course.
import { mountShell } from '../ui/shell.js';
import { html, raw, url } from '../core/utils.js';
import { emptyState, errorState, skeletonRows } from '../ui/states.js';
import * as api from '../services/studyPlan.js';

const { me, content } = await mountShell({ roles: ['student'], active: 'student/study-plan.html', title: 'Study plan' });
const KEY_MIN = 'rl-plan-minutes', KEY_DONE = `rl-plan-done:${me.id}`;
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode: the plan still works, ticks just are not remembered */ } },
};
let minutes = api.MINUTES_CHOICES.includes(store.get(KEY_MIN, api.DEFAULT_MINUTES)) ? store.get(KEY_MIN, api.DEFAULT_MINUTES) : api.DEFAULT_MINUTES;
const done = new Set(store.get(KEY_DONE, []));
let inputs = null;

content.innerHTML = html`<div class="page-head"><div><h1>Study plan</h1><p>A suggested week, built from what is due, the topics you find hardest and the next lesson in each course. It updates itself as you finish things.</p></div></div>
  <div class="row" style="gap:var(--sp-3);margin-bottom:var(--sp-4);flex-wrap:wrap"><div class="field" style="margin:0"><label for="mins" class="text-sm">Time I can study per day</label>
    <select class="select" id="mins">${raw(api.MINUTES_CHOICES.map((m) => `<option value="${m}">${m >= 60 ? `${m / 60} hour${m > 60 ? 's' : ''}` : `${m} minutes`}</option>`).join(''))}</select></div></div>
  <div id="sum"></div><div id="plan">${raw(skeletonRows(4))}</div>`;
const $ = (s) => content.querySelector(s);
$('#mins').value = String(minutes);

const fmtDay = (d, i) => (i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : d.toLocaleDateString(undefined, { weekday: 'long' })) ;
const fmtDate = (d) => d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
const fmtDue = (d) => d.toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
const fmtMin = (m) => (m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}` : `${m} min`);

function draw() {
  const plan = api.buildPlan(inputs.tasks, inputs.events, { minutesPerDay: minutes });
  const left = plan.days.flatMap((d) => d.tasks).filter((t) => !done.has(t.id));
  $('#sum').innerHTML = html`<div class="summary-chips"><span><strong>${left.length}</strong> to do this week</span><span><strong>${fmtMin(left.reduce((n, t) => n + t.minutes, 0))}</strong> in total</span>${raw(plan.overdue ? `<span class="chip-warn"><strong>${plan.overdue}</strong> overdue</span>` : '')}${raw(plan.heavyDays ? `<span class="chip-warn"><strong>${plan.heavyDays}</strong> heavy day${plan.heavyDays === 1 ? '' : 's'}</span>` : '')}</div>`;
  if (!plan.total && !inputs.events.length) { $('#plan').innerHTML = `<div class="card">${emptyState('You are all caught up', 'Nothing is due and there is nothing new to revise. Check back after your teachers add more.')}</div>`; return; }
  $('#plan').innerHTML = `<div class="plan-grid">${plan.days.map((d, i) => html`<section class="card plan-day${i === 0 ? ' plan-today' : ''}${d.heavy ? ' plan-heavy' : ''}" aria-label="${fmtDay(d.date, i)}">
    <header class="plan-head"><div><strong>${fmtDay(d.date, i)}</strong><div class="text-muted text-sm">${fmtDate(d.date)}</div></div><span class="text-sm ${d.heavy ? 'plan-heavy-text' : 'text-muted'}">${d.minutes ? fmtMin(d.minutes) : 'Free'}${d.heavy ? ' · heavy' : ''}</span></header>
    ${raw(d.events.map((e) => html`<a class="plan-item plan-live" href="${e.href}"><span class="plan-kind">Live</span><span class="plan-title">${e.title}</span><span class="text-muted text-sm">${e.start.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })} · ${e.course}</span></a>`).join(''))}
    ${raw(d.tasks.map((t) => html`<div class="plan-item${done.has(t.id) ? ' plan-done' : ''}${t.overdue ? ' plan-overdue' : ''}"><label class="plan-check"><input type="checkbox" data-done="${t.id}" ${raw(done.has(t.id) ? 'checked' : '')} aria-label="Mark ${t.title} as done"></label>
      <div class="plan-main"><span class="plan-kind plan-kind-${t.kind}">${api.KIND_LABEL[t.kind]}</span><a class="plan-title" href="${t.href}">${t.title}</a>
        <span class="text-muted text-sm">${t.course}${t.due ? ` · ${t.overdue ? 'was due' : 'due'} ${fmtDue(t.due)}` : ''}${t.note ? ` · ${t.note}` : ''} · ${fmtMin(t.minutes)}</span></div></div>`).join(''))}
    ${raw(!d.tasks.length && !d.events.length ? '<div class="text-muted text-sm" style="padding:var(--sp-2) 0">Nothing planned. A good day to rest or get ahead.</div>' : '')}</section>`).join('')}</div>`;
}

content.addEventListener('change', (e) => {
  const c = e.target.closest('[data-done]'); if (!c) return;
  c.checked ? done.add(c.dataset.done) : done.delete(c.dataset.done); store.set(KEY_DONE, [...done]); draw();
});
$('#mins').addEventListener('change', (e) => { minutes = Number(e.target.value); store.set(KEY_MIN, minutes); draw(); });

try { inputs = await api.loadInputs((p) => url(`student/${p}`)); draw(); }
catch (e) { console.error(e); $('#plan').innerHTML = errorState(e.message); $('#sum').innerHTML = ''; }
