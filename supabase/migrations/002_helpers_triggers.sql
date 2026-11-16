-- =====================================================================
-- Rinova Learn  |  002_helpers_triggers.sql
-- Helper functions used by RLS policies, plus integrity triggers.
-- All helpers are SECURITY DEFINER with a pinned search_path so policies
-- never recurse into RLS.
-- =====================================================================

create or replace function public.set_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at = now(); return new; end $$;

create trigger trg_profiles_updated  before update on public.profiles  for each row execute function public.set_updated_at();
create trigger trg_courses_updated   before update on public.courses   for each row execute function public.set_updated_at();
create trigger trg_lessons_updated   before update on public.lessons   for each row execute function public.set_updated_at();

-- ---------- identity helpers ---------------------------------------
-- Role of the caller; NULL when not signed in or suspended.
create or replace function public.app_role() returns public.user_role
language sql stable security definer set search_path = public as $$
  select p.role from public.profiles p where p.id = auth.uid() and p.status = 'active'
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.app_role() = 'admin', false)
$$;

create or replace function public.is_active_user() returns boolean
language sql stable security definer set search_path = public as $$
  select public.app_role() is not null
$$;

create or replace function public.is_teacher_of(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin() or (
    public.app_role() = 'teacher' and exists (
      select 1 from public.course_teachers ct where ct.course_id = cid and ct.teacher_id = auth.uid())
  )
$$;

create or replace function public.is_enrolled(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.app_role() = 'student', false) and exists (
    select 1 from public.enrollments e
    where e.course_id = cid and e.student_id = auth.uid() and e.status <> 'dropped')
$$;

create or replace function public.can_view_course(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_teacher_of(cid) or public.is_enrolled(cid)
$$;

-- teacher <-> student relationship through a shared course
create or replace function public.shares_course_with(target uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_active_user() and exists (
    select 1
    from public.enrollments e
    join public.course_teachers ct on ct.course_id = e.course_id
    where e.status <> 'dropped'
      and ((e.student_id = target and ct.teacher_id = auth.uid())
        or (ct.teacher_id = target and e.student_id = auth.uid())))
$$;

create or replace function public.try_uuid(t text) returns uuid
language plpgsql immutable as $$ begin return t::uuid; exception when others then return null; end $$;

-- ---------- quiz helpers -------------------------------------------
create or replace function public.quiz_course_id(qid uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select z.course_id from public.quizzes z where z.id = qid
$$;

create or replace function public.question_course_id(qqid uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select z.course_id from public.quiz_questions q join public.quizzes z on z.id = q.quiz_id where q.id = qqid
$$;

create or replace function public.quiz_shows_results(qid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select z.show_results from public.quizzes z where z.id = qid), false)
$$;

-- ---------- conversation helpers -----------------------------------
create or replace function public.is_participant(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.conversation_participants p where p.conversation_id = cid and p.user_id = auth.uid())
$$;

create or replace function public.can_access_conversation(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_active_user() and exists (
    select 1 from public.conversations c
    where c.id = cid
      and ((c.type = 'direct' and public.is_participant(c.id))
        or (c.type = 'course' and public.can_view_course(c.course_id))))
$$;

-- ---------- audit & notification primitives ------------------------
create or replace function public.write_audit(p_action text, p_entity text, p_entity_id uuid, p_meta jsonb default '{}')
returns void language sql security definer set search_path = public as $$
  insert into public.audit_log(actor_id, action, entity, entity_id, meta)
  values (auth.uid(), p_action, p_entity, p_entity_id, coalesce(p_meta, '{}'::jsonb))
$$;

create or replace function public.notify_users(p_users uuid[], p_type text, p_title text, p_body text, p_link text)
returns void language sql security definer set search_path = public as $$
  insert into public.notifications(user_id, type, title, body, link)
  select distinct u, p_type, p_title, p_body, p_link
  from unnest(p_users) u
  where u is not null and u is distinct from auth.uid()
$$;

-- ---------- new user -> profile ------------------------------------
-- Role comes ONLY from raw_app_meta_data (writable by admin API / service
-- role, never by the client). Public sign-up metadata can never set a role.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare r public.user_role := 'student';
begin
  if (new.raw_app_meta_data ->> 'role') in ('admin','teacher','student') then
    r := (new.raw_app_meta_data ->> 'role')::public.user_role;
  end if;
  insert into public.profiles (id, email, full_name, role)
  values (new.id, coalesce(new.email, ''), coalesce(new.raw_user_meta_data ->> 'full_name', ''), r);
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- profile guard ------------------------------------------
-- Non-admin sessions cannot change role / status / email.
-- auth.uid() IS NULL means SQL editor or service_role (trusted).
create or replace function public.guard_profile_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    if new.role is distinct from old.role or new.status is distinct from old.status
       or new.email is distinct from old.email or new.id is distinct from old.id then
      raise exception 'Only an administrator can change role, status or email';
    end if;
  end if;
  return new;
end $$;
create trigger trg_profiles_guard before update on public.profiles
  for each row execute function public.guard_profile_update();

-- ---------- courses ------------------------------------------------
create or replace function public.courses_before_insert() returns trigger
language plpgsql as $$
begin
  if new.slug is null or new.slug = '' then
    new.slug := lower(regexp_replace(new.title, '[^a-zA-Z0-9]+', '-', 'g'))
                || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6);
  end if;
  return new;
end $$;
create trigger trg_courses_slug before insert on public.courses
  for each row execute function public.courses_before_insert();

create or replace function public.courses_after_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.profiles p where p.id = new.created_by and p.role = 'teacher') then
    insert into public.course_teachers (course_id, teacher_id, is_lead)
    values (new.id, new.created_by, true) on conflict do nothing;
  end if;
  return new;
end $$;
create trigger trg_courses_creator after insert on public.courses
  for each row execute function public.courses_after_insert();

create or replace function public.course_teachers_check() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.profiles p where p.id = new.teacher_id and p.role in ('teacher','admin')) then
    raise exception 'User is not a teacher';
  end if;
  return new;
end $$;
create trigger trg_course_teachers_check before insert or update on public.course_teachers
  for each row execute function public.course_teachers_check();

create or replace function public.enrollments_check() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.profiles p where p.id = new.student_id and p.role = 'student') then
    raise exception 'Only students can be enrolled';
  end if;
  if tg_op = 'UPDATE' and (new.course_id <> old.course_id or new.student_id <> old.student_id) then
    raise exception 'Enrollment course/student cannot be changed';
  end if;
  return new;
end $$;
create trigger trg_enrollments_check before insert or update on public.enrollments
  for each row execute function public.enrollments_check();

-- ---------- denormalised course_id sync ----------------------------
create or replace function public.lessons_sync() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  select m.course_id into new.course_id from public.modules m where m.id = new.module_id;
  if new.course_id is null then raise exception 'Module not found'; end if;
  return new;
end $$;
create trigger trg_lessons_sync before insert or update of module_id on public.lessons
  for each row execute function public.lessons_sync();

create or replace function public.materials_check() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.lesson_id is not null and not exists (
      select 1 from public.lessons l where l.id = new.lesson_id and l.course_id = new.course_id) then
    raise exception 'Lesson does not belong to this course';
  end if;
  return new;
end $$;
create trigger trg_materials_check before insert or update on public.materials
  for each row execute function public.materials_check();

create or replace function public.lesson_progress_sync() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  select l.course_id into new.course_id from public.lessons l where l.id = new.lesson_id;
  if new.course_id is null then raise exception 'Lesson not found'; end if;
  if tg_op = 'UPDATE' then new.student_id := old.student_id; new.lesson_id := old.lesson_id; end if;
  if new.completed and (tg_op = 'INSERT' or not old.completed) then new.completed_at := now();
  elsif not new.completed then new.completed_at := null; end if;
  new.updated_at := now();
  return new;
end $$;
create trigger trg_lesson_progress_sync before insert or update on public.lesson_progress
  for each row execute function public.lesson_progress_sync();

create or replace function public.attendance_records_sync() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  select s.course_id into new.course_id from public.attendance_sessions s where s.id = new.session_id;
  if new.course_id is null then raise exception 'Session not found'; end if;
  if not exists (select 1 from public.enrollments e
                 where e.course_id = new.course_id and e.student_id = new.student_id and e.status <> 'dropped') then
    raise exception 'Student is not enrolled in this course';
  end if;
  return new;
end $$;
create trigger trg_attendance_records_sync before insert or update on public.attendance_records
  for each row execute function public.attendance_records_sync();

-- ---------- submissions guard --------------------------------------
create or replace function public.submissions_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare a public.assignments%rowtype; staff boolean;
begin
  select * into a from public.assignments where id = new.assignment_id;
  if not found then raise exception 'Assignment not found'; end if;
  new.course_id := a.course_id;
  staff := public.is_teacher_of(a.course_id);

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
      if new.is_late and not a.allow_late then raise exception 'The deadline has passed'; end if;
    else
      if new.grade is not null and new.grade > a.max_points then
        raise exception 'Grade cannot exceed % points', a.max_points;
      end if;
      if new.grade is distinct from old.grade or new.feedback is distinct from old.feedback then
        new.graded_by := auth.uid(); new.graded_at := now();
        if new.status = 'submitted' and new.grade is not null then new.status := 'graded'; end if;
      end if;
    end if;
  end if;
  return new;
end $$;
create trigger trg_submissions_guard before insert or update on public.submissions
  for each row execute function public.submissions_guard();

-- ---------- notification triggers ----------------------------------
create or replace function public.course_audience(cid uuid) returns uuid[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(e.student_id), '{}') from public.enrollments e where e.course_id = cid and e.status <> 'dropped'
$$;

create or replace function public.trg_notify_announcement() returns trigger
language plpgsql security definer set search_path = public as $$
declare uids uuid[];
begin
  if new.course_id is null then
    select array_agg(p.id) into uids from public.profiles p where p.status = 'active';
  else
    uids := public.course_audience(new.course_id);
  end if;
  perform public.notify_users(uids, 'announcement', new.title, left(new.body, 140), 'announcements');
  return new;
end $$;
create trigger trg_announcement_notify after insert on public.announcements
  for each row execute function public.trg_notify_announcement();

create or replace function public.trg_notify_assignment() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.is_published and (tg_op = 'INSERT' or not old.is_published) then
    perform public.notify_users(public.course_audience(new.course_id), 'assignment',
      'New assignment: ' || new.title, null, 'assignments?id=' || new.id);
  end if;
  return new;
end $$;
create trigger trg_assignment_notify after insert or update of is_published on public.assignments
  for each row execute function public.trg_notify_assignment();

create or replace function public.trg_notify_live_class() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.notify_users(public.course_audience(new.course_id), 'live_class',
    'Live class scheduled: ' || new.title, to_char(new.starts_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI "UTC"'),
    'live-classes?id=' || new.id);
  return new;
end $$;
create trigger trg_live_class_notify after insert on public.live_classes
  for each row execute function public.trg_notify_live_class();

create or replace function public.trg_notify_graded() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'graded' and old.status is distinct from 'graded' then
    perform public.notify_users(array[new.student_id], 'grade', 'Your submission was graded', null,
      'assignments?id=' || new.assignment_id);
  end if;
  return new;
end $$;
create trigger trg_graded_notify after update on public.submissions
  for each row execute function public.trg_notify_graded();

create or replace function public.trg_notify_message() returns trigger
language plpgsql security definer set search_path = public as $$
declare c public.conversations%rowtype; uids uuid[]; sender text;
begin
  select * into c from public.conversations where id = new.conversation_id;
  select full_name into sender from public.profiles where id = new.sender_id;
  if c.type = 'direct' then
    select array_agg(user_id) into uids from public.conversation_participants where conversation_id = c.id;
  else
    uids := public.course_audience(c.course_id) || array(select ct.teacher_id from public.course_teachers ct where ct.course_id = c.course_id);
  end if;
  perform public.notify_users(uids, 'message', 'New message from ' || coalesce(nullif(sender,''), 'someone'),
    left(coalesce(new.body, 'Attachment'), 140), 'messages?c=' || c.id);
  return new;
end $$;
create trigger trg_message_notify after insert on public.messages
  for each row execute function public.trg_notify_message();
