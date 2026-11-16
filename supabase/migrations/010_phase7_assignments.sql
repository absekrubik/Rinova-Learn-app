-- =====================================================================
-- Rinova Learn  |  010_phase7_assignments.sql  |  Phase 7: assignments, submissions, grading
-- Safe to run more than once.
-- =====================================================================

-- 1. Size limits (the browser enforces them too; this stops oversized text from ever being stored).
alter table public.assignments drop constraint if exists assignments_text_len;
alter table public.assignments add constraint assignments_text_len
  check (length(title) between 1 and 200 and (instructions is null or length(instructions) <= 10000)) not valid;
alter table public.submissions drop constraint if exists submissions_text_len;
alter table public.submissions add constraint submissions_text_len
  check ((text_answer is null or length(text_answer) <= 20000) and (feedback is null or length(feedback) <= 4000)) not valid;
create index if not exists assignments_course_due_idx on public.assignments (course_id, due_at);

-- 2. Assignment guard: course cannot change, module/attachment must belong to the course,
--    max points cannot drop below a grade that was already given.
create or replace function public.assignments_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.course_id <> old.course_id then raise exception 'Course cannot be changed'; end if;
  if new.module_id is not null and not exists (select 1 from public.modules m where m.id = new.module_id and m.course_id = new.course_id) then
    raise exception 'Module does not belong to this course';
  end if;
  if new.attachment_path is not null and (position('..' in new.attachment_path) > 0 or left(new.attachment_path, 37) <> new.course_id::text || '/') then
    raise exception 'Invalid attachment path';
  end if;
  if tg_op = 'UPDATE' and new.max_points < old.max_points and exists (
      select 1 from public.submissions s where s.assignment_id = new.id and s.grade > new.max_points) then
    raise exception 'Max points cannot be lower than a grade that was already given';
  end if;
  return new;
end $$;
drop trigger if exists trg_assignments_guard on public.assignments;
create trigger trg_assignments_guard before insert or update on public.assignments
  for each row execute function public.assignments_guard();

-- 3. Submission guard (replaces the Phase 1 version). Changes:
--    * answers are trimmed; blank text counts as no text
--    * the file must live in the student's own folder for this assignment
--    * teachers can grade and return, but can never edit the student's answer
--    * a submission returned for revision can be resubmitted even after the deadline
create or replace function public.submissions_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare a public.assignments%rowtype; staff boolean;
begin
  select * into a from public.assignments where id = new.assignment_id;
  if not found then raise exception 'Assignment not found'; end if;
  new.course_id := a.course_id;
  staff := public.is_teacher_of(a.course_id);
  new.text_answer := nullif(btrim(new.text_answer), '');
  new.feedback := nullif(btrim(new.feedback), '');

  if new.file_path is not null and (position('..' in new.file_path) > 0
      or new.file_path not like a.course_id::text || '/' || a.id::text || '/' || new.student_id::text || '/%') then
    raise exception 'Invalid file path';
  end if;

  if tg_op = 'INSERT' then
    if not staff then
      if not a.is_published then raise exception 'Assignment is not published'; end if;
      new.status := 'submitted'; new.grade := null; new.feedback := null;
      new.graded_by := null; new.graded_at := null;
      new.submitted_at := now();
      new.is_late := a.due_at is not null and now() > a.due_at;
      if new.is_late and not a.allow_late then raise exception 'The deadline has passed'; end if;
    end if;
  else
    new.assignment_id := old.assignment_id; new.student_id := old.student_id;
    if not staff then
      if old.status = 'graded' then raise exception 'This submission has already been graded'; end if;
      new.grade := old.grade; new.feedback := old.feedback;
      new.graded_by := old.graded_by; new.graded_at := old.graded_at;
      new.status := 'submitted';
      new.submitted_at := now();
      new.is_late := a.due_at is not null and now() > a.due_at;
      if new.is_late and not a.allow_late and old.status <> 'returned' then raise exception 'The deadline has passed'; end if;
    else
      new.text_answer := old.text_answer; new.file_path := old.file_path;
      new.submitted_at := old.submitted_at; new.is_late := old.is_late;
      if new.grade is not null and new.grade > a.max_points then
        raise exception 'Grade cannot exceed % points', a.max_points;
      end if;
      if new.grade is distinct from old.grade or new.feedback is distinct from old.feedback or new.status is distinct from old.status then
        new.graded_by := auth.uid(); new.graded_at := now();
        if new.status = 'submitted' and new.grade is not null then new.status := 'graded'; end if;
      end if;
    end if;
  end if;
  return new;
end $$;

