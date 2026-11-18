import { mountShell } from '../ui/shell.js';
import { html, raw, formatDate, debounce, param } from '../core/utils.js';
import { avatarInner } from '../core/avatar.js';
import { openModal, confirmDialog } from '../ui/modal.js';
import { toastSuccess, toastError } from '../ui/toast.js';
import { formData, setFieldError, clearErrors, withBusy, isEmail } from '../ui/form.js';
import { emptyState, errorState, skeletonRows } from '../ui/states.js';
import * as users from '../services/users.js';

const { me, content } = await mountShell({ roles: ['admin'], active: 'admin/users.html', title: 'Users' });
const PAGE = 15; const state = { q: (param('q') ?? '').slice(0, 60), role: '', status: '', page: 0 };

content.innerHTML = `
  <div class="page-head"><div><h1>Users</h1><p>Search, create, promote and suspend accounts.</p></div>
    <button class="btn btn-primary" id="add">+ Add user</button></div>
  <div class="card" style="padding:var(--sp-4)">
    <div class="toolbar">
      <input class="input" id="q" type="search" placeholder="Search name or email…" aria-label="Search users">
      <select class="select" id="role" aria-label="Filter by role"><option value="">All roles</option><option value="student">Students</option><option value="teacher">Teachers</option><option value="admin">Admins</option></select>
      <select class="select" id="status" aria-label="Filter by status"><option value="">Any status</option><option value="active">Active</option><option value="suspended">Suspended</option></select>
    </div>
    <div id="table" style="margin-top:var(--sp-4)"></div>
    <div class="pager" id="pager"></div>
  </div>`;
const $ = (s) => content.querySelector(s);

async function load() {
  $('#table').innerHTML = skeletonRows(5);
  try {
    const { rows, total } = await users.listUsers({ ...state, pageSize: PAGE });
    if (!rows.length) { $('#table').innerHTML = emptyState('No users found', 'Try a different search or filter.'); $('#pager').innerHTML = ''; return; }
    $('#table').innerHTML = `<div class="table-wrap"><table class="table"><thead><tr><th>User</th><th>Role</th><th>Status</th><th>Joined</th><th></th></tr></thead><tbody>${rows.map((u) => html`
      <tr data-id="${u.id}"><td><div class="row"><span class="avatar">${raw(avatarInner(u))}</span><div><strong>${u.full_name || '—'}</strong><div class="text-muted text-sm">${u.email}</div></div></div></td>
        <td><span class="badge badge-blue" style="text-transform:capitalize">${u.role}</span></td>
        <td>${raw(u.status === 'active' ? '<span class="badge badge-green">Active</span>' : '<span class="badge badge-red">Suspended</span>')}</td>
        <td>${formatDate(u.created_at)}</td>
        <td style="text-align:right;white-space:nowrap">${raw(u.id === me.id ? '<span class="text-muted text-sm">You</span>' : `<button class="btn btn-ghost btn-sm" data-act="role">Change role</button><button class="btn btn-ghost btn-sm" data-act="password">Reset password</button><button class="btn btn-ghost btn-sm" data-act="status">${u.status === 'active' ? 'Suspend' : 'Reactivate'}</button>`)}</td></tr>`).join('')}</tbody></table></div>`;
    const pages = Math.max(1, Math.ceil(total / PAGE));
    $('#pager').innerHTML = html`<span class="text-muted text-sm">${total} user${total === 1 ? '' : 's'} · page ${state.page + 1} of ${pages}</span>
      <span class="row"><button class="btn btn-secondary btn-sm" id="prev" ${raw(state.page === 0 ? 'disabled' : '')}>Previous</button><button class="btn btn-secondary btn-sm" id="next" ${raw(state.page + 1 >= pages ? 'disabled' : '')}>Next</button></span>`;
    $('#prev')?.addEventListener('click', () => { state.page--; load(); });
    $('#next')?.addEventListener('click', () => { state.page++; load(); });
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    $('#table').querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => {
      const u = byId[b.closest('tr').dataset.id]; ({ role: changeRole, password: resetPassword, status: toggleStatus })[b.dataset.act](u);
    }));
  } catch (e) { console.error(e); $('#table').innerHTML = errorState(e.message); }
}

function changeRole(u) {
  const body = document.createElement('div');
  body.innerHTML = html`<p>Change the role for <strong>${u.full_name || u.email}</strong>.</p><div class="field"><label for="nr">New role</label>
    <select class="select" id="nr">${raw(['student', 'teacher', 'admin'].map((r) => `<option value="${r}" ${r === u.role ? 'selected' : ''}>${r[0].toUpperCase() + r.slice(1)}</option>`).join(''))}</select></div>`;
  openModal({ title: 'Change role', body, actions: [
    { label: 'Cancel', onClick: ({ close }) => close() },
    { label: 'Save', variant: 'primary', onClick: async ({ close, el }) => {
      const role = el.querySelector('#nr').value; if (role === u.role) return close();
      try { await users.setRole(u.id, role); toastSuccess('Role updated'); close(); load(); } catch (e) { toastError(e.message); } } }] });
}

