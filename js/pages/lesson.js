// Lesson viewer: video (uploaded or YouTube/Vimeo), PDF or reading, attachments, progress for students.
import { mountShell } from '../ui/shell.js';
import { html, raw, url, param } from '../core/utils.js';
import { toastSuccess, toastError } from '../ui/toast.js';
import { withBusy } from '../ui/form.js';
import { emptyState, errorState, skeletonRows } from '../ui/states.js';
import * as courses from '../services/courses.js';
import * as api from '../services/content.js';
import * as unlock from '../services/unlock.js';
import { renderGate } from '../ui/unlock-ui.js';
import { materialList, wireMaterials, materialDialog } from './course-content.js';

const role = document.body.dataset.role;
const { me, content } = await mountShell({ roles: [role], active: `${role}/courses.html`, title: 'Lesson' });
const id = param('id');
const courseUrl = (cid) => `${url(`${role}/course.html`)}?id=${cid}`;
const lessonUrl = (lid) => `${url(`${role}/lesson.html`)}?id=${lid}`;
const TYPE_LABEL = { video: 'Video', pdf: 'PDF', text: 'Reading' };

const notFound = () => { content.innerHTML = `<a class="text-sm" href="${url(`${role}/courses.html`)}">&larr; My courses</a><div class="card" style="margin-top:var(--sp-4)">${emptyState('Lesson not found', 'It may have been removed, or it is not published yet.')}</div>`; };

async function load() {
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return notFound();
  content.innerHTML = skeletonRows(4);
  let lesson, course, curriculum, mats, progress = null;
  try {
    lesson = await api.getLesson(id);
    if (!lesson) {                                           // a student may be looking at a locked lesson
      const gate = role === 'student' ? await unlock.lessonGate(id).catch(() => null) : null;
      if (gate?.locked) { document.title = `${gate.title} · Rinova Learn`; return renderGate(content, gate, { role }); }
      return notFound();
    }
    [course, curriculum, mats] = await Promise.all([courses.getCourse(lesson.course_id), api.loadCurriculum(lesson.course_id, { student: role === 'student' }), api.listMaterials(lesson.course_id, lesson.id)]);
    if (!course) return notFound();
  } catch (e) { console.error(e); content.innerHTML = errorState(e.message); return; }
  const canManage = role === 'admin' || (course.course_teachers ?? []).some((t) => t.teacher_id === me.id);
  if (!canManage) { try { progress = await api.myProgress(course.id); } catch (e) { console.warn(e); } }
  document.title = `${lesson.title} · Rinova Learn`;

  const flat = curriculum.flatMap((m) => m.lessons);
  const idx = flat.findIndex((l) => l.id === lesson.id), prev = flat[idx - 1], next = flat[idx + 1];
  const rec = progress?.get(lesson.id);
  const primaryPdf = lesson.type === 'pdf' ? mats.find((m) => m.mime_type === 'application/pdf') : null;
  const attachments = mats.filter((m) => m !== primaryPdf);

  content.innerHTML = html`<div class="lesson-layout">
    <div><a class="text-sm" href="${courseUrl(course.id)}">&larr; ${course.title}</a>
      <div class="page-head" style="margin:var(--sp-3) 0 0"><div><div class="text-muted text-sm">${lesson.modules?.title ?? ''}</div><h1>${lesson.title}</h1>
        <div class="row" style="gap:var(--sp-2);margin-top:var(--sp-2)"><span class="badge badge-blue">${TYPE_LABEL[lesson.type]}</span>${raw(canManage && !lesson.is_published ? '<span class="badge badge-orange">Draft</span>' : '')}</div></div></div></div>
    ${raw(canManage ? '<div class="alert" role="note">Preview: this is what students see. Progress is only tracked for students.</div>' : '')}
    <div id="media"></div>
    ${raw(lesson.type !== 'text' && lesson.content ? html`<div class="card"><h3 class="card-title">About this lesson</h3><p class="pre-wrap" style="margin:0">${lesson.content}</p></div>` : '')}
    ${raw(progress ? '<div id="done-box"></div>' : '')}
    <div class="card" style="padding:var(--sp-4)"><div class="row row-between" style="margin-bottom:var(--sp-2)"><h3 style="margin:0">Attachments</h3>${raw(canManage ? '<button class="btn btn-secondary btn-sm" id="addatt">Upload attachment</button>' : '')}</div>
      <div id="atts">${raw(attachments.length ? materialList(attachments, canManage) : '<div class="text-muted text-sm">No attachments.</div>')}</div></div>
    <div class="lesson-nav">${raw(prev ? `<a class="btn btn-secondary" href="${lessonUrl(prev.id)}">&larr; ${esc(prev.title)}</a>` : '<span></span>')}${raw(next ? `<a class="btn btn-secondary" id="next" href="${lessonUrl(next.id)}">${esc(next.title)} &rarr;</a>` : '<span></span>')}</div></div>`;

  wireMaterials(content.querySelector('#atts'), attachments, load);
  content.querySelector('#addatt')?.addEventListener('click', () => materialDialog(course.id, lesson.id, load));
  await renderMedia(lesson, primaryPdf, rec, canManage);
  if (progress) wireDone(lesson, rec, next);
}
const esc = (s) => html`${s}`;

