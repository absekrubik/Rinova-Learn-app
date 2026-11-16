-- =====================================================================
-- Rinova Learn  |  005_rpc_views.sql
-- Admin RPCs, quiz engine, messaging RPCs, dashboard stats, views.
-- =====================================================================

-- ---------- admin ---------------------------------------------------
create or replace function public.set_user_role(p_user uuid, p_role public.user_role) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Administrator only'; end if;
  if p_user = auth.uid() then raise exception 'You cannot change your own role'; end if;
  update public.profiles set role = p_role where id = p_user;
  perform public.write_audit('set_role', 'profile', p_user, jsonb_build_object('role', p_role));
end $$;

create or replace function public.set_user_status(p_user uuid, p_status public.user_status) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Administrator only'; end if;
  if p_user = auth.uid() then raise exception 'You cannot change your own status'; end if;
  update public.profiles set status = p_status where id = p_user;
  perform public.write_audit('set_status', 'profile', p_user, jsonb_build_object('status', p_status));
end $$;

-- ---------- quiz engine ---------------------------------------------
create or replace function public.start_quiz_attempt(p_quiz_id uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare qz public.quizzes%rowtype; att public.quiz_attempts%rowtype; n int; mx numeric; new_id uuid;
begin
  select * into qz from public.quizzes where id = p_quiz_id;
  if not found or not qz.is_published then raise exception 'Quiz not available'; end if;
  if not public.is_enrolled(qz.course_id) then raise exception 'You are not enrolled in this course'; end if;
  if qz.available_from  is not null and now() < qz.available_from  then raise exception 'This quiz is not open yet'; end if;
  if qz.available_until is not null and now() > qz.available_until then raise exception 'This quiz is closed'; end if;

  select coalesce(sum(points), 0) into mx from public.quiz_questions where quiz_id = qz.id;

  select * into att from public.quiz_attempts
   where quiz_id = qz.id and student_id = auth.uid() and status = 'in_progress'
   order by started_at desc limit 1;
  if found then
    if qz.time_limit_minutes is not null
       and now() > att.started_at + make_interval(mins => qz.time_limit_minutes) + interval '60 seconds' then
      update public.quiz_attempts set status = 'submitted', submitted_at = now(), score = 0, max_score = mx where id = att.id;
    else
      return att.id;
    end if;
  end if;

  select count(*) into n from public.quiz_attempts
   where quiz_id = qz.id and student_id = auth.uid() and status <> 'in_progress';
  if qz.max_attempts is not null and n >= qz.max_attempts then raise exception 'No attempts left'; end if;

  insert into public.quiz_attempts (quiz_id, course_id, student_id, max_score)
  values (qz.id, qz.course_id, auth.uid(), mx) returning id into new_id;
  return new_id;
end $$;

-- Questions + options WITHOUT any correctness information.
create or replace function public.get_attempt_questions(p_attempt_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare att public.quiz_attempts%rowtype; qz public.quizzes%rowtype; qs jsonb;
begin
  select * into att from public.quiz_attempts where id = p_attempt_id and student_id = auth.uid();
  if not found then raise exception 'Attempt not found'; end if;
  if att.status <> 'in_progress' then raise exception 'Attempt already submitted'; end if;
  if not public.is_enrolled(att.course_id) then raise exception 'You are not enrolled in this course'; end if;
  select * into qz from public.quizzes where id = att.quiz_id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', qq.id, 'type', qq.type, 'prompt', qq.prompt, 'points', qq.points,
           'options', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'label', o.label) order by o.position)
                                from public.quiz_options o where o.question_id = qq.id), '[]'::jsonb))
         order by case when qz.shuffle_questions then md5(att.id::text || qq.id::text)
                       else lpad(qq.position::text, 8, '0') end), '[]'::jsonb)
    into qs from public.quiz_questions qq where qq.quiz_id = att.quiz_id;

  return jsonb_build_object(
    'attempt_id', att.id, 'quiz_title', qz.title,
    'deadline', case when qz.time_limit_minutes is null then null
                     else att.started_at + make_interval(mins => qz.time_limit_minutes) end,
    'questions', qs);
end $$;

