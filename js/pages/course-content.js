// "Content" tab of a course: curriculum builder for teachers/admins, learning path with progress for students.
import { html, raw, url, formatBytes, initials } from '../core/utils.js';
import { openModal, confirmDialog } from '../ui/modal.js';
import { toastSuccess, toastError } from '../ui/toast.js';
import { formData, setFieldError, clearErrors, withBusy } from '../ui/form.js';
import { emptyState, errorState, skeletonRows } from '../ui/states.js';
import * as content from '../services/content.js';
import * as unlock from '../services/unlock.js';
import { lockIcon, rulesDialog, requirementList } from '../ui/unlock-ui.js';

const esc = (v) => html`${v}`;
const TYPE_LABEL = { video: 'Video', pdf: 'PDF', text: 'Reading' };
const TYPE_ICON = {
  video: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="14" height="14" rx="2"/><path d="m17 10 4-2v8l-4-2"/></svg>',
  pdf: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 13h6M9 17h4"/></svg>',
  text: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5a2 2 0 0 1 2-2h12v16H6a2 2 0 0 0-2 2z"/><path d="M4 21V5"/></svg>',
};
const minutes = (s) => (s ? `${Math.max(1, Math.round(s / 60))} min` : '');

export async function renderContent(pane, { course, me, role, canManage, onChange }) {
  const lessonUrl = (id) => `${url(`${role}/lesson.html`)}?id=${id}`;
  pane.innerHTML = skeletonRows(3);
  let mods, mats, progress = new Map(), ruleCount = new Map();
  try {
    [mods, mats] = await Promise.all([content.loadCurriculum(course.id, { student: !canManage }), content.listMaterials(course.id, null)]);
    if (!canManage) progress = await content.myProgress(course.id);
    else (await unlock.listRules(course.id)).forEach((r) => ruleCount.set(r.lesson_id, (ruleCount.get(r.lesson_id) ?? 0) + 1));
  } catch (e) { console.error(e); pane.innerHTML = errorState(e.message); return; }
  const refresh = () => renderContent(pane, { course, me, role, canManage, onChange });

  const allLessons = mods.flatMap((m) => m.lessons);
  const done = allLessons.filter((l) => l.completed ?? progress.get(l.id)?.completed).length;
  const pct = allLessons.length ? Math.round((100 * done) / allLessons.length) : 0;

  const lessonRow = (l, m, i) => html`<div class="list-item" data-lesson="${l.id}">
    <div class="row" style="min-width:0;flex:1;gap:var(--sp-3);flex-wrap:nowrap">
      ${raw(canManage ? '' : `<span class="check ${l.completed ?? progress.get(l.id)?.completed ? 'check-done' : ''}" aria-label="${l.completed ?? progress.get(l.id)?.completed ? 'Completed' : 'Not completed'}">${l.completed ?? progress.get(l.id)?.completed ? '&#10003;' : ''}</span>`)}
      <span class="ltype ltype-${l.type}${l.locked ? ' ltype-locked' : ''}" aria-hidden="true">${raw(TYPE_ICON[l.type] ?? '')}</span>
      <div style="min-width:0"><a href="${lessonUrl(l.id)}" style="font-weight:560;overflow-wrap:anywhere">${raw(l.locked ? lockIcon() + ' ' : '')}${l.title}</a>
        <div class="row" style="gap:var(--sp-2);margin-top:2px"><span class="badge">${TYPE_LABEL[l.type]}</span>${raw(l.locked ? '<span class="badge">Locked</span>' : '')}${raw(canManage && ruleCount.get(l.id) ? `<span class="badge badge-blue">${lockIcon()} ${ruleCount.get(l.id)} unlock rule${ruleCount.get(l.id) === 1 ? '' : 's'}</span>` : '')}${raw(canManage && !l.is_published ? '<span class="badge badge-orange">Draft</span>' : '')}${raw(l.duration_seconds ? html`<span class="text-muted text-sm">${minutes(l.duration_seconds)}</span>` : '')}</div></div></div>
    ${raw(canManage ? `<div class="row" style="gap:2px;flex-wrap:nowrap">
      <button class="btn btn-ghost btn-sm" data-lmove="-1" aria-label="Move lesson up" ${i === 0 ? 'disabled' : ''}>&uarr;</button><button class="btn btn-ghost btn-sm" data-lmove="1" aria-label="Move lesson down" ${i === m.lessons.length - 1 ? 'disabled' : ''}>&darr;</button>
      <button class="btn btn-ghost btn-sm" data-lrules aria-label="Unlock rules for ${esc(l.title)}">Unlock rules</button><button class="btn btn-ghost btn-sm" data-ledit>Edit</button><button class="btn btn-ghost btn-sm" data-ldel style="color:var(--red-600)">Delete</button></div>` : '')}</div>
    ${raw(!canManage && l.locked ? html`<div class="text-sm text-muted" style="padding:0 0 var(--sp-3) calc(var(--sp-3) + 24px)">Unlocks when you finish:${raw(requirementList((l.requirements ?? []).filter((r) => !r.met), role))}</div>` : '')}`;

  const visibleMods = canManage ? mods : mods.filter((m) => m.lessons.length);
  const next = !canManage && allLessons.find((l) => !l.locked && !(l.completed ?? progress.get(l.id)?.completed));

  pane.innerHTML = html`
    ${raw(canManage ? `<div class="row row-between" style="margin-bottom:var(--sp-4)"><span class="text-muted text-sm">Students only see published lessons. Drafts are marked.</span><div class="row"><button class="btn btn-secondary" id="addmat">Upload material</button><button class="btn btn-primary" id="addmod">+ Add module</button></div></div>`
      : `<div class="card" style="margin-bottom:var(--sp-4)"><div class="row row-between"><div style="flex:1;min-width:200px"><strong>${allLessons.length ? `${done} of ${allLessons.length} lessons complete` : 'No lessons yet'}</strong>
        <div class="progress" style="margin-top:var(--sp-2)" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><span style="width:${pct}%"></span></div></div>
        ${next ? `<a class="btn btn-primary" href="${lessonUrl(next.id)}">${done ? 'Continue' : 'Start learning'}</a>` : ''}</div></div>`)}
    <div class="stack" id="mods">${raw(visibleMods.length ? visibleMods.map((m, mi) => html`<div class="card" data-mod="${m.id}" style="padding:var(--sp-4)">
      <div class="row row-between mod-head"><div class="row" style="min-width:0;flex-wrap:nowrap;gap:var(--sp-3)"><span class="mod-num" aria-hidden="true">${mi + 1}</span><div style="min-width:0"><h3 style="margin:0;overflow-wrap:anywhere">${m.title}</h3>${raw(m.description ? html`<div class="text-muted text-sm pre-wrap">${m.description}</div>` : '')}</div></div>
        ${raw(canManage ? `<div class="row" style="gap:2px"><button class="btn btn-ghost btn-sm" data-mmove="-1" aria-label="Move module up" ${mi === 0 ? 'disabled' : ''}>&uarr;</button><button class="btn btn-ghost btn-sm" data-mmove="1" aria-label="Move module down" ${mi === mods.length - 1 ? 'disabled' : ''}>&darr;</button>
          <button class="btn btn-secondary btn-sm" data-ladd>+ Lesson</button><button class="btn btn-ghost btn-sm" data-medit>Edit</button><button class="btn btn-ghost btn-sm" data-mdel style="color:var(--red-600)">Delete</button></div>` : '')}</div>
      <div class="list">${raw(m.lessons.length ? m.lessons.map((l, i) => lessonRow(l, m, i)).join('') : '<div class="text-muted text-sm" style="padding:var(--sp-3) 0">No lessons in this module yet.</div>')}</div></div>`).join('')
      : emptyState(canManage ? 'No modules yet' : 'No lessons yet', canManage ? 'Add a module, then add lessons (video, PDF or reading) to it.' : 'Your teacher has not published any lessons yet.'))}</div>
    <div class="card" style="margin-top:var(--sp-4);padding:var(--sp-4)"><h3 style="margin:0 0 var(--sp-2)">Course materials</h3><div id="mats">${raw(mats.length ? materialList(mats, canManage) : '<div class="text-muted text-sm">No course materials yet.</div>')}</div></div>`;

  wireMaterials(pane.querySelector('#mats'), mats, refresh);
  if (!canManage) return;

  const modById = Object.fromEntries(mods.map((m) => [m.id, m]));
  pane.querySelector('#addmod').addEventListener('click', () => moduleDialog(null));
  pane.querySelector('#addmat').addEventListener('click', () => materialDialog(course.id, null, refresh));
  pane.querySelectorAll('[data-mod]').forEach((el) => {
    const m = modById[el.dataset.mod];
    el.querySelector('[data-medit]').addEventListener('click', () => moduleDialog(m));
    el.querySelector('[data-ladd]').addEventListener('click', () => lessonDialog({ course, mods, mod: m, lesson: null, refresh }));
    el.querySelector('[data-mdel]').addEventListener('click', async () => {
      if (!await confirmDialog('Delete module?', `"${m.title}" and its ${m.lessons.length} lesson${m.lessons.length === 1 ? '' : 's'} (with videos, files and student progress) will be permanently deleted.`, { confirmLabel: 'Delete module', danger: true })) return;
      try { await content.deleteModule(m); toastSuccess('Module deleted'); refresh(); } catch (e) { toastError(e.message); }
    });
    el.querySelectorAll('[data-mmove]').forEach((b) => b.addEventListener('click', () => move('modules', mods, m, +b.dataset.mmove)));
    el.querySelectorAll('[data-lesson]').forEach((row) => {
      const l = m.lessons.find((x) => x.id === row.dataset.lesson);
      row.querySelector('[data-lrules]').addEventListener('click', () => rulesDialog({ course, mods, lesson: l, onDone: refresh }));
      row.querySelector('[data-ledit]').addEventListener('click', async () => {
        try { const full = await content.getLesson(l.id); lessonDialog({ course, mods, mod: m, lesson: full, refresh }); } catch (e) { toastError(e.message); }
      });
      row.querySelector('[data-ldel]').addEventListener('click', async () => {
        if (!await confirmDialog('Delete lesson?', `"${l.title}" and its files and student progress will be permanently deleted.`, { confirmLabel: 'Delete lesson', danger: true })) return;
        try { await content.deleteLesson(l); toastSuccess('Lesson deleted'); refresh(); } catch (e) { toastError(e.message); }
      });
      row.querySelectorAll('[data-lmove]').forEach((b) => b.addEventListener('click', () => move('lessons', m.lessons, l, +b.dataset.lmove)));
    });
  });

  async function move(table, list, item, dir) {
    const i = list.indexOf(item), j = i + dir; if (j < 0 || j >= list.length) return;
    const order = list.slice(); [order[i], order[j]] = [order[j], order[i]];
    try { await content.applyOrder(table, order); refresh(); } catch (e) { toastError(e.message); }
  }

  function moduleDialog(m) {
    const form = document.createElement('form'); form.noValidate = true;
    form.innerHTML = html`<div class="field"><label for="m-title">Title</label><input class="input" id="m-title" name="title" maxlength="120" required value="${m?.title ?? ''}"></div>
      <div class="field"><label for="m-desc">Description (optional)</label><textarea class="textarea" id="m-desc" name="description" rows="3" maxlength="500">${m?.description ?? ''}</textarea></div>`;
    const dlg = openModal({ title: m ? 'Edit module' : 'Add module', body: form, actions: [{ label: 'Cancel', onClick: ({ close }) => close() },
      { label: m ? 'Save' : 'Add module', variant: 'primary', onClick: async ({ el }) => {
        clearErrors(form); const d = formData(form); if (!d.title) return setFieldError(form.elements.title, 'Enter a module title');
        await withBusy(el.querySelector('.modal-actions .btn-primary'), async () => {
          try { if (m) await content.updateModule(m.id, d); else await content.createModule(course.id, d, mods.length ? Math.max(...mods.map((x) => x.position)) + 1 : 0); toastSuccess(m ? 'Module updated' : 'Module added'); dlg.close(); refresh(); } catch (e) { toastError(e.message); }
        });
      } }] });
  }
}

