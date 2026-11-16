-- =====================================================================
-- Rinova Learn  |  004_storage.sql  |  buckets + storage RLS
-- Path conventions (first folder is always the access key):
--   avatars            {user_id}/file
--   course-thumbnails  {course_id}/file
--   lesson-videos      {course_id}/{lesson_id}/file
--   materials          {course_id}/file
--   assignment-files   {course_id}/{assignment_id}/file
--   submissions        {course_id}/{assignment_id}/{student_id}/file
--   message-attachments{conversation_id}/file
-- NOTE: Supabase enforces a project-wide upload limit (50 MB on the free
-- plan). The per-bucket limits below cannot exceed it.
-- =====================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('avatars',            'avatars',            true,  2097152,    array['image/png','image/jpeg','image/webp']),
  ('course-thumbnails',  'course-thumbnails',  true,  5242880,    array['image/png','image/jpeg','image/webp']),
  ('lesson-videos',      'lesson-videos',      false, 524288000,  array['video/mp4','video/webm','video/quicktime']),
  ('materials',          'materials',          false, 52428800,   array['application/pdf','image/png','image/jpeg','application/zip','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.presentationml.presentation','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']),
  ('assignment-files',   'assignment-files',   false, 52428800,   array['application/pdf','image/png','image/jpeg','application/zip','application/vnd.openxmlformats-officedocument.wordprocessingml.document']),
  ('submissions',        'submissions',        false, 26214400,   array['application/pdf','image/png','image/jpeg','application/zip','application/vnd.openxmlformats-officedocument.wordprocessingml.document','text/plain']),
  ('message-attachments','message-attachments',false, 10485760,   array['application/pdf','image/png','image/jpeg'])
on conflict (id) do nothing;

-- avatars: anyone can read (public bucket); users manage their own folder
create policy avatars_write on storage.objects for all to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text and public.is_active_user())
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text and public.is_active_user());

-- thumbnails: public read; course staff write
create policy thumbs_write on storage.objects for all to authenticated
  using (bucket_id = 'course-thumbnails' and public.is_teacher_of(public.try_uuid((storage.foldername(name))[1])))
  with check (bucket_id = 'course-thumbnails' and public.is_teacher_of(public.try_uuid((storage.foldername(name))[1])));

-- course content buckets: enrolled students + course staff read; staff write
create policy content_read on storage.objects for select to authenticated using (
  bucket_id in ('lesson-videos','materials','assignment-files')
  and public.can_view_course(public.try_uuid((storage.foldername(name))[1])));
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