-- 4. Notifications. Links go to the assignment page. Teachers hear about new/updated submissions,
--    students hear about grades and about work returned for revision.
create or replace function public.trg_notify_assignment() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.is_published and (tg_op = 'INSERT' or not old.is_published) then
    perform public.notify_users(public.course_audience(new.course_id), 'assignment',
      'New assignment: ' || new.title,
      case when new.due_at is null then null else 'Due ' || to_char(new.due_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI "UTC"') end,
      'assignment?id=' || new.id);
  end if;
  return new;
end $$;

create or replace function public.trg_notify_graded() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'graded' and old.status is distinct from 'graded' then
    perform public.notify_users(array[new.student_id], 'grade', 'Your submission was graded', null, 'assignment?id=' || new.assignment_id);
  elsif new.status = 'returned' and old.status is distinct from 'returned' then
    perform public.notify_users(array[new.student_id], 'grade', 'Your submission was returned for revision', null, 'assignment?id=' || new.assignment_id);
  end if;
  return new;
end $$;

create or replace function public.trg_notify_submission() returns trigger
language plpgsql security definer set search_path = public as $$
declare t uuid[]; ttl text; who text;
begin
  if new.status <> 'submitted' then return new; end if;
  -- on update, only tell the teacher when the work actually changed or was sent in again
  if tg_op = 'UPDATE' and old.status = 'submitted' and new.text_answer is not distinct from old.text_answer
     and new.file_path is not distinct from old.file_path then return new; end if;
  select array_agg(ct.teacher_id) into t from public.course_teachers ct where ct.course_id = new.course_id;
  select title into ttl from public.assignments where id = new.assignment_id;
  select coalesce(nullif(full_name, ''), email) into who from public.profiles where id = new.student_id;
  perform public.notify_users(coalesce(t, '{}'), 'submission',
    case when tg_op = 'INSERT' then 'New submission: ' else 'Resubmitted: ' end || ttl, who, 'assignment?id=' || new.assignment_id);
  return new;
end $$;
drop trigger if exists trg_submission_notify on public.submissions;
create trigger trg_submission_notify after insert or update on public.submissions
  for each row execute function public.trg_notify_submission();

-- 5. Per-assignment counts for the teacher's list (respects the caller's access via security_invoker).
create or replace view public.v_assignment_stats with (security_invoker = true) as
select a.id as assignment_id, a.course_id,
       count(s.id) as submitted,
       count(s.id) filter (where s.status = 'graded') as graded,
       count(s.id) filter (where s.is_late) as late
from public.assignments a left join public.submissions s on s.assignment_id = a.id
group by a.id, a.course_id;
grant select on public.v_assignment_stats to authenticated;

-- 6. Storage.
--    * Students can read an assignment's attachment only while the assignment is published
--      (the sub-select runs with the student's own access, so draft assignments stay hidden).
--    * Students can upload a submission file only for a published assignment of that course.
drop policy if exists content_read on storage.objects;
create policy content_read on storage.objects for select to authenticated using (
  bucket_id in ('lesson-videos', 'materials', 'assignment-files')
  and public.can_view_course(public.try_uuid((storage.foldername(name))[1]))
  and (
    public.is_teacher_of(public.try_uuid((storage.foldername(name))[1]))
    or (bucket_id = 'assignment-files' and exists (select 1 from public.assignments a where a.attachment_path = storage.objects.name))
    or (bucket_id = 'lesson-videos' and exists (select 1 from public.lessons   l where l.video_path = storage.objects.name))
    or (bucket_id = 'materials'     and exists (select 1 from public.materials m where m.file_path  = storage.objects.name))
  )
);

drop policy if exists submissions_student_write on storage.objects;
create policy submissions_student_write on storage.objects for insert to authenticated with check (
  bucket_id = 'submissions' and (storage.foldername(name))[3] = auth.uid()::text
  and public.is_enrolled(public.try_uuid((storage.foldername(name))[1]))
  and exists (select 1 from public.assignments a
              where a.id = public.try_uuid((storage.foldername(name))[2]) and a.course_id = public.try_uuid((storage.foldername(name))[1])));
drop policy if exists submissions_student_update on storage.objects;
create policy submissions_student_update on storage.objects for update to authenticated
  using (bucket_id = 'submissions' and (storage.foldername(name))[3] = auth.uid()::text
         and public.is_enrolled(public.try_uuid((storage.foldername(name))[1])))
  with check (bucket_id = 'submissions' and (storage.foldername(name))[3] = auth.uid()::text
         and exists (select 1 from public.assignments a
              where a.id = public.try_uuid((storage.foldername(name))[2]) and a.course_id = public.try_uuid((storage.foldername(name))[1])));