function resetPassword(u) {
  const form = document.createElement('form'); form.noValidate = true;
  form.innerHTML = html`<p>Set a new password for <strong>${u.full_name || u.email}</strong>. They can use it right away and change it from their profile page.</p>
    <div class="field"><label for="rp-pw">New password</label><div class="row" style="flex-wrap:nowrap"><input class="input" id="rp-pw" name="password" type="text" autocomplete="off" required><button class="btn btn-secondary" type="button" id="rp-gen">Generate</button></div>
      <span class="field-hint">At least 8 characters. Share it with them securely. It is not saved anywhere for you to look up later.</span></div>`;
  form.querySelector('#rp-gen').addEventListener('click', () => { form.elements.password.value = genPassword(); });
  const m = openModal({ title: 'Reset password', body: form, actions: [
    { label: 'Cancel', onClick: ({ close }) => close() },
    { label: 'Set password', variant: 'primary', onClick: async ({ el }) => {
      clearErrors(form); const pw = form.elements.password.value;
      if (pw.length < 8) return setFieldError(form.elements.password, 'Use at least 8 characters');
      if (new TextEncoder().encode(pw).length > 72) return setFieldError(form.elements.password, 'That is too long (72 characters at most)');
      await withBusy(el.querySelector('.modal-actions .btn-primary'), async () => {
        try { await users.adminSetPassword(u.id, pw); toastSuccess(`Password changed for ${u.full_name || u.email}`); m.close(); } catch (e) { toastError(e.message); }
      });
    } }] });
  form.addEventListener('submit', (e) => e.preventDefault());
}

async function toggleStatus(u) {
  const suspend = u.status === 'active';
  const ok = await confirmDialog(suspend ? 'Suspend account?' : 'Reactivate account?',
    suspend ? `${u.full_name || u.email} will be signed out of every action and see no data until reactivated.` : `${u.full_name || u.email} will regain access.`,
    { confirmLabel: suspend ? 'Suspend' : 'Reactivate', danger: suspend });
  if (!ok) return;
  try { await users.setStatus(u.id, suspend ? 'suspended' : 'active'); toastSuccess(suspend ? 'Account suspended' : 'Account reactivated'); load(); } catch (e) { toastError(e.message); }
}

const genPassword = () => { const c = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%'; const a = new Uint32Array(14); crypto.getRandomValues(a); return [...a].map((n) => c[n % c.length]).join(''); };

$('#add').addEventListener('click', () => {
  const form = document.createElement('form'); form.noValidate = true;
  form.innerHTML = `<div class="field"><label for="au-name">Full name</label><input class="input" id="au-name" name="full_name" required></div>
    <div class="field"><label for="au-email">Email</label><input class="input" id="au-email" name="email" type="email" required></div>
    <div class="field"><label for="au-role">Role</label><select class="select" id="au-role" name="role"><option value="teacher">Teacher</option><option value="student">Student</option><option value="admin">Admin</option></select></div>
    <div class="field"><label for="au-pw">Temporary password</label><div class="row" style="flex-wrap:nowrap"><input class="input" id="au-pw" name="password" type="text" autocomplete="off" required><button class="btn btn-secondary" type="button" id="gen">Generate</button></div>
      <span class="field-hint">Share it securely. The user can change it from their profile page.</span></div>`;
  form.querySelector('#gen').addEventListener('click', () => { form.elements.password.value = genPassword(); });
  const m = openModal({ title: 'Add user', body: form, actions: [
    { label: 'Cancel', onClick: ({ close }) => close() },
    { label: 'Create account', variant: 'primary', onClick: async ({ el }) => {
      clearErrors(form); const d = formData(form); let ok = true;
      if (!d.full_name) { setFieldError(form.elements.full_name, 'Enter a name'); ok = false; }
      if (!isEmail(d.email ?? '')) { setFieldError(form.elements.email, 'Enter a valid email'); ok = false; }
      if ((d.password ?? '').length < 8) { setFieldError(form.elements.password, 'Use at least 8 characters'); ok = false; }
      if (!ok) return;
      const btn = el.querySelector('.modal-actions .btn-primary');
      await withBusy(btn, async () => { try { await users.createUser(d); toastSuccess(`${d.role[0].toUpperCase() + d.role.slice(1)} account created`); m.close(); state.page = 0; load(); } catch (e) { toastError(e.message); } });
    } }] });
});

content.querySelector('#q').value = state.q;
content.querySelector('#q').addEventListener('input', debounce((e) => { state.q = e.target.value; state.page = 0; load(); }, 300));
content.querySelector('#role').addEventListener('change', (e) => { state.role = e.target.value; state.page = 0; load(); });
content.querySelector('#status').addEventListener('change', (e) => { state.status = e.target.value; state.page = 0; load(); });
load();
