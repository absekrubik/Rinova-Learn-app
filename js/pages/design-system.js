import { toast, toastSuccess } from '../ui/toast.js';
import { openModal, confirmDialog } from '../ui/modal.js';
import { formData, setFieldError, clearErrors, withBusy, isEmail } from '../ui/form.js';
import { skeletonRows, emptyState } from '../ui/states.js';

document.getElementById('skel').innerHTML = skeletonRows(3);
document.getElementById('empty').innerHTML = emptyState('No assignments yet', 'New work will appear here.');
document.getElementById('menu').addEventListener('click', () => document.getElementById('app').classList.toggle('nav-open'));
document.getElementById('app').addEventListener('click', (e) => { if (e.target === e.currentTarget) e.currentTarget.classList.remove('nav-open'); });
document.getElementById('t-toast').addEventListener('click', () => toastSuccess('Toast notifications work.'));
document.getElementById('t-busy').addEventListener('click', (e) => withBusy(e.currentTarget, () => new Promise((r) => setTimeout(r, 1200))));
document.getElementById('t-modal').addEventListener('click', async () => {
  const ok = await confirmDialog('Delete course?', 'This is a demo dialog. Nothing is deleted.', { confirmLabel: 'Delete', danger: true });
  toast(ok ? 'Confirmed' : 'Cancelled');
});
document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => {
  document.querySelectorAll('.tab').forEach((x) => x.setAttribute('aria-selected', String(x === t)));
}));
document.getElementById('demo-form').addEventListener('submit', (e) => {
  e.preventDefault(); const f = e.currentTarget; clearErrors(f); const d = formData(f); let ok = true;
  if (!d.name) { setFieldError(f.elements.name, 'Please enter your name'); ok = false; }
  if (!isEmail(d.email ?? '')) { setFieldError(f.elements.email, 'Enter a valid email address'); ok = false; }
  if (ok) toastSuccess('Form is valid');
});
