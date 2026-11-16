// App shell (sidebar + topbar + notifications + user menu) shared by all three role dashboards.
import { mountSearch } from './search.js';
import { requireRole } from '../core/guard.js';
import { signOut } from '../core/auth.js';
import { html, raw, initials, url, timeAgo } from '../core/utils.js';
import * as notifs from '../services/notifications.js';
import { toast, toastError } from './toast.js';
import { avatarInner } from '../core/avatar.js';

const I = {
  home: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
  book: '<path d="M4 5a2 2 0 0 1 2-2h12v16H6a2 2 0 0 0-2 2z"/><path d="M4 21V5"/>',
  video: '<rect x="3" y="5" width="14" height="14" rx="2"/><path d="m17 10 4-2v8l-4-2"/>',
  check: '<path d="M9 11l3 3 8-8"/><path d="M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h9"/>',
  quiz: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7"/><path d="M12 17h.01"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18.5 14.5A6.5 6.5 0 0 1 21.5 20"/>',
  chat: '<path d="M21 12a8 8 0 0 1-11.6 7.1L3 21l1.9-6.4A8 8 0 1 1 21 12z"/>',
  megaphone: '<path d="M3 11v2a1 1 0 0 0 1 1h3l8 4V6L7 10H4a1 1 0 0 0-1 1z"/><path d="M18 9a4 4 0 0 1 0 6"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  grad: '<path d="M3 20h18"/><path d="M5 20V9l7-5 7 5v11"/><path d="M10 20v-6h4v6"/>',
  clip: '<rect x="6" y="4" width="12" height="17" rx="2"/><path d="M9 4h6v3H9zM9 12h6M9 16h4"/>',
  cal: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  flag: '<path d="M5 21V4"/><path d="M5 4h11l-2 4 2 4H5"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 8 3 8H3s3-1 3-8"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/>',
};
const icon = (n) => raw(`<svg viewBox="0 0 24 24" aria-hidden="true">${I[n]}</svg>`);

// soon:true = module planned in a later phase (shown disabled, never a dead link)
export const NAV = {
  admin: [
    { label: 'Overview', items: [{ href: 'admin/index.html', text: 'Dashboard', icon: 'home' }, { href: 'admin/calendar.html', text: 'Calendar', icon: 'cal' }] },
    { label: 'Manage', items: [
      { href: 'admin/users.html', text: 'Users', icon: 'users' }, { href: 'admin/courses.html', text: 'Courses', icon: 'book' },
      { href: 'admin/live-classes.html', text: 'Live classes', icon: 'video' }, { href: 'admin/assignments.html', text: 'Assignments', icon: 'check' }, { href: 'admin/quizzes.html', text: 'Quizzes', icon: 'quiz' }, { href: 'admin/announcements.html', text: 'Announcements', icon: 'megaphone' }, { href: 'admin/messages.html', text: 'Messages', icon: 'chat' },
      { href: 'admin/reports.html', text: 'Reports', icon: 'chart' }, { href: 'admin/needs-attention.html', text: 'Needs attention', icon: 'flag' }] },
  ],
  teacher: [
    { label: 'Overview', items: [{ href: 'teacher/index.html', text: 'Dashboard', icon: 'home' }, { href: 'teacher/calendar.html', text: 'Calendar', icon: 'cal' }] },
    { label: 'Teach', items: [
      { href: 'teacher/courses.html', text: 'My courses', icon: 'book' }, { href: 'teacher/live-classes.html', text: 'Live classes', icon: 'video' },
      { href: 'teacher/assignments.html', text: 'Assignments', icon: 'check' },
      { href: 'teacher/quizzes.html', text: 'Quizzes', icon: 'quiz' }, { href: 'teacher/reports.html', text: 'Reports', icon: 'chart' }, { href: 'teacher/needs-attention.html', text: 'Needs attention', icon: 'flag' }] },
    { label: 'Communicate', items: [{ href: 'teacher/announcements.html', text: 'Announcements', icon: 'megaphone' }, { href: 'teacher/messages.html', text: 'Messages', icon: 'chat' }] },
  ],
  student: [
    { label: 'Overview', items: [{ href: 'student/index.html', text: 'Dashboard', icon: 'home' }, { href: 'student/calendar.html', text: 'Calendar', icon: 'cal' }] },
    { label: 'Learn', items: [
      { href: 'student/courses.html', text: 'My courses', icon: 'book' }, { href: 'student/live-classes.html', text: 'Live classes', icon: 'video' },
      { href: 'student/assignments.html', text: 'Assignments', icon: 'check' }, { href: 'student/quizzes.html', text: 'Quizzes', icon: 'quiz' },
      { href: 'student/grades.html', text: 'Grades', icon: 'chart' }] },
    { label: 'Communicate', items: [{ href: 'student/announcements.html', text: 'Announcements', icon: 'megaphone' }, { href: 'student/messages.html', text: 'Messages', icon: 'chat' }] },
  ],
};

