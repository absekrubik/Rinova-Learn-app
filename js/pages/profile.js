import { mountShell } from '../ui/shell.js';
import { html, raw, formatDate } from '../core/utils.js';
import { avatarInner } from '../core/avatar.js';
import { getProfile, updatePassword } from '../core/auth.js';
import { toastSuccess, toastError } from '../ui/toast.js';
import { formData, setFieldError, clearErrors, withBusy } from '../ui/form.js';
import { updateOwn, uploadAvatar, AVATAR_TYPES, AVATAR_MAX } from '../services/profiles.js';

const role = document.body.dataset.role;
const { me, content } = await mountShell({ roles: [role], active: `${role}/profile.html`, title: 'My profile' });
let profile = me;

content.innerHTML = html`
  <div class="page-head"><div><h1>My profile</h1><p>Your personal details and security.</p></div></div>
  <div class="grid grid-2" style="align-items:start">
    <div class="card"><div class="row" style="margin-bottom:var(--sp-5)"><span class="avatar avatar-lg" id="pv">${raw(avatarInner(profile))}</span>
      <div><button class="btn btn-secondary btn-sm" id="pick" type="button">Change photo</button><input id="file" type="file" accept="image/png,image/jpeg,image/webp" hidden>
      <div class="text-muted text-sm" style="margin-top:6px">PNG, JPG or WebP, up to 2 MB.</div></div></div>
      <form id="pform" novalidate>
        <div class="field"><label for="full_name">Full name</label><input class="input" id="full_name" name="full_name" required value="${profile.full_name}"></div>
        <div class="field"><label for="email">Email</label><input class="input" id="email" value="${profile.email}" disabled><span class="field-hint">Email changes are handled by an administrator.</span></div>
        <div class="field"><label for="phone">Phone</label><input class="input" id="phone" name="phone" type="tel" value="${profile.phone ?? ''}"></div>
        <div class="field"><label for="bio">About you</label><textarea class="textarea" id="bio" name="bio" maxlength="500">${profile.bio ?? ''}</textarea></div>
        <div class="row row-between"><span class="text-muted text-sm"><span class="badge badge-blue" style="text-transform:capitalize">${profile.role}</span> · Joined ${formatDate(profile.created_at)}</span><button class="btn btn-primary" type="submit">Save changes</button></div>
      </form></div>
    <div class="card"><h3 class="card-title">Change password</h3><p class="text-muted text-sm">Choose a new password for your account.</p>
      <form id="wform" novalidate><div class="field"><label for="np">New password</label><input class="input" id="np" name="password" type="password" autocomplete="new-password" minlength="8" required></div>
        <div class="field"><label for="cp">Confirm password</label><input class="input" id="cp" name="confirm" type="password" autocomplete="new-password" required></div>
        <button class="btn btn-primary" type="submit">Update password</button></form></div>
  </div>`;
const $ = (s) => content.querySelector(s);

$('#pform').addEventListener('submit', async (e) => {
  e.preventDefault(); const f = e.currentTarget; clearErrors(f); const d = formData(f);
  if (!d.full_name || d.full_name.length < 2) return setFieldError(f.elements.full_name, 'Enter your name');
  await withBusy(f.querySelector('button[type=submit]'), async () => {
    try { profile = await updateOwn(me.id, d); document.querySelector('#user-panel strong').textContent = profile.full_name; toastSuccess('Profile saved'); } catch (err) { toastError(err.message); }
  });
});

$('#pick').addEventListener('click', () => $('#file').click());
$('#file').addEventListener('change', async (e) => {
  const file = e.target.files[0]; e.target.value = ''; if (!file) return;
  if (!AVATAR_TYPES[file.type]) return toastError('Please choose a PNG, JPG or WebP image.');
  if (file.size > AVATAR_MAX) return toastError('The image must be 2 MB or smaller.');
  const btn = $('#pick');
  await withBusy(btn, async () => {
    try {
      const urlNew = await uploadAvatar(me.id, file, profile.avatar_url);
      profile = { ...profile, avatar_url: urlNew };
      $('#pv').innerHTML = avatarInner(profile); document.getElementById('avatar').innerHTML = avatarInner(profile);
      toastSuccess('Photo updated');
    } catch (err) { toastError(err.message); }
  });
});

$('#wform').addEventListener('submit', async (e) => {
  e.preventDefault(); const f = e.currentTarget; clearErrors(f); const d = formData(f); let ok = true;
  if ((d.password ?? '').length < 8) { setFieldError(f.elements.password, 'Use at least 8 characters'); ok = false; }
  if (d.password !== d.confirm) { setFieldError(f.elements.confirm, 'Passwords do not match'); ok = false; }
  if (!ok) return;
  await withBusy(f.querySelector('button[type=submit]'), async () => { try { await updatePassword(d.password); f.reset(); toastSuccess('Password updated'); } catch (err) { toastError(err.message); } });
});
