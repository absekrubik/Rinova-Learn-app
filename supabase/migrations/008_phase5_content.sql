-- =====================================================================
-- Rinova Learn  |  008_phase5_content.sql  |  Phase 5: lessons, video, materials, progress
-- Safe to run more than once.
-- =====================================================================

-- Students must not be able to read files that belong to unpublished (draft) lessons.
-- The old policy let any enrolled student read ANY object under the course folder.
-- The sub-selects below run with the caller's own Row Level Security, so a student only
-- "sees" lesson / material rows they are allowed to see (published ones).
drop policy if exists content_read on storage.objects;
create policy content_read on storage.objects for select to authenticated using (
  bucket_id in ('lesson-videos', 'materials', 'assignment-files')
  and public.can_view_course(public.try_uuid((storage.foldername(name))[1]))
  and (
    public.is_teacher_of(public.try_uuid((storage.foldername(name))[1]))
    or bucket_id = 'assignment-files'                       -- refined in the assignments phase
    or (bucket_id = 'lesson-videos' and exists (select 1 from public.lessons   l where l.video_path = storage.objects.name))
    or (bucket_id = 'materials'     and exists (select 1 from public.materials m where m.file_path  = storage.objects.name))
  )
);

-- Ordering helpers: keep (module_id, position) lookups fast.
create index if not exists lessons_course_pos_idx on public.lessons (course_id, module_id, position);
create index if not exists materials_lesson_idx   on public.materials (lesson_id);
