-- Creates (or repairs) the 7 storage buckets Rinova Learn needs. Safe to run more than once.
-- Run in Supabase: SQL Editor -> paste -> Run.  Limits are capped at 50 MB (free-plan maximum).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('avatars',             'avatars',             true,  2097152,  array['image/png','image/jpeg','image/webp']),
  ('course-thumbnails',   'course-thumbnails',   true,  5242880,  array['image/png','image/jpeg','image/webp']),
  ('lesson-videos',       'lesson-videos',       false, 52428800, array['video/mp4','video/webm','video/quicktime']),
  ('materials',           'materials',           false, 52428800, array['application/pdf','image/png','image/jpeg','application/zip','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.presentationml.presentation','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']),
  ('assignment-files',    'assignment-files',    false, 52428800, array['application/pdf','image/png','image/jpeg','application/zip','application/vnd.openxmlformats-officedocument.wordprocessingml.document']),
  ('submissions',         'submissions',         false, 26214400, array['application/pdf','image/png','image/jpeg','application/zip','application/vnd.openxmlformats-officedocument.wordprocessingml.document','text/plain']),
  ('message-attachments', 'message-attachments', false, 10485760, array['application/pdf','image/png','image/jpeg'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

select id, public, file_size_limit from storage.buckets order by id;