const navHtml = (role, active) => NAV[role].map((g) => html`<div class="nav-label">${g.label}</div>${g.items.map((it) =>
  it.soon
    ? raw(html`<a class="nav-soon" aria-disabled="true" tabindex="-1">${icon(it.icon)}<span>${it.text}</span><span class="badge" style="margin-left:auto">Soon</span></a>`)
    : raw(html`<a href="${url(it.href)}" ${raw(it.href === active ? 'aria-current="page"' : '')}>${icon(it.icon)}<span>${it.text}</span></a>`)
)}`).join('');

// detail pages are reachable by link but are not nav items
const DETAIL_PAGES = (role) => [`${role}/course.html`, `${role}/lesson.html`, `${role}/live.html`, `${role}/assignment.html`, `${role}/quiz.html`];
const existingPages = (role) => new Set([...NAV[role].flatMap((g) => g.items).filter((i) => !i.soon).map((i) => i.href), ...DETAIL_PAGES(role)]);
function notificationUrl(role, link) {
  if (!link) return null;
  const [base, q] = link.split('?'); const href = `${role}/${base}.html`;
  return existingPages(role).has(href) ? url(href) + (q ? `?${q}` : '') : null;
}

/**
 * Builds the page chrome. Returns { me, content } where `content` is the empty <main> area to fill.
 * Redirects (and never resolves) when the visitor is signed out or has the wrong role.
 */
