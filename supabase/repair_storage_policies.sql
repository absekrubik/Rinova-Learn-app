-- Repairs ALL storage access rules (policies on storage.objects). Safe to run more than once.
-- Run in Supabase SQL Editor. Needs migrations 001-003 applied (helper functions).

drop policy if exists avatars_write on storage.objects;
drop policy if exists thumbs_write on storage.objects;
drop policy if exists content_write on storage.objects;
drop policy if exists submissions_read on storage.objects;
drop policy if exists submissions_student_write on storage.objects;
drop policy if exists submissions_student_update on storage.objects;
drop policy if exists submissions_student_delete on storage.objects;
drop policy if exists msg_files on storage.objects;
drop policy if exists content_read on storage.objects;

-- avatars: anyone can read (public bucket); users manage their own folder
create policy avatars_write on storage.objects for all to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text and public.is_active_user())
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text and public.is_active_user());

-- thumbnails: public read; course staff write
create policy thumbs_write on storage.objects for all to authenticated
  using (bucket_id = 'course-thumbnails' and public.is_teacher_of(public.try_uuid((storage.foldername(name))[1])))
  with check (bucket_id = 'course-thumbnails' and public.is_teacher_of(public.try_uuid((storage.foldername(name))[1])));

-- course content buckets: enrolled students + course staff read; staff write
create policy content_write on storage.objects for all to authenticated
  using (bucket_id in ('lesson-videos','materials','assignment-files')
         and public.is_teacher_of(public.try_uuid((storage.foldername(name))[1])))
  with check (bucket_id in ('lesson-videos','materials','assignment-files')
         and public.is_teacher_of(public.try_uuid((storage.foldername(name))[1])));

-- submissions: students manage only their own folder; staff read all of the course
create policy submissions_read on storage.objects for select to authenticated using (
  bucket_id = 'submissions' and (
    public.is_teacher_of(public.try_uuid((storage.foldername(name))[1]))
    or ((storage.foldername(name))[3] = auth.uid()::text
        and public.is_enrolled(public.try_uuid((storage.foldername(name))[1])))));
create policy submissions_student_write on storage.objects for insert to authenticated with check (
  bucket_id = 'submissions' and (storage.foldername(name))[3] = auth.uid()::text
  and public.is_enrolled(public.try_uuid((storage.foldername(name))[1])));
create policy submissions_student_update on storage.objects for update to authenticated
  using (bucket_id = 'submissions' and (storage.foldername(name))[3] = auth.uid()::text
         and public.is_enrolled(public.try_uuid((storage.foldername(name))[1])))
  with check (bucket_id = 'submissions' and (storage.foldername(name))[3] = auth.uid()::text);
create policy submissions_student_delete on storage.objects for delete to authenticated using (
  bucket_id = 'submissions' and (storage.foldername(name))[3] = auth.uid()::text
  and public.is_enrolled(public.try_uuid((storage.foldername(name))[1])));

-- message attachments: conversation members only
create policy msg_files on storage.objects for all to authenticated
  using (bucket_id = 'message-attachments' and public.can_access_conversation(public.try_uuid((storage.foldername(name))[1])))
  with check (bucket_id = 'message-attachments' and public.can_access_conversation(public.try_uuid((storage.foldername(name))[1])));

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


select policyname from pg_policies where schemaname = 'storage' order by 1;