export function materialList(mats, canManage) {
  return `<div class="list">${mats.map((m) => html`<div class="list-item" data-mat="${m.id}"><div style="min-width:0"><strong style="overflow-wrap:anywhere">${m.title}</strong><div class="meta">${(m.mime_type ?? '').split('/').pop().toUpperCase()}${m.size_bytes ? ' · ' + formatBytes(m.size_bytes) : ''}</div></div>
    <div class="row" style="gap:2px;flex-wrap:nowrap"><button class="btn btn-secondary btn-sm" data-dl>Download</button>${raw(canManage ? '<button class="btn btn-ghost btn-sm" data-del style="color:var(--red-600)">Delete</button>' : '')}</div></div>`).join('')}</div>`;
}
export function wireMaterials(box, mats, refresh) {
  if (!box) return;
  const byId = Object.fromEntries(mats.map((m) => [m.id, m]));
  box.querySelectorAll('[data-mat]').forEach((row) => {
    const m = byId[row.dataset.mat];
    row.querySelector('[data-dl]').addEventListener('click', async (e) => {
      await withBusy(e.currentTarget, async () => { try { const u = await content.signedUrl('materials', m.file_path, { download: true }); const a = document.createElement('a'); a.href = u; a.rel = 'noopener'; a.download = m.title; document.body.append(a); a.click(); a.remove(); } catch (err) { toastError(err.message); } });
    });
    row.querySelector('[data-del]')?.addEventListener('click', async () => {
      if (!await confirmDialog('Delete file?', `"${m.title}" will be permanently deleted.`, { confirmLabel: 'Delete', danger: true })) return;
      try { await content.deleteMaterial(m); toastSuccess('File deleted'); refresh(); } catch (err) { toastError(err.message); }
    });
  });
}
export function materialDialog(courseId, lessonId, refresh) {
  const form = document.createElement('form'); form.noValidate = true;
  form.innerHTML = `<div class="field"><label for="mt-file">File</label><input class="input" id="mt-file" name="file" type="file" accept=".pdf,.png,.jpg,.jpeg,.zip,.docx,.pptx,.xlsx"><span class="field-hint">PDF, image, ZIP, Word, PowerPoint or Excel. Up to 50 MB.</span></div>
    <div class="field"><label for="mt-title">Title (optional)</label><input class="input" id="mt-title" name="title" maxlength="120" placeholder="Defaults to the file name"></div>`;
  const dlg = openModal({ title: 'Upload material', body: form, actions: [{ label: 'Cancel', onClick: ({ close }) => close() },
    { label: 'Upload', variant: 'primary', onClick: async ({ el }) => {
      clearErrors(form); const file = form.elements.file.files[0];
      if (!file) return setFieldError(form.elements.file, 'Choose a file');
      try { content.validateUpload(file, content.MATERIAL_TYPES, 'File'); } catch (e) { return setFieldError(form.elements.file, e.message); }
      await withBusy(el.querySelector('.modal-actions .btn-primary'), async () => {
        try { await content.uploadMaterial(courseId, lessonId, file, form.elements.title.value); toastSuccess('File uploaded'); dlg.close(); refresh(); } catch (e) { toastError(e.message); }
      });
    } }] });
}