export async function mountShell({ roles, active, title }) {
  const me = await requireRole(...roles);
  const role = me.role;
  const root = document.getElementById('root');
  root.innerHTML = html`
  <a class="skip-link" href="#page">Skip to content</a>
  <div class="app" id="app">
    <aside class="sidebar" id="sidebar" aria-label="Main navigation">
      <a class="sidebar-brand" href="${url('index.html')}"><img src="${url('assets/img/logo-full.png')}" alt="Rinova Learn"></a>
      <nav class="nav">${raw(navHtml(role, active))}</nav>
    </aside>
    <div class="main">
      <header class="topbar">
        <button class="btn btn-ghost btn-sm menu-btn" id="menu" aria-label="Open menu" aria-controls="sidebar" aria-expanded="false">&#9776;</button>
        <strong id="page-title">${title}</strong>
        <span class="topbar-spacer"></span>
        <button class="btn btn-secondary btn-sm search-btn" id="search" aria-label="Search" aria-haspopup="dialog" title="Search (press / or Ctrl+K)"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><span class="search-label">Search</span><kbd class="search-kbd">/</kbd></button>
        <div class="popover-wrap"><button class="btn btn-ghost btn-sm bell" id="bell" aria-label="Notifications" aria-haspopup="true" aria-expanded="false">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${raw(I.bell)}</svg><span class="bell-count" id="bell-count" hidden>0</span></button>
          <div class="popover" id="bell-panel" hidden></div></div>
        <div class="popover-wrap"><button class="avatar" id="avatar" aria-label="Account menu" aria-haspopup="true" aria-expanded="false">${raw(avatarInner(me))}</button>
          <div class="popover" id="user-panel" hidden>
            <div class="popover-head"><strong>${me.full_name || 'Your account'}</strong><div class="text-muted text-sm">${me.email}</div><span class="badge badge-blue" style="margin-top:6px;text-transform:capitalize">${role}</span></div>
            <a class="btn btn-ghost btn-block" href="${url(role + '/profile.html')}" style="justify-content:flex-start;margin:var(--sp-2) var(--sp-2) 0;width:calc(100% - 1rem)">My profile</a>
            <button class="btn btn-ghost btn-block" id="signout" style="justify-content:flex-start">Sign out</button></div></div>
      </header>
      <main class="content" id="page" tabindex="-1"></main>
    </div>
  </div>`;
  document.title = `${title} · Rinova Learn`;
  const app = root.querySelector('#app');
  const menuBtn = root.querySelector('#menu');
  const setNav = (open) => { app.classList.toggle('nav-open', open); menuBtn.setAttribute('aria-expanded', String(open)); };
  menuBtn.addEventListener('click', () => setNav(!app.classList.contains('nav-open')));
  app.addEventListener('click', (e) => { if (e.target === app) setNav(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && app.classList.contains('nav-open')) { setNav(false); menuBtn.focus(); } });
  root.querySelector('#signout').addEventListener('click', () => signOut());
  mountSearch({ button: root.querySelector('#search'), role, nav: NAV[role] });

  // popovers (only one open at a time, close on outside click / Escape)
  const pops = [['#bell', '#bell-panel'], ['#avatar', '#user-panel']].map(([b, p]) => [root.querySelector(b), root.querySelector(p)]);
  const closeAll = () => pops.forEach(([b, p]) => { p.hidden = true; b.setAttribute('aria-expanded', 'false'); });
  pops.forEach(([b, p]) => b.addEventListener('click', (e) => { e.stopPropagation(); const open = p.hidden; closeAll(); p.hidden = !open; b.setAttribute('aria-expanded', String(open)); if (open && p.id === 'bell-panel') renderBell(); }));
  document.addEventListener('click', (e) => { if (!e.target.closest('.popover')) closeAll(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAll(); });

  // notifications (live data)
  const countEl = root.querySelector('#bell-count'), panel = root.querySelector('#bell-panel');
  async function refreshCount() { try { const n = await notifs.unreadCount(); countEl.textContent = n > 99 ? '99+' : n; countEl.hidden = n === 0; } catch (e) { console.error(e); } }
  async function renderBell() {
    panel.innerHTML = '<div class="popover-head"><strong>Notifications</strong></div><div class="skeleton" style="height:48px;margin:8px"></div>';
    try {
      const items = await notifs.list(8);
      panel.innerHTML = html`<div class="popover-head row row-between"><strong>Notifications</strong><button class="btn btn-ghost btn-sm" id="read-all">Mark all read</button></div>
        ${raw(items.length ? items.map((n) => html`<button class="notif ${n.is_read ? '' : 'unread'}" data-id="${n.id}" data-link="${n.link ?? ''}"><span class="notif-title">${n.title}</span>${raw(n.body ? html`<span class="text-muted text-sm">${n.body}</span>` : '')}<span class="text-muted text-sm">${timeAgo(n.created_at)}</span></button>`).join('') : '<div class="empty" style="padding:var(--sp-5)">You are all caught up.</div>')}`;
      panel.querySelector('#read-all').addEventListener('click', async () => { try { await notifs.markAllRead(); await refreshCount(); renderBell(); } catch (e) { toastError(e.message); } });
      panel.querySelectorAll('.notif').forEach((el) => el.addEventListener('click', async () => {
        try { await notifs.markRead(el.dataset.id); } catch (e) { toastError(e.message); }
        const dest = notificationUrl(role, el.dataset.link); await refreshCount(); if (dest) location.href = dest; else renderBell();
      }));
    } catch (e) { panel.innerHTML = html`<div class="alert alert-error" style="margin:8px">${e.message}</div>`; }
  }
  refreshCount();
  try { notifs.onNew(me.id, (n) => { toast(n.title); refreshCount(); }); } catch (e) { console.warn('Realtime unavailable', e); }

  return { me, content: root.querySelector('#page') };
}
