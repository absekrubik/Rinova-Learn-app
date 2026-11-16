// Messages: direct chats and course chats, live updates, PDF/PNG/JPG attachments.
import { mountShell } from '../ui/shell.js';
import { html, raw, param, timeAgo, formatDateTime, debounce } from '../core/utils.js';
import { avatarInner } from '../core/avatar.js';
import { openModal, confirmDialog } from '../ui/modal.js';
import { toastError } from '../ui/toast.js';
import { emptyState, skeletonRows } from '../ui/states.js';
import * as api from '../services/messages.js';
import * as coursesApi from '../services/courses.js';

const role = document.body.dataset.role;
const { me, content } = await mountShell({ roles: [role], active: `${role}/messages.html`, title: 'Messages' });
const isId = (v) => /^[0-9a-f-]{36}$/i.test(v ?? '');
let convs = [], active = null, msgs = [], pending = null, offMsg = null, poll = null;

content.innerHTML = html`<h1 class="sr-only">Messages</h1><div class="chat" data-view="list" id="chat">
  <section class="chat-list" aria-label="Conversations"><div class="chat-head"><strong style="flex:1">Messages</strong><button class="btn btn-secondary btn-sm" id="chat-class">Class chat</button><button class="btn btn-primary btn-sm" id="chat-new">+ New</button></div><div class="chat-list-body" id="clist"></div></section>
  <section class="chat-thread" aria-label="Conversation" id="cthread"></section></div>`;
const chat = content.querySelector('#chat'), listEl = content.querySelector('#clist'), threadEl = content.querySelector('#cthread');
const title = (c) => (c.type === 'direct' ? c.other_name : `${c.course_title ?? 'Class'} · class chat`);
const avatar = (c) => `<span class="avatar">${c.type === 'direct' ? avatarInner({ full_name: c.other_name, avatar_url: c.other_avatar }) : '#'}</span>`;

function paintList() {
  if (!convs.length) { listEl.innerHTML = emptyState('No conversations yet', 'Use "New" to message someone, or open your class chat.'); return; }
  listEl.innerHTML = convs.map((c) => html`<button class="chat-item ${c.id === active?.id ? 'active' : ''}" data-c="${c.id}">${raw(avatar(c))}
    <span class="grow"><span class="name"><span>${title(c)}</span><span class="text-muted text-sm" style="font-weight:400">${c.last_at ? timeAgo(c.last_at) : ''}</span></span>
      <span class="name"><span class="preview">${c.last_at ? (c.last_body || 'Attachment') : 'No messages yet'}</span>${raw(c.unread > 0 ? `<span class="dot" aria-label="${Number(c.unread)} unread">${Number(c.unread)}</span>` : '')}</span></span></button>`).join('');
  listEl.querySelectorAll('[data-c]').forEach((b) => b.addEventListener('click', () => open(b.dataset.c)));
}
async function loadList() { try { convs = await api.conversations(); } catch (e) { console.error(e); toastError(e.message); } paintList(); }

function paintThread({ keepDraft = true } = {}) {
  const c = active; const draft = keepDraft ? threadEl.querySelector('textarea')?.value ?? '' : '';
  if (!c) { threadEl.innerHTML = `<div class="chat-empty"><h3>Select a conversation</h3><p>Pick a chat on the left, or start a new one.</p></div>`; return; }
  const bubble = (m) => {
    const mine = m.sender_id === me.id;
    return html`<div class="msg ${mine ? 'mine' : ''}" data-m="${m.id}">${raw(!mine && c.type === 'course' ? `<div class="who">${html`${m.sender_name}`}</div>` : '')}${m.body ?? ''}${raw(m.attachment_path ? `<div><a href="#" data-file="${html`${m.attachment_path}`}">&#128206; ${html`${api.fileLabel(m.attachment_path)}`}</a></div>` : '')}<div class="when">${formatDateTime(m.created_at)}${raw(mine ? ' · <a href="#" data-del>Delete</a>' : '')}</div></div>`;
  };
  threadEl.innerHTML = html`<div class="chat-head"><button class="btn btn-ghost btn-sm chat-back" id="back" aria-label="Back to conversations">&larr;</button>${raw(avatar(c))}<strong style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${title(c)}</strong></div>
    <div class="chat-scroll" id="scroll" aria-live="polite">${raw(msgs.length ? msgs.map(bubble).join('') : '<div class="chat-empty">No messages yet. Say hello!</div>')}</div>
    <form class="chat-compose" id="compose" novalidate><input type="file" id="file" accept="application/pdf,image/png,image/jpeg" hidden>
      <button type="button" class="btn btn-ghost" id="attach" aria-label="Attach a file" title="Attach PDF, PNG or JPG (10 MB max)">&#128206;</button>
      <textarea class="textarea" id="text" rows="1" maxlength="${api.LIMITS.body}" placeholder="Write a message" aria-label="Message"></textarea><button class="btn btn-primary" id="send" type="submit">Send</button></form>
    <div id="picked" class="text-sm text-muted" style="padding:0 var(--sp-3) var(--sp-2)" hidden></div>`;
  const ta = threadEl.querySelector('#text'); ta.value = draft;
  const sc = threadEl.querySelector('#scroll'); sc.scrollTop = sc.scrollHeight;
  threadEl.querySelector('#back').addEventListener('click', () => { chat.dataset.view = 'list'; });
  const picked = threadEl.querySelector('#picked'), fileIn = threadEl.querySelector('#file');
  const showPicked = () => { picked.hidden = !pending; picked.innerHTML = pending ? html`Attached: <strong>${pending.name}</strong> <a href="#" id="unpick">Remove</a>` : ''; picked.querySelector('#unpick')?.addEventListener('click', (e) => { e.preventDefault(); pending = null; fileIn.value = ''; showPicked(); }); };
  showPicked();
  threadEl.querySelector('#attach').addEventListener('click', () => fileIn.click());
  fileIn.addEventListener('change', () => { const f = fileIn.files[0]; if (!f) return; const err = api.validateMessage('', f); if (err) { toastError(err); fileIn.value = ''; return; } pending = f; showPicked(); });
  ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); threadEl.querySelector('#compose').requestSubmit(); } });
  threadEl.querySelector('#compose').addEventListener('submit', async (e) => {
    e.preventDefault(); const btn = threadEl.querySelector('#send'), body = ta.value, err = api.validateMessage(body, pending); if (err) return toastError(err);
    btn.disabled = true;
    try { await api.send(c.id, body, pending); pending = null; ta.value = ''; await refreshThread(); await loadList(); } catch (er) { toastError(er.message); } finally { btn.disabled = false; ta.focus?.(); }
  });
  sc.querySelectorAll('[data-m]').forEach((el) => {
    const m = msgs.find((x) => x.id === el.dataset.m);
    el.querySelector('[data-file]')?.addEventListener('click', async (e) => { e.preventDefault(); try { const u = await api.attachmentUrl(m.attachment_path); window.open(u, '_blank', 'noopener'); } catch (er) { toastError(er.message); } });
    el.querySelector('[data-del]')?.addEventListener('click', async (e) => { e.preventDefault(); if (!await confirmDialog('Delete this message?', 'It will be removed for everyone in the conversation.', { confirmLabel: 'Delete', danger: true })) return; try { await api.remove(m); await refreshThread(); await loadList(); } catch (er) { toastError(er.message); } });
  });
}
async function refreshThread() {
  if (!active) return;
  try { msgs = await api.thread(active.id); await api.markRead(active.id); const c = convs.find((x) => x.id === active.id); if (c) c.unread = 0; } catch (e) { console.error(e); toastError(e.message); }
  paintThread();
}
async function open(id) {
  if (!isId(id)) return;
  let c = convs.find((x) => x.id === id);
  if (!c) { await loadList(); c = convs.find((x) => x.id === id) ?? { id, type: 'course', course_title: 'Class', unread: 0 }; }
  active = c; pending = null; chat.dataset.view = 'thread'; threadEl.innerHTML = skeletonRows(3); await refreshThread(); paintList();
}