// ---------------- lesson create / edit ----------------
export function lessonDialog({ course, mods, mod, lesson, refresh }) {
  const L = lesson; const editing = !!L;
  const form = document.createElement('form'); form.noValidate = true;
  const t = L?.type ?? 'video', src = L?.video_source ?? 'storage';
  form.innerHTML = html`<div class="field"><label for="l-title">Title</label><input class="input" id="l-title" name="title" maxlength="140" required value="${L?.title ?? ''}"></div>
    <div class="grid grid-2"><div class="field"><label for="l-mod">Module</label><select class="select" id="l-mod" name="module_id">${raw(mods.map((m) => html`<option value="${m.id}" ${raw(m.id === (L?.module_id ?? mod.id) ? 'selected' : '')}>${m.title}</option>`).join(''))}</select></div>
      <div class="field"><label for="l-type">Type</label><select class="select" id="l-type" name="type"><option value="video" ${raw(t === 'video' ? 'selected' : '')}>Video</option><option value="pdf" ${raw(t === 'pdf' ? 'selected' : '')}>PDF document</option><option value="text" ${raw(t === 'text' ? 'selected' : '')}>Reading (text)</option></select></div></div>
    <div id="blk-video"><div class="field"><label for="l-src">Video source</label><select class="select" id="l-src" name="video_source"><option value="storage" ${raw(src === 'storage' ? 'selected' : '')}>Upload a video file</option><option value="external" ${raw(src === 'external' ? 'selected' : '')}>YouTube or Vimeo link</option></select></div>
      <div class="field" id="blk-file"><label for="l-vfile">Video file</label><input class="input" id="l-vfile" name="vfile" type="file" accept="video/mp4,video/webm,video/quicktime"><span class="field-hint">${raw(L?.video_path ? 'A video is already uploaded; choose a file only to replace it. ' : '')}MP4, WebM or MOV, up to 50 MB. For longer videos use an unlisted YouTube or Vimeo link.</span></div>
      <div class="field" id="blk-url"><label for="l-url">YouTube or Vimeo link</label><input class="input" id="l-url" name="video_url" type="url" placeholder="https://www.youtube.com/watch?v=…" value="${L?.video_url ?? ''}"><span class="field-hint">Tip: set the video to "Unlisted" if only your students should find it.</span></div>
      <div class="field"><label for="l-dur">Length in minutes (optional)</label><input class="input" id="l-dur" name="duration_minutes" type="number" min="1" max="1000" step="1" value="${L?.duration_seconds ? Math.round(L.duration_seconds / 60) : ''}"></div></div>
    <div id="blk-pdf" class="field"><label for="l-pfile">PDF file</label><input class="input" id="l-pfile" name="pfile" type="file" accept="application/pdf"><span class="field-hint" id="pdf-hint">PDF, up to 50 MB.</span></div>
    <div class="field"><label for="l-content" id="l-content-label">Description (optional)</label><textarea class="textarea" id="l-content" name="content" rows="5" maxlength="20000">${L?.content ?? ''}</textarea></div>
    <label class="row" style="gap:var(--sp-2)"><input type="checkbox" name="is_published" ${raw(L?.is_published ? 'checked' : '')}> Published (visible to enrolled students)</label>`;
  const q = (s) => form.querySelector(s);
  let existingPdfs = [];
  const sync = () => {
    const type = form.elements.type.value, ext = form.elements.video_source.value === 'external';
    q('#blk-video').hidden = type !== 'video'; q('#blk-pdf').hidden = type !== 'pdf';
    q('#blk-file').hidden = ext; q('#blk-url').hidden = !ext;
    q('#l-content-label').textContent = type === 'text' ? 'Lesson text' : 'Description (optional)';
  };
  form.elements.type.addEventListener('change', sync); form.elements.video_source.addEventListener('change', sync); sync();
  if (editing) content.listMaterials(course.id, L.id).then((ms) => { existingPdfs = ms.filter((m) => m.mime_type === 'application/pdf'); if (existingPdfs.length) q('#pdf-hint').textContent = `Current file: ${existingPdfs[0].title}. Choose a file only to replace it. PDF, up to 50 MB.`; }).catch(() => {});

  const dlg = openModal({ title: editing ? 'Edit lesson' : 'Add lesson', body: form, actions: [{ label: 'Cancel', onClick: ({ close }) => close() },
    { label: editing ? 'Save changes' : 'Add lesson', variant: 'primary', onClick: async ({ el }) => {
      clearErrors(form); const d = formData(form); d.is_published = form.elements.is_published.checked; let ok = true;
      const bad = (name, msg) => { setFieldError(form.elements[name], msg); ok = false; };
      if (!d.title) bad('title', 'Enter a lesson title');
      const vfile = form.elements.vfile.files[0], pfile = form.elements.pfile.files[0];
      if (d.type === 'video') {
        if (d.video_source === 'external') { if (!content.parseVideoUrl(d.video_url)) bad('video_url', 'Enter a valid YouTube or Vimeo link'); }
        else if (vfile) { try { content.validateUpload(vfile, content.VIDEO_TYPES, 'Video'); } catch (e) { bad('vfile', e.message); } }
        else if (!L?.video_path) bad('vfile', 'Choose a video file');
        if (d.duration_minutes && !(Number(d.duration_minutes) > 0)) bad('duration_minutes', 'Enter a positive number');
      }
      if (d.type === 'pdf') {
        if (pfile) { if (pfile.type !== 'application/pdf') bad('pfile', 'Choose a PDF file.'); else try { content.validateUpload(pfile, content.MATERIAL_TYPES, 'PDF'); } catch (e) { bad('pfile', e.message); } }
        else if (!existingPdfs.length) bad('pfile', 'Choose a PDF file');
      }
      if (d.type === 'text' && !d.content) bad('content', 'Write the lesson text');
      if (!ok) return;
      if (d.type === 'video' && d.video_source === 'external') d.video_url = content.parseVideoUrl(d.video_url).watchUrl;
      await withBusy(el.querySelector('.modal-actions .btn-primary'), async () => {
        let created = null;
        try {
          if (!editing) {
            // create unpublished first so a failed upload never leaves a published, empty lesson
            const pos = (mods.find((m) => m.id === d.module_id)?.lessons ?? []).reduce((mx, x) => Math.max(mx, x.position + 1), 0);
            created = await content.createLesson(d.module_id, { ...d, is_published: false }, pos);
            if (d.type === 'video' && d.video_source !== 'external') await content.uploadLessonVideo(course.id, created, vfile);
            if (d.type === 'pdf') await content.uploadMaterial(course.id, created.id, pfile, pfile.name);
            if (d.is_published) await content.updateLesson(created.id, d);
          } else {
            const extra = {}; let dropVideo = null;
            if (d.type !== 'video') { Object.assign(extra, { video_source: null, video_url: null, video_path: null }); dropVideo = L.video_path; }
            else if (d.video_source === 'external') { Object.assign(extra, { video_source: 'external', video_url: d.video_url, video_path: null }); dropVideo = L.video_path; }
            else if (!L.video_path && !vfile) throw new Error('Choose a video file');
            else Object.assign(extra, { video_source: 'storage', video_url: null });
            await content.updateLesson(L.id, d, extra);
            if (d.type === 'video' && d.video_source !== 'external' && vfile) await content.uploadLessonVideo(course.id, L, vfile);
            if (dropVideo) await content.clearLessonVideoFile({ video_path: dropVideo });
            if (d.type === 'pdf' && pfile) { await content.uploadMaterial(course.id, L.id, pfile, pfile.name); for (const old of existingPdfs) await content.deleteMaterial(old); }
            if (d.module_id !== L.module_id) { const pos = (mods.find((m) => m.id === d.module_id)?.lessons ?? []).reduce((mx, x) => Math.max(mx, x.position + 1), 0); await content.moveLesson(L.id, d.module_id, pos); }
          }
          toastSuccess(editing ? 'Lesson updated' : 'Lesson added'); dlg.close(); refresh();
        } catch (e) {
          if (created) await content.deleteLesson(created).catch(() => {});
          toastError(e.message);
        }
      });
    } }] });
}