-- p_responses: [{ "question_id": uuid, "option_ids": [uuid,...], "text": "..." }, ...]
create or replace function public.submit_quiz_attempt(p_attempt_id uuid, p_responses jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  att public.quiz_attempts%rowtype; qz public.quizzes%rowtype; qq record; r jsonb; k public.quiz_answer_keys%rowtype;
  total numeric := 0; maxs numeric := 0; sel uuid[]; txt text; ok boolean; pts numeric; pending boolean := false;
  expired boolean; final_status public.attempt_status; pct numeric;
begin
  select * into att from public.quiz_attempts where id = p_attempt_id and student_id = auth.uid() for update;
  if not found then raise exception 'Attempt not found'; end if;
  if att.status <> 'in_progress' then raise exception 'Attempt already submitted'; end if;
  if not public.is_enrolled(att.course_id) then raise exception 'You are not enrolled in this course'; end if;
  select * into qz from public.quizzes where id = att.quiz_id;
  expired := qz.time_limit_minutes is not null
             and now() > att.started_at + make_interval(mins => qz.time_limit_minutes) + interval '60 seconds';
  if p_responses is null or jsonb_typeof(p_responses) <> 'array' then p_responses := '[]'::jsonb; end if;

  for qq in select * from public.quiz_questions where quiz_id = att.quiz_id order by position loop
    maxs := maxs + qq.points;
    select x into r from jsonb_array_elements(p_responses) x where x ->> 'question_id' = qq.id::text limit 1;
    sel := '{}'; txt := null; ok := false; pts := 0;

    if r is not null and not expired then
      select coalesce(array_agg(o.id), '{}') into sel from public.quiz_options o
       where o.question_id = qq.id and o.id::text in (select jsonb_array_elements_text(coalesce(r -> 'option_ids', '[]'::jsonb)));
      txt := nullif(trim(r ->> 'text'), '');
    end if;

    select * into k from public.quiz_answer_keys where question_id = qq.id;
    if qq.type = 'short_text' then
      if k.question_id is null or coalesce(array_length(k.accepted_text, 1), 0) = 0 then
        ok := null; pending := true;                       -- needs manual grading
      else
        ok := txt is not null and lower(txt) in (select lower(trim(a)) from unnest(k.accepted_text) a);
      end if;
    else
      ok := k.question_id is not null and coalesce(array_length(sel,1),0) > 0
            and sel <@ k.correct_option_ids and sel @> k.correct_option_ids;
    end if;
    if ok then pts := qq.points; end if;
    total := total + pts;

    insert into public.quiz_responses (attempt_id, course_id, student_id, question_id, selected_option_ids, text_answer, is_correct, points_awarded)
    values (att.id, att.course_id, att.student_id, qq.id, sel, txt, ok, pts)
    on conflict (attempt_id, question_id) do update
      set selected_option_ids = excluded.selected_option_ids, text_answer = excluded.text_answer,
          is_correct = excluded.is_correct, points_awarded = excluded.points_awarded;
  end loop;

  final_status := case when pending then 'submitted' else 'graded' end;
  update public.quiz_attempts set status = final_status, submitted_at = now(), score = total, max_score = maxs where id = att.id;

  pct := case when maxs > 0 then round(total / maxs * 100, 2) else 0 end;
  if qz.show_results then
    return jsonb_build_object('status', final_status, 'score', total, 'max_score', maxs, 'percent', pct,
                              'passed', pct >= qz.pass_percent, 'pending_manual_grading', pending);
  end if;
  return jsonb_build_object('status', final_status, 'submitted', true);
end $$;

-- Teacher grades a manually-marked response, then the attempt total is recomputed.
create or replace function public.grade_quiz_response(p_response_id uuid, p_points numeric) returns void
language plpgsql security definer set search_path = public as $$
declare resp public.quiz_responses%rowtype; qq public.quiz_questions%rowtype; left_pending int;
begin
  select * into resp from public.quiz_responses where id = p_response_id;
  if not found then raise exception 'Response not found'; end if;
  if not public.is_teacher_of(resp.course_id) then raise exception 'Not allowed'; end if;
  select * into qq from public.quiz_questions where id = resp.question_id;
  if p_points < 0 or p_points > qq.points then raise exception 'Points must be between 0 and %', qq.points; end if;
  update public.quiz_responses set points_awarded = p_points, is_correct = (p_points >= qq.points) where id = resp.id;
  select count(*) into left_pending from public.quiz_responses where attempt_id = resp.attempt_id and is_correct is null;
  update public.quiz_attempts a set
      score = (select coalesce(sum(points_awarded), 0) from public.quiz_responses where attempt_id = a.id),
      status = case when left_pending = 0 then 'graded' else a.status end
   where a.id = resp.attempt_id;
end $$;

-- ---------- messaging -----------------------------------------------
create or replace function public.get_or_create_direct_conversation(p_other uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare cid uuid; me uuid := auth.uid(); other_role public.user_role;
begin
  if not public.is_active_user() then raise exception 'Not allowed'; end if;
  if p_other = me then raise exception 'Cannot message yourself'; end if;
  select role into other_role from public.profiles where id = p_other and status = 'active';
  if other_role is null then raise exception 'User not found'; end if;
  if not (public.is_admin() or other_role = 'admin' or public.shares_course_with(p_other)) then
    raise exception 'You can only message teachers/students of your courses and administrators';
  end if;
  select c.id into cid from public.conversations c
   where c.type = 'direct'
     and exists (select 1 from public.conversation_participants a where a.conversation_id = c.id and a.user_id = me)
     and exists (select 1 from public.conversation_participants b where b.conversation_id = c.id and b.user_id = p_other)
   limit 1;
  if cid is null then
    insert into public.conversations (type, created_by) values ('direct', me) returning id into cid;
    insert into public.conversation_participants (conversation_id, user_id) values (cid, me), (cid, p_other);
  end if;
  return cid;
end $$;

create or replace function public.get_or_create_course_conversation(p_course uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare cid uuid;
begin
  if not public.can_view_course(p_course) then raise exception 'Not allowed'; end if;
  select id into cid from public.conversations where type = 'course' and course_id = p_course;
  if cid is null then
    insert into public.conversations (type, course_id, created_by) values ('course', p_course, auth.uid()) returning id into cid;
  end if;
  insert into public.conversation_participants (conversation_id, user_id) values (cid, auth.uid()) on conflict do nothing;
  return cid;
end $$;

-- ---------- dashboard stats (always live) ---------------------------
create or replace function public.admin_stats() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Administrator only'; end if;
  return jsonb_build_object(
    'students',  (select count(*) from public.profiles where role = 'student'),
    'teachers',  (select count(*) from public.profiles where role = 'teacher'),
    'admins',    (select count(*) from public.profiles where role = 'admin'),
    'suspended', (select count(*) from public.profiles where status = 'suspended'),
    'courses',   (select count(*) from public.courses),
    'published_courses', (select count(*) from public.courses where status = 'published'),
    'enrollments', (select count(*) from public.enrollments where status <> 'dropped'),
    'upcoming_live_classes', (select count(*) from public.live_classes where starts_at > now() and status = 'scheduled'),
    'pending_submissions', (select count(*) from public.submissions where status = 'submitted'));
end $$;

create or replace function public.teacher_stats() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if public.app_role() not in ('teacher','admin') then raise exception 'Not allowed'; end if;
  return jsonb_build_object(
    'courses', (select count(*) from public.course_teachers where teacher_id = me),
    'students', (select count(distinct e.student_id) from public.enrollments e
                 join public.course_teachers ct on ct.course_id = e.course_id
                 where ct.teacher_id = me and e.status <> 'dropped'),
    'pending_submissions', (select count(*) from public.submissions s
                 join public.course_teachers ct on ct.course_id = s.course_id
                 where ct.teacher_id = me and s.status = 'submitted'),
    'upcoming_live_classes', (select count(*) from public.live_classes l
                 join public.course_teachers ct on ct.course_id = l.course_id
                 where ct.teacher_id = me and l.starts_at > now() and l.status = 'scheduled'),
    'unread_notifications', (select count(*) from public.notifications where user_id = me and not is_read));
end $$;

create or replace function public.student_stats() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if public.app_role() <> 'student' then raise exception 'Not allowed'; end if;
  return jsonb_build_object(
    'courses', (select count(*) from public.enrollments where student_id = me and status <> 'dropped'),
    'upcoming_live_classes', (select count(*) from public.live_classes l
                 where l.starts_at > now() and l.status = 'scheduled' and public.is_enrolled(l.course_id)),
    'assignments_due', (select count(*) from public.assignments a
                 where a.is_published and public.is_enrolled(a.course_id)
                   and (a.due_at is null or a.due_at > now())
                   and not exists (select 1 from public.submissions s where s.assignment_id = a.id and s.student_id = me)),
    'unread_notifications', (select count(*) from public.notifications where user_id = me and not is_read));
end $$;

-- ---------- views (security_invoker: underlying RLS applies) --------
create or replace view public.v_course_progress with (security_invoker = true) as
select e.course_id, e.student_id,
       (select count(*) from public.lessons l where l.course_id = e.course_id and l.is_published) as total_lessons,
       (select count(*) from public.lesson_progress p join public.lessons l on l.id = p.lesson_id
         where p.course_id = e.course_id and p.student_id = e.student_id and p.completed and l.is_published) as completed_lessons,
       case when (select count(*) from public.lessons l where l.course_id = e.course_id and l.is_published) = 0 then 0
            else round(100.0 * (select count(*) from public.lesson_progress p join public.lessons l on l.id = p.lesson_id
                    where p.course_id = e.course_id and p.student_id = e.student_id and p.completed and l.is_published)
                 / (select count(*) from public.lessons l where l.course_id = e.course_id and l.is_published), 1) end as percent
from public.enrollments e where e.status <> 'dropped';

create or replace view public.v_attendance_summary with (security_invoker = true) as
select course_id, student_id,
       count(*) filter (where status = 'present') as present,
       count(*) filter (where status = 'late')    as late,
       count(*) filter (where status = 'absent')  as absent,
       count(*) filter (where status = 'excused') as excused,
       count(*) as total,
       round(100.0 * count(*) filter (where status in ('present','late')) / nullif(count(*) filter (where status <> 'excused'), 0), 1) as percent
from public.attendance_records group by course_id, student_id;

create or replace view public.v_gradebook_assignments with (security_invoker = true) as
select s.course_id, s.student_id, count(*) as graded_count,
       round(avg(100.0 * s.grade / a.max_points), 1) as average_percent
from public.submissions s join public.assignments a on a.id = s.assignment_id
where s.status = 'graded' and s.grade is not null group by s.course_id, s.student_id;

create or replace view public.v_gradebook_quizzes with (security_invoker = true) as
select course_id, student_id, quiz_id,
       max(round(100.0 * score / nullif(max_score, 0), 1)) as best_percent, count(*) as attempts
from public.quiz_attempts where status = 'graded' group by course_id, student_id, quiz_id;