content.querySelector('#chat-new').addEventListener('click', () => {
  const body = document.createElement('div');
  body.innerHTML = `<div class="field"><label for="pp-q">Find a person</label><input class="input" id="pp-q" placeholder="Start typing a name" autocomplete="off"></div><div id="pp-list" class="list"></div>`;
  const dlg = openModal({ title: 'New message', body, actions: [{ label: 'Cancel', onClick: ({ close }) => close() }] });
  const lst = body.querySelector('#pp-list');
  const run = async () => {
    lst.innerHTML = skeletonRows(2);
    try {
      const ps = await api.people(body.querySelector('#pp-q').value.trim());
      lst.innerHTML = ps.length ? ps.map((p) => html`<button type="button" class="chat-item" data-p="${p.id}"><span class="avatar">${raw(avatarInner(p))}</span><span class="grow"><span class="name"><span>${p.full_name}</span></span><span class="preview" style="text-transform:capitalize">${p.role}</span></span></button>`).join('') : emptyState('No one found', 'You can message teachers and students of your courses, and administrators.');
      lst.querySelectorAll('[data-p]').forEach((b) => b.addEventListener('click', async () => { try { const id = await api.startDirect(b.dataset.p); dlg.close(); await loadList(); await open(id); } catch (e) { toastError(e.message); } }));
    } catch (e) { lst.innerHTML = ''; toastError(e.message); }
  };
  body.querySelector('#pp-q').addEventListener('input', debounce(run, 250)); run();
});
content.querySelector('#chat-class').addEventListener('click', async () => {
  const body = document.createElement('div'); body.innerHTML = skeletonRows(2);
  const dlg = openModal({ title: 'Open a class chat', body, actions: [{ label: 'Cancel', onClick: ({ close }) => close() }] });
  try {
    const cs = (await coursesApi.listCourses()).filter((c) => c.status === 'published' || role !== 'student');
    body.innerHTML = cs.length ? cs.map((c) => html`<button type="button" class="chat-item" data-cc="${c.id}"><span class="avatar">#</span><span class="grow"><span class="name"><span>${c.title}</span></span><span class="preview">Everyone in the course can read and write</span></span></button>`).join('') : emptyState('No courses', 'You are not part of a course yet.');
    body.querySelectorAll('[data-cc]').forEach((b) => b.addEventListener('click', async () => { try { const id = await api.openCourseChat(b.dataset.cc); dlg.close(); await loadList(); await open(id); } catch (e) { toastError(e.message); } }));
  } catch (e) { body.innerHTML = ''; toastError(e.message); }
});

await loadList(); paintThread();
const want = param('c'); if (isId(want)) await open(want);
// live updates (Realtime) plus a slow refresh as a safety net
offMsg = api.onMessage(async (m) => { await loadList(); if (active && m.conversation_id === active.id) await refreshThread(); });
poll = setInterval(async () => { if (document.hidden) return; await loadList(); if (active) { const before = msgs.length; try { const t = await api.thread(active.id); if (t.length !== before) { msgs = t; await api.markRead(active.id); paintThread(); } } catch { /* ignore */ } } }, 20000);
addEventListener('pagehide', () => { try { offMsg?.(); } catch { /* ignore */ } clearInterval(poll); });
