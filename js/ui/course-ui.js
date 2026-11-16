// Course UI pieces shared by the list and detail pages.
import { html, raw } from '../core/utils.js';
import { formData, setFieldError, clearErrors } from './form.js';
import * as courses from '../services/courses.js';

export const statusBadge = (s) => ({ published: '<span class="badge badge-green">Published</span>', draft: '<span class="badge badge-orange">Draft</span>', archived: '<span class="badge">Archived</span>' }[s] ?? '');

/** Shared form used by "New course" and "Edit course". */
export function courseForm(c = {}, { withThumb = false } = {}) {
  const form = document.createElement('form'); form.noValidate = true;
  form.innerHTML = html`<div class="field"><label for="cf-title">Title</label><input class="input" id="cf-title" name="title" maxlength="120" required value="${c.title ?? ''}"></div>
    <div class="grid grid-2"><div class="field"><label for="cf-cat">Category</label><input class="input" id="cf-cat" name="category" maxlength="60" placeholder="e.g. Languages" value="${c.category ?? ''}"></div>
      <div class="field"><label for="cf-level">Level</label><select class="select" id="cf-level" name="level"><option value="">Not specified</option>${raw(courses.LEVELS.map((l) => `<option ${l === c.level ? 'selected' : ''}>${l}</option>`).join(''))}</select></div></div>
    <div class="field"><label for="cf-desc">Description</label><textarea class="textarea" id="cf-desc" name="description" rows="4" maxlength="2000">${c.description ?? ''}</textarea></div>
    <div class="field"><label for="cf-status">Status</label><select class="select" id="cf-status" name="status">${raw(courses.COURSE_STATUS.map((s) => `<option value="${s}" ${s === (c.status ?? 'draft') ? 'selected' : ''}>${s[0].toUpperCase() + s.slice(1)}</option>`).join(''))}</select>
      <span class="field-hint">Students only see published courses.</span></div>
    ${raw(withThumb ? '<div class="field"><label for="cf-thumb">Thumbnail (optional)</label><input class="input" id="cf-thumb" name="thumb" type="file" accept="image/png,image/jpeg,image/webp"><span class="field-hint">PNG, JPG or WebP, up to 5 MB. 16:9 looks best.</span></div>' : '')}`;
  return form;
}
export function validateCourseForm(form) {
  clearErrors(form); const d = formData(form); let ok = true;
  if (!d.title) { setFieldError(form.elements.title, 'Enter a course title'); ok = false; }
  const f = form.elements.thumb?.files?.[0];
  if (f) { try { courses.validateThumb(f); } catch (e) { setFieldError(form.elements.thumb, e.message); ok = false; } }
  return ok ? { values: d, file: f ?? null } : null;
}


/** If a thumbnail file is missing or fails to load, fall back to the course initials. */
export function thumbFallbacks(root) {
  root.querySelectorAll('.thumb img').forEach((img) => {
    const swap = () => { const t = img.closest('.thumb'); t.textContent = t.dataset.initials || ''; };
    img.addEventListener('error', swap, { once: true });
    if (img.complete && img.naturalWidth === 0) swap();
  });
}
