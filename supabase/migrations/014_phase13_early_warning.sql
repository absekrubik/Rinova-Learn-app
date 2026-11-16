-- =====================================================================
-- Rinova Learn  |  014_phase13_early_warning.sql   (Phase 13: early-warning list)
-- Read-only signals + one function to send a friendly nudge. Safe to run more than once.
-- No new tables: everything is worked out from data the system already keeps.
-- =====================================================================

-- Students who may be falling behind, one row per (student, course) with at least one warning sign.
-- Teachers see their own courses, admins see all. Students and anonymous users are refused.
--   days_inactive        days since the last lesson, submission or quiz attempt (or enrolment) - 0 when the course has no published content yet
--   recent_absences      absences among the student's last 3 marked attendance records
--   overdue_assignments  published assignments past their deadline with no submission (only deadlines after the student enrolled)
--   late_submissions     work handed in late
--   failing_quizzes      quizzes where every finished attempt is below the pass mark
--   risk_score           0-12; the page shows 5+ as high, 3-4 as medium, 1-2 as low
create or replace function public.at_risk_students(p_course uuid default null) returns table(
  course_id uuid, course_title text, student_id uuid, full_name text, email text,
  days_inactive int, recent_absences int, overdue_assignments int, late_submissions int, failing_quizzes int,
  risk_score int, last_nudged_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.is_admin() or public.app_role() = 'teacher') then raise exception 'Not allowed'; end if;
  if p_course is not null and not (public.is_admin() or public.is_teacher_of(p_course)) then raise exception 'Not allowed'; end if;
  return query
  with base as (
    select e.course_id as cid, c.title as ctitle, e.student_id as sid, coalesce(nullif(p.full_name, ''), p.email) as sname, p.email as semail, e.enrolled_at
    from public.enrollments e
    join public.courses c on c.id = e.course_id
    join public.profiles p on p.id = e.student_id
    where e.status = 'active' and c.status = 'published' and p.status = 'active' and p.role = 'student'
      and (p_course is null or e.course_id = p_course)
      and (public.is_admin() or public.is_teacher_of(e.course_id))
  ), sig as (
    select b.*,
      case when exists (select 1 from public.lessons l where l.course_id = b.cid and l.is_published)
                or exists (select 1 from public.assignments a where a.course_id = b.cid and a.is_published)
                or exists (select 1 from public.quizzes q where q.course_id = b.cid and q.is_published)
           then floor(extract(epoch from now() - greatest(b.enrolled_at,
                  (select max(lp.updated_at) from public.lesson_progress lp where lp.course_id = b.cid and lp.student_id = b.sid),
                  (select max(s.submitted_at) from public.submissions s where s.course_id = b.cid and s.student_id = b.sid),
                  (select max(qa.started_at) from public.quiz_attempts qa where qa.course_id = b.cid and qa.student_id = b.sid))) / 86400)::int
           else 0 end as inactive,
      (select count(*) filter (where x.status = 'absent') from (
         select r.status from public.attendance_records r join public.attendance_sessions s on s.id = r.session_id
         where r.course_id = b.cid and r.student_id = b.sid order by s.session_date desc, s.created_at desc limit 3) x)::int as absent,
      (select count(*) from public.assignments a
        where a.course_id = b.cid and a.is_published and a.due_at is not null and a.due_at < now() and a.due_at > b.enrolled_at
          and not exists (select 1 from public.submissions s where s.assignment_id = a.id and s.student_id = b.sid))::int as overdue,
      (select count(*) from public.submissions s where s.course_id = b.cid and s.student_id = b.sid and s.is_late)::int as late,
      (select count(*) from (
         select q.pass_percent, max(100.0 * qa.score / qa.max_score) as best
         from public.quizzes q join public.quiz_attempts qa on qa.quiz_id = q.id and qa.student_id = b.sid and qa.status = 'graded' and qa.max_score > 0
         where q.course_id = b.cid and q.is_published group by q.id, q.pass_percent) t where t.best < t.pass_percent)::int as failing,
      (select max(n.created_at) from public.notifications n where n.user_id = b.sid and n.type = 'nudge' and n.link = 'course?id=' || b.cid::text) as nudged
    from base b
  ), scored as (
    select s.*, (case when s.inactive >= 14 then 3 when s.inactive >= 7 then 2 else 0 end)
              + (case when s.absent >= 3 then 3 when s.absent >= 2 then 2 else 0 end)
              + least(s.overdue, 3)
              + (case when s.late >= 2 then 1 else 0 end)
              + least(s.failing, 2) as score
    from sig s
  )
  select z.cid, z.ctitle, z.sid, z.sname, z.semail, z.inactive, z.absent, z.overdue, z.late, z.failing, z.score::int, z.nudged
  from scored z where z.score > 0
  order by z.score desc, z.inactive desc, z.sname;
end $$;

-- A short, friendly message to one student about one course. At most one per student per course every 24 hours.
create or replace function public.nudge_student(p_course uuid, p_student uuid, p_message text default null) returns void
language plpgsql security definer set search_path = public as $$
declare msg text := nullif(btrim(coalesce(p_message, '')), ''); ctitle text;
begin
  if not (public.is_admin() or public.is_teacher_of(p_course)) then raise exception 'Not allowed'; end if;
  if not exists (select 1 from public.enrollments e where e.course_id = p_course and e.student_id = p_student and e.status = 'active') then
    raise exception 'That student is not enrolled in this course';
  end if;
  if msg is not null and char_length(msg) > 300 then raise exception 'Keep the note under 300 characters'; end if;
  if exists (select 1 from public.notifications n where n.user_id = p_student and n.type = 'nudge' and n.link = 'course?id=' || p_course::text and n.created_at > now() - interval '24 hours') then
    raise exception 'This student was already nudged in the last 24 hours';
  end if;
  select title into ctitle from public.courses where id = p_course;
  perform public.notify_users(array[p_student], 'nudge', 'Your teacher is checking in',
    coalesce(msg, 'You may be falling behind in ' || ctitle || '. Open the course to catch up, and message your teacher if you need help.'),
    'course?id=' || p_course::text);
  perform public.write_audit('student.nudge', 'course', p_course, jsonb_build_object('student', p_student));
end $$;

revoke execute on function public.at_risk_students(uuid), public.nudge_student(uuid, uuid, text) from public, anon;
grant execute on function public.at_risk_students(uuid), public.nudge_student(uuid, uuid, text) to authenticated;
