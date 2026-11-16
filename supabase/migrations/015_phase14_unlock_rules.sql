-- =====================================================================
-- Rinova Learn  |  015_phase14_unlock_rules.sql   (Phase 14: learning path with unlock rules)
-- A teacher can lock a lesson until the student has done something first.
-- Locking is enforced here, in Row Level Security, not in the browser:
--   * a locked lesson row (and its video / text / files) is invisible to the student
--   * the student cannot record progress on it
-- Safe to run more than once.
-- =====================================================================

-- ---------- rules ----------------------------------------------------
-- "lesson_id is locked until the student <req_type> <req_id>".  Several rules on one lesson must ALL be met.
--   lesson     -> has completed that lesson
--   quiz       -> has a graded attempt at or above min_percent (default: the quiz's own pass mark)
--   assignment -> has submitted work for that assignment
create table if not exists public.unlock_rules (
  id          uuid primary key default gen_random_uuid(),
  course_id   uuid not null references public.courses(id) on delete cascade,   -- set by trigger
  lesson_id   uuid not null references public.lessons(id) on delete cascade,
  req_type    text not null check (req_type in ('lesson','quiz','assignment')),
  req_id      uuid not null,
  min_percent numeric(5,2) check (min_percent between 0 and 100),
  created_by  uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now(),
  unique (lesson_id, req_type, req_id)
);
create index if not exists unlock_rules_lesson_idx on public.unlock_rules (lesson_id);
create index if not exists unlock_rules_course_idx on public.unlock_rules (course_id);
alter table public.unlock_rules enable row level security;

drop policy if exists unlock_rules_select on public.unlock_rules;
drop policy if exists unlock_rules_write  on public.unlock_rules;
create policy unlock_rules_select on public.unlock_rules for select to authenticated using (public.is_teacher_of(course_id));
create policy unlock_rules_write  on public.unlock_rules for all    to authenticated
  using (public.is_teacher_of(course_id)) with check (public.is_teacher_of(course_id));
revoke all on public.unlock_rules from anon;
grant select, insert, update, delete on public.unlock_rules to authenticated;

-- Keeps rules sensible: same course, no self-reference, no loops, no more than 10 per lesson.
create or replace function public.unlock_rules_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare lcourse uuid; rcourse uuid;
begin
  select l.course_id into lcourse from public.lessons l where l.id = new.lesson_id;
  if lcourse is null then raise exception 'Lesson not found'; end if;
  if tg_op = 'UPDATE' and (new.lesson_id <> old.lesson_id or new.req_type <> old.req_type or new.req_id <> old.req_id) then
    raise exception 'Delete this rule and add a new one instead of changing what it points to';
  end if;
  new.course_id := lcourse;
  rcourse := case new.req_type
    when 'lesson'     then (select l.course_id from public.lessons l where l.id = new.req_id)
    when 'quiz'       then (select q.course_id from public.quizzes q where q.id = new.req_id)
    when 'assignment' then (select a.course_id from public.assignments a where a.id = new.req_id) end;
  if rcourse is null then raise exception 'The required item was not found'; end if;
  if rcourse <> lcourse then raise exception 'The required item must belong to the same course'; end if;
  if new.req_type = 'lesson' and new.req_id = new.lesson_id then raise exception 'A lesson cannot require itself'; end if;
  if new.req_type <> 'quiz' and new.min_percent is not null then raise exception 'A minimum score only applies to quizzes'; end if;
  if tg_op = 'INSERT' and (select count(*) from public.unlock_rules r where r.lesson_id = new.lesson_id) >= 10 then
    raise exception 'A lesson can have at most 10 unlock rules';
  end if;
  -- loop check: following lesson->lesson requirements from the new requirement must never lead back to this lesson
  if new.req_type = 'lesson' and exists (
    with recursive walk(id) as (
      select new.req_id
      union
      select r.req_id from public.unlock_rules r join walk w on r.lesson_id = w.id where r.req_type = 'lesson')
    select 1 from walk where id = new.lesson_id) then
    raise exception 'These rules would lock each other forever (a loop)';
  end if;
  return new;
end $$;
drop trigger if exists trg_unlock_rules_guard on public.unlock_rules;
create trigger trg_unlock_rules_guard before insert or update on public.unlock_rules
  for each row execute function public.unlock_rules_guard();

-- When a required lesson, quiz or assignment is deleted its rules go with it.
create or replace function public.unlock_rules_cleanup() returns trigger
language plpgsql security definer set search_path = public as $$
begin delete from public.unlock_rules where req_type = tg_argv[0] and req_id = old.id; return old; end $$;
drop trigger if exists trg_lessons_unlock_cleanup     on public.lessons;
drop trigger if exists trg_quizzes_unlock_cleanup     on public.quizzes;
drop trigger if exists trg_assignments_unlock_cleanup on public.assignments;
create trigger trg_lessons_unlock_cleanup     after delete on public.lessons     for each row execute function public.unlock_rules_cleanup('lesson');
create trigger trg_quizzes_unlock_cleanup     after delete on public.quizzes     for each row execute function public.unlock_rules_cleanup('quiz');
create trigger trg_assignments_unlock_cleanup after delete on public.assignments for each row execute function public.unlock_rules_cleanup('assignment');

-- ---------- evaluation (internal) -----------------------------------
-- A requirement that no longer exists, or is not published yet, never blocks anyone.
create or replace function public.rule_met(p_type text, p_req uuid, p_min numeric, p_student uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select case p_type
    when 'lesson' then
      not exists (select 1 from public.lessons l where l.id = p_req and l.is_published)
      or exists (select 1 from public.lesson_progress lp where lp.lesson_id = p_req and lp.student_id = p_student and lp.completed)
    when 'quiz' then
      not exists (select 1 from public.quizzes q where q.id = p_req and q.is_published)
      or exists (select 1 from public.quiz_attempts a join public.quizzes q on q.id = a.quiz_id
                 where a.quiz_id = p_req and a.student_id = p_student and a.status = 'graded' and a.max_score > 0
                   and 100.0 * a.score / a.max_score >= coalesce(p_min, q.pass_percent))
    when 'assignment' then
      not exists (select 1 from public.assignments x where x.id = p_req and x.is_published)
      or exists (select 1 from public.submissions s where s.assignment_id = p_req and s.student_id = p_student)
    else false end
$$;
revoke execute on function public.rule_met(text, uuid, numeric, uuid) from public, anon, authenticated;

-- Is this lesson open for the signed-in user? (used by the policies below)
create or replace function public.lesson_unlocked(p_lesson uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select not exists (
    select 1 from public.unlock_rules r
    where r.lesson_id = p_lesson and not public.rule_met(r.req_type, r.req_id, r.min_percent, auth.uid()))
$$;
revoke execute on function public.lesson_unlocked(uuid) from public, anon;
grant execute on function public.lesson_unlocked(uuid) to authenticated;

-- ---------- enforcement ---------------------------------------------
-- Locked lessons disappear for students. Materials and lesson_progress policies look lessons up under the
-- caller's own RLS, and the storage policy does the same for video and file objects, so all of them follow.
drop policy if exists lessons_select on public.lessons;
create policy lessons_select on public.lessons for select to authenticated using (
  public.is_teacher_of(course_id) or (public.is_enrolled(course_id) and is_published and public.lesson_unlocked(id))
);

-- Progress percentages must keep counting locked lessons, so they cannot depend on what the student can see.
create or replace function public.lesson_counts(p_course uuid, p_student uuid) returns table(total bigint, done bigint)
language sql stable security definer set search_path = public as $$
  select (select count(*) from public.lessons l where l.course_id = p_course and l.is_published),
         (select count(*) from public.lesson_progress p join public.lessons l on l.id = p.lesson_id
           where p.course_id = p_course and p.student_id = p_student and p.completed and l.is_published)
  where public.is_active_user() and (p_student = auth.uid() or public.is_admin() or public.is_teacher_of(p_course))
$$;
revoke execute on function public.lesson_counts(uuid, uuid) from public, anon;
grant execute on function public.lesson_counts(uuid, uuid) to authenticated;

create or replace view public.v_course_progress with (security_invoker = true) as
select e.course_id, e.student_id, lc.total as total_lessons, lc.done as completed_lessons,
       case when lc.total = 0 then 0 else round(100.0 * lc.done / lc.total, 1) end as percent
from public.enrollments e
cross join lateral public.lesson_counts(e.course_id, e.student_id) lc
where e.status <> 'dropped';
grant select on public.v_course_progress to authenticated;

-- ---------- what the student is allowed to see about locked lessons -----
-- The whole learning path of a course: every published lesson, with its lock state and what is missing.
-- Only titles are returned for locked lessons, never their content.
create or replace function public.course_path(p_course uuid) returns table(
  lesson_id uuid, module_id uuid, title text, type public.lesson_type, duration_seconds int, "position" int,
  completed boolean, locked boolean, requirements jsonb)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_enrolled(p_course) then raise exception 'Not allowed'; end if;
  return query
  select l.id, l.module_id, l.title, l.type, l.duration_seconds, l.position,
    exists (select 1 from public.lesson_progress lp where lp.lesson_id = l.id and lp.student_id = auth.uid() and lp.completed),
    not public.lesson_unlocked(l.id),
    coalesce((select jsonb_agg(jsonb_build_object('rule_id', r.id, 'type', r.req_type, 'id', r.req_id, 'min_percent', r.min_percent,
                'title', case r.req_type when 'lesson' then (select x.title from public.lessons x where x.id = r.req_id)
                                         when 'quiz' then (select x.title from public.quizzes x where x.id = r.req_id)
                                         else (select x.title from public.assignments x where x.id = r.req_id) end,
                'pass_percent', (select x.pass_percent from public.quizzes x where x.id = r.req_id),
                'met', public.rule_met(r.req_type, r.req_id, r.min_percent, auth.uid())) order by r.created_at)
              from public.unlock_rules r where r.lesson_id = l.id), '[]'::jsonb)
  from public.lessons l
  where l.course_id = p_course and l.is_published
  order by l.position, l.created_at;
end $$;

-- One lesson the student cannot open: is it locked, and by what? NULL when it does not exist, is a draft, or is not theirs.
create or replace function public.lesson_gate(p_lesson uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare l public.lessons;
begin
  select * into l from public.lessons x where x.id = p_lesson and x.is_published;
  if l.id is null or not public.is_enrolled(l.course_id) then return null; end if;
  return jsonb_build_object('lesson_id', l.id, 'course_id', l.course_id, 'title', l.title, 'locked', not public.lesson_unlocked(l.id),
    'requirements', coalesce((select jsonb_agg(jsonb_build_object('type', r.req_type, 'id', r.req_id, 'min_percent', r.min_percent,
        'title', case r.req_type when 'lesson' then (select x.title from public.lessons x where x.id = r.req_id)
                                 when 'quiz' then (select x.title from public.quizzes x where x.id = r.req_id)
                                 else (select x.title from public.assignments x where x.id = r.req_id) end,
        'pass_percent', (select x.pass_percent from public.quizzes x where x.id = r.req_id),
        'met', public.rule_met(r.req_type, r.req_id, r.min_percent, auth.uid())) order by r.created_at)
      from public.unlock_rules r where r.lesson_id = l.id), '[]'::jsonb));
end $$;

revoke execute on function public.course_path(uuid), public.lesson_gate(uuid) from public, anon;
grant execute on function public.course_path(uuid), public.lesson_gate(uuid) to authenticated;
