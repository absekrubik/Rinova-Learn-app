// One calendar of live classes, assignment deadlines and quiz windows, with an .ics download.
import { mountShell } from '../ui/shell.js';
import { html, raw, url, formatDateTime } from '../core/utils.js';
import { emptyState, errorState } from '../ui/states.js';
import { toastError, toastSuccess } from '../ui/toast.js';
import { withBusy } from '../ui/form.js';
import * as cal from '../services/calendar.js';

const role = document.body.dataset.role;
const { content } = await mountShell({ roles: [role], active: `${role}/calendar.html`, title: 'Calendar' });
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const heads = Array.from({ length: 7 }, (_, i) => DAYS[(cal.WEEK_START + i) % 7]);
const state = { y: new Date().getFullYear(), m: new Date().getMonth(), sel: cal.dayKey(new Date()), hide: new Set(), events: [] };
const timeOf = (e) => new Date(e.start).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

content.innerHTML = html`<div class="page-head"><div><h1>Calendar</h1><p>Live classes, assignment deadlines and quiz windows in one place.</p></div><button class="btn" id="ics">Download .ics</button></div>
  <div class="card" style="padding:var(--sp-4)"><div class="cal-bar"><button class="btn btn-sm" id="prev" aria-label="Previous month">&larr;</button><h2 id="title" aria-live="polite"></h2><button class="btn btn-sm" id="next" aria-label="Next month">&rarr;</button><button class="btn btn-sm btn-ghost" id="today">Today</button></div>
    <div class="cal-filters" role="group" aria-label="Show">${raw(Object.entries(cal.KINDS).map(([k, v]) => `<label><input type="checkbox" data-kind="${k}" checked> ${v.label}</label>`).join(''))}</div>
    <div id="grid" class="table-wrap"></div></div>
  <div class="card" style="padding:var(--sp-4);margin-top:var(--sp-4)"><h3 id="daytitle" style="margin:0 0 var(--sp-2)"></h3><div id="day" aria-live="polite"></div></div>`;
const $ = (s) => content.querySelector(s);

const visible = () => state.events.filter((e) => !state.hide.has(e.kind));
function draw() {
  $('#title').textContent = `${MONTHS[state.m]} ${state.y}`;
  const by = cal.groupByDay(visible()), today = cal.dayKey(new Date());
  const cells = cal.monthGrid(state.y, state.m);
  const rows = [];
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));
  $('#grid').innerHTML = html`<table class="cal-grid" aria-label="${MONTHS[state.m]} ${state.y}"><thead><tr>${raw(heads.map((h) => `<th scope="col">${h}</th>`).join(''))}</tr></thead><tbody>${raw(rows.map((r) => `<tr>${r.map((c) => {
    const k = cal.dayKey(c.date), ev = by[k] ?? [];
    const label = `${c.date.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })}, ${ev.length ? `${ev.length} event${ev.length === 1 ? '' : 's'}` : 'no events'}`;
    return html`<td><button class="cal-day${c.inMonth ? '' : ' out'}${k === today ? ' today' : ''}${k === state.sel ? ' sel' : ''}" data-day="${k}" aria-label="${label}" ${raw(k === state.sel ? 'aria-current="date"' : '')}><span class="num">${c.date.getDate()}</span>
      ${raw(ev.slice(0, 2).map((e) => html`<span class="cal-chip ${e.kind}">${timeOf(e)} ${e.title}</span>`.toString()).join(''))}${raw(ev.length > 2 ? `<span class="cal-more">+${ev.length - 2} more</span>` : '')}
      <span class="cal-dots">${raw(ev.slice(0, 4).map((e) => `<i class="${e.kind}"></i>`).join(''))}</span></button></td>`.toString();
  }).join('')}</tr>`).join(''))}</tbody></table>`;
  drawDay(by);
}
function drawDay(by = cal.groupByDay(visible())) {
  const d = new Date(`${state.sel}T00:00:00`);
  $('#daytitle').textContent = d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const ev = by[state.sel] ?? [];
  $('#day').innerHTML = ev.length ? `<div class="list">${ev.map((e) => html`<div class="list-item"><div style="min-width:0"><a href="${url(e.href)}" style="font-weight:560;overflow-wrap:anywhere">${e.title}</a><div class="meta">${e.course}${e.course ? ' · ' : ''}${formatDateTime(e.start)}</div></div><span class="badge ${cal.KINDS[e.kind].badge}">${cal.KINDS[e.kind].label}</span></div>`.toString()).join('')}</div>` : emptyState('Nothing on this day', 'Pick another day, or change what is shown above.');
}
async function load() {
  const from = new Date(state.y, state.m - 1, 20), to = new Date(state.y, state.m + 2, 10);   // covers the leading/trailing days of the grid
  try { state.events = await cal.loadEvents(role, from, to); draw(); }
  catch (e) { console.error(e); $('#grid').innerHTML = errorState(e.message); }
}
const go = (dm) => { const d = new Date(state.y, state.m + dm, 1); state.y = d.getFullYear(); state.m = d.getMonth(); load(); };
$('#prev').onclick = () => go(-1); $('#next').onclick = () => go(1);
$('#today').onclick = () => { const n = new Date(); state.y = n.getFullYear(); state.m = n.getMonth(); state.sel = cal.dayKey(n); load(); };
content.querySelector('.cal-filters').addEventListener('change', (e) => { const k = e.target.dataset.kind; if (!k) return; e.target.checked ? state.hide.delete(k) : state.hide.add(k); draw(); });
$('#grid').addEventListener('click', (e) => { const b = e.target.closest('[data-day]'); if (!b) return; state.sel = b.dataset.day; const d = new Date(`${state.sel}T00:00:00`); if (d.getMonth() !== state.m) { state.y = d.getFullYear(); state.m = d.getMonth(); load(); } else draw(); $(`[data-day="${state.sel}"]`)?.focus(); });
$('#ics').onclick = (e) => withBusy(e.currentTarget, async () => {
  try {
    const from = new Date(); from.setHours(0, 0, 0, 0); from.setDate(from.getDate() - 7);
    const to = new Date(from.getTime() + 372 * 86400000);
    const list = await cal.loadEvents(role, from, to);
    if (!list.length) return toastError('Nothing to export yet.');
    cal.downloadIcs(cal.toIcs(list)); toastSuccess(`Saved ${list.length} event${list.length === 1 ? '' : 's'}. Open the file to add them to Google, Apple or Outlook calendar.`);
  } catch (err) { toastError(err.message || 'Could not make the calendar file.'); }
});
await load();