async function renderMedia(lesson, primaryPdf, rec, canManage) {
  const box = content.querySelector('#media');
  try {
    if (lesson.type === 'text') { box.innerHTML = html`<div class="card"><div class="pre-wrap" style="line-height:1.7">${lesson.content ?? ''}</div></div>`; return; }
    if (lesson.type === 'pdf') {
      if (!primaryPdf) { box.innerHTML = emptyState('No PDF yet', canManage ? 'Edit the lesson and upload a PDF.' : 'The PDF for this lesson is not available.'); return; }
      const u = await api.signedUrl('materials', primaryPdf.file_path);
      box.innerHTML = html`<div class="row" style="margin-bottom:var(--sp-2)"><a class="btn btn-secondary btn-sm" href="${u}" target="_blank" rel="noopener noreferrer">Open in new tab</a></div><iframe class="pdf-frame" src="${u}" title="${lesson.title}"></iframe>`;
      return;
    }
    if (lesson.video_source === 'external') {
      const v = api.parseVideoUrl(lesson.video_url);
      box.innerHTML = v ? html`<div class="player"><iframe src="${v.embedUrl}" title="${lesson.title}" allow="fullscreen; picture-in-picture; encrypted-media" allowfullscreen referrerpolicy="strict-origin-when-cross-origin" sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"></iframe></div><p class="text-muted text-sm">Having trouble? <a href="${v.watchUrl}" target="_blank" rel="noopener noreferrer">Open the video on ${v.provider === 'youtube' ? 'YouTube' : 'Vimeo'}</a>.</p>`
        : emptyState('Video link not supported', 'Only YouTube and Vimeo links can be embedded.');
      return;
    }
    if (!lesson.video_path) { box.innerHTML = emptyState('No video yet', canManage ? 'Edit the lesson and upload a video or add a link.' : 'The video for this lesson is not available.'); return; }
    const u = await api.signedUrl('lesson-videos', lesson.video_path);
    box.innerHTML = html`<div class="player"><video controls controlsList="nodownload" playsinline preload="metadata" src="${u}">Your browser cannot play this video.</video></div>`;
    if (canManage) return;
    trackVideo(box.querySelector('video'), lesson, rec);
  } catch (e) { console.error(e); box.innerHTML = errorState(e.message ?? 'Could not load this lesson.'); }
}

let state = { completed: false };
function trackVideo(video, lesson, rec) {
  let last = 0, finished = false;
  const save = (patch) => api.saveProgress(lesson.id, me.id, patch).catch((e) => console.warn('progress', e));
  video.addEventListener('loadedmetadata', () => { const p = rec?.last_position_seconds ?? 0; if (p > 5 && video.duration && p < video.duration - 5) video.currentTime = p; });
  video.addEventListener('timeupdate', () => { if (Date.now() - last > 15000) { last = Date.now(); save({ last_position_seconds: Math.floor(video.currentTime) }); } });
  video.addEventListener('pause', () => { if (!finished) save({ last_position_seconds: Math.floor(video.currentTime) }); });
  video.addEventListener('ended', async () => { finished = true; await save({ last_position_seconds: 0, completed: true }); state.completed = true; document.dispatchEvent(new CustomEvent('lesson-completed')); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && !finished && video.currentTime > 0) save({ last_position_seconds: Math.floor(video.currentTime) }); });
}

function wireDone(lesson, rec, next) {
  const box = content.querySelector('#done-box'); state.completed = !!rec?.completed;
  const draw = () => {
    box.innerHTML = html`<div class="card"><div class="row row-between"><div class="row" style="gap:var(--sp-3)"><span class="check ${state.completed ? 'check-done' : ''}">${raw(state.completed ? '&#10003;' : '')}</span><strong>${state.completed ? 'Lesson completed' : 'Finished this lesson?'}</strong></div>
      <div class="row">${raw(state.completed && next ? `<a class="btn btn-primary" href="${lessonUrl(next.id)}">Next lesson</a>` : '')}<button class="btn ${state.completed ? 'btn-secondary' : 'btn-primary'}" id="toggle">${state.completed ? 'Mark as not complete' : 'Mark as complete'}</button></div></div></div>`;
    box.querySelector('#toggle').addEventListener('click', (e) => withBusy(e.currentTarget, async () => {
      try { await api.saveProgress(lesson.id, me.id, { completed: !state.completed }); state.completed = !state.completed; toastSuccess(state.completed ? 'Lesson marked complete' : 'Marked as not complete'); draw(); } catch (err) { toastError(err.message); }
    }));
  };
  draw(); document.addEventListener('lesson-completed', draw);
}

load();
