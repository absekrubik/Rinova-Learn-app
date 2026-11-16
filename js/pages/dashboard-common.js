// Pieces shared by the three dashboards. Everything shown comes from the database.
import { html, raw, formatDateTime, timeAgo } from '../core/utils.js';
import { getStats } from '../services/stats.js';
import { upcoming } from '../services/liveClasses.js';
import { listRecent } from '../services/announcements.js';
import { renderAsync, errorState } from '../ui/states.js';

export const greeting = (name) => {
  const h = new Date().getHours();
  return `${h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'}${name ? ', ' + name.split(' ')[0] : ''}`;
};

export const statCard = (value, label) => html`<div class="card stat fade-up"><span class="stat-value">${value ?? 0}</span><span class="stat-label">${label}</span></div>`;

/** Lays out the page head, stat grid placeholder and two panels; returns the containers. */
export function layout(content, { me, subtitle, statCount = 4 }) {
  content.innerHTML = html`
    <div class="page-head"><div><h1>${greeting(me.full_name)}</h1><p>${subtitle}</p></div></div>
    <section class="grid grid-4" id="stats">${raw(Array.from({ length: statCount }, () => '<div class="card"><div class="skeleton" style="height:44px"></div></div>').join(''))}</section>
    <section class="grid grid-2" style="margin-top:var(--sp-4)">
      <div class="card"><h3 class="card-title" style="margin-bottom:var(--sp-3)">Upcoming live classes</h3><div id="live"></div></div>
      <div class="card"><h3 class="card-title" style="margin-bottom:var(--sp-3)">Announcements</h3><div id="news"></div></div>
    </section>
    <div id="extra" style="margin-top:var(--sp-4)"></div>`;
  return { stats: content.querySelector('#stats'), live: content.querySelector('#live'), news: content.querySelector('#news'), extra: content.querySelector('#extra') };
}

export async function loadStats(el, role, cards) {
  try { const s = await getStats(role); el.innerHTML = cards(s).map(([v, l]) => statCard(v, l)).join(''); }
  catch (e) { console.error(e); el.innerHTML = `<div style="grid-column:1/-1">${errorState(e.message)}</div>`; }
}

export const loadLive = (el) => renderAsync(el, () => upcoming(5), (rows) => `<div class="list">${rows.map((c) => html`
  <div class="list-item"><div><strong>${c.title}</strong><div class="meta">${c.course?.title ?? ''}</div></div>
  <div class="meta" style="text-align:right">${formatDateTime(c.starts_at)}</div></div>`).join('')}</div>`,
  { empty: 'No live classes scheduled.', skeleton: 2 });

export const loadNews = (el) => renderAsync(el, () => listRecent(5), (rows) => `<div class="list">${rows.map((a) => html`
  <div class="list-item" style="align-items:flex-start"><div><strong>${a.title}</strong>${raw(a.pinned ? ' <span class="badge badge-orange">Pinned</span>' : '')}
  <div class="meta">${a.course?.title ?? 'Everyone'} · ${a.author?.full_name ?? ''}</div>
  <div class="text-sm" style="margin-top:4px">${a.body.length > 140 ? a.body.slice(0, 140) + '…' : a.body}</div></div>
  <div class="meta" style="white-space:nowrap">${timeAgo(a.created_at)}</div></div>`).join('')}</div>`,
  { empty: 'No announcements yet.', skeleton: 2 });
