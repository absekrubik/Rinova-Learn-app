-- =====================================================================
-- Rinova Learn  |  013_phase10_reports.sql   (Phase 10: progress, grades, reports)
-- Read-only functions. Safe to run more than once.
-- =====================================================================

-- Per-student report for one course (teachers of the course and admins only).
create or replace function public.course_report(p_course uuid) returns table(
  student_id uuid, full_name text, email text, enrolled_at timestamptz,
  total_lessons int, completed_lessons int, progress_percent numeric,
  attendance_marked int, attendance_percent numeric,
  assignments_total int, assignments_graded int, assignments_percent numeric,
  quizzes_total int, quizzes_taken int, quizzes_percent numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.is_admin() or public.is_teacher_of(p_course)) then raise exception 'Not allowed'; end if;
  return query
  select e.student_id, coalesce(nullif(p.full_name, ''), p.email), p.email, e.enrolled_at,
    tl.n::int, coalesce(cl.n, 0)::int, case when tl.n = 0 then 0 else round(100.0 * coalesce(cl.n, 0) / tl.n, 1) end,
    coalesce(att.marked, 0)::int, att.pct,
    ta.n::int, coalesce(ag.n, 0)::int, ag.pct,
    tq.n::int, coalesce(qz.n, 0)::int, qz.pct
  from public.enrollments e
  join public.profiles p on p.id = e.student_id
  cross join lateral (select count(*) n from public.lessons l where l.course_id = p_course and l.is_published) tl
  left join lateral (select count(*) n from public.lesson_progress lp join public.lessons l on l.id = lp.lesson_id
                     where lp.course_id = p_course and lp.student_id = e.student_id and lp.completed and l.is_published) cl on true
  left join lateral (select count(*) marked,
                            round(100.0 * count(*) filter (where r.status in ('present','late')) / nullif(count(*) filter (where r.status <> 'excused'), 0), 1) pct
                     from public.attendance_records r where r.course_id = p_course and r.student_id = e.student_id) att on true
  cross join lateral (select count(*) n from public.assignments a where a.course_id = p_course and a.is_published) ta
  left join lateral (select count(*) n, round(avg(100.0 * s.grade / a.max_points), 1) pct
                     from public.submissions s join public.assignments a on a.id = s.assignment_id
                     where s.course_id = p_course and s.student_id = e.student_id and s.status = 'graded' and s.grade is not null and a.max_points > 0) ag on true
  cross join lateral (select count(*) n from public.quizzes q where q.course_id = p_course and q.is_published) tq
  left join lateral (select count(*) n, round(avg(b.best), 1) pct from (
                       select max(100.0 * at.score / at.max_score) best from public.quiz_attempts at
                       where at.course_id = p_course and at.student_id = e.student_id and at.status = 'graded' and at.max_score > 0 group by at.quiz_id) b) qz on true
  where e.course_id = p_course and e.status <> 'dropped'
  order by 2;
end $$;

-- One row per course the caller runs (all courses for admins).
create or replace function public.courses_report() returns table(
  course_id uuid, title text, status public.course_status, students int, avg_progress numeric,
  avg_attendance numeric, pending_submissions int, pending_quizzes int)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.is_admin() or public.app_role() = 'teacher') then raise exception 'Not allowed'; end if;
  return query
  select c.id, c.title, c.status,
    (select count(*) from public.enrollments e where e.course_id = c.id and e.status <> 'dropped')::int,
    (select round(avg(vp.percent), 1) from public.v_course_progress vp where vp.course_id = c.id),
    (select round(100.0 * count(*) filter (where r.status in ('present','late')) / nullif(count(*) filter (where r.status <> 'excused'), 0), 1)
       from public.attendance_records r join public.enrollments e on e.course_id = r.course_id and e.student_id = r.student_id and e.status <> 'dropped' where r.course_id = c.id),
    (select count(*) from public.submissions s where s.course_id = c.id and s.status = 'submitted')::int,
    (select count(*) from public.quiz_attempts a where a.course_id = c.id and a.status = 'submitted')::int
  from public.courses c
  where public.is_admin() or public.is_teacher_of(c.id)
  order by c.title;
end $$;

-- The signed-in student's own grades, one json object per enrolled course.
create or replace function public.my_grades() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by x->>'title'), '[]'::jsonb) from (
    select jsonb_build_object(
      'course_id', c.id, 'title', c.title,
      'total_lessons', (select count(*) from public.lessons l where l.course_id = c.id and l.is_published),
      'completed_lessons', (select count(*) from public.lesson_progress lp join public.lessons l on l.id = lp.lesson_id
                             where lp.course_id = c.id and lp.student_id = auth.uid() and lp.completed and l.is_published),
      'attendance', (select jsonb_build_object('present', count(*) filter (where r.status = 'present'), 'late', count(*) filter (where r.status = 'late'),
                            'absent', count(*) filter (where r.status = 'absent'), 'excused', count(*) filter (where r.status = 'excused'),
                            'percent', round(100.0 * count(*) filter (where r.status in ('present','late')) / nullif(count(*) filter (where r.status <> 'excused'), 0), 1))
                       from public.attendance_records r where r.course_id = c.id and r.student_id = auth.uid()),
      'assignments', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'title', a.title, 'max_points', a.max_points, 'due_at', a.due_at,
                          'status', s.status, 'grade', case when s.status = 'graded' then s.grade end,
                          'percent', case when s.status = 'graded' and s.grade is not null and a.max_points > 0 then round(100.0 * s.grade / a.max_points, 1) end)
                          order by a.due_at nulls last, a.created_at)
                        from public.assignments a left join public.submissions s on s.assignment_id = a.id and s.student_id = auth.uid()
                        where a.course_id = c.id and a.is_published), '[]'::jsonb),
      'quizzes', coalesce((select jsonb_agg(jsonb_build_object('id', q.id, 'title', q.title, 'pass_percent', q.pass_percent, 'show_results', q.show_results,
                          'attempts', t.attempts, 'pending', t.pending,
                          'best_percent', case when q.show_results then t.best end) order by q.created_at)
                        from public.quizzes q
                        cross join lateral (select count(*) filter (where at.status <> 'in_progress') attempts, count(*) filter (where at.status = 'submitted') pending,
                                                   round(max(100.0 * at.score / nullif(at.max_score, 0)) filter (where at.status = 'graded'), 1) best
                                            from public.quiz_attempts at where at.quiz_id = q.id and at.student_id = auth.uid()) t
                        where q.course_id = c.id and q.is_published), '[]'::jsonb)
    ) x
    from public.courses c
    join public.enrollments e on e.course_id = c.id and e.student_id = auth.uid() and e.status <> 'dropped'
    where public.is_active_user() and c.status <> 'draft'
  ) y
$$;

revoke execute on function public.course_report(uuid), public.courses_report(), public.my_grades() from public, anon;
grant execute on function public.course_report(uuid), public.courses_report(), public.my_grades() to authenticated;
