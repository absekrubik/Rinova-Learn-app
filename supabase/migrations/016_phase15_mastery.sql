-- =====================================================================
-- Rinova Learn  |  016_phase15_mastery.sql   (Phase 15: topic mastery map)
-- Teachers tag lessons and quiz questions with topics ("Fractions", "Algebra"). From the quiz results the
-- system works out how strong each student is in each topic, and which lessons to revisit.
--   * students see only their own mastery; teachers see their own courses; everyone else sees nothing
--   * no change to quizzes, answers or grading: this only READS quiz results
-- Safe to run more than once.
-- =====================================================================

-- ---------- topics ---------------------------------------------------
create table if not exists public.topics (
  id         uuid primary key default gen_random_uuid(),
  course_id  uuid not null references public.courses(id) on delete cascade,
  name       text not null check (char_length(btrim(name)) between 1 and 60),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create unique index if not exists topics_course_name_uidx on public.topics (course_id, lower(btrim(name)));

create table if not exists public.lesson_topics (
  lesson_id uuid not null references public.lessons(id) on delete cascade,
  topic_id  uuid not null references public.topics(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,   -- set by trigger
  primary key (lesson_id, topic_id)
);
create index if not exists lesson_topics_topic_idx on public.lesson_topics (topic_id);

create table if not exists public.question_topics (
  question_id uuid not null references public.quiz_questions(id) on delete cascade,
  topic_id    uuid not null references public.topics(id) on delete cascade,
  course_id   uuid not null references public.courses(id) on delete cascade, -- set by trigger
  primary key (question_id, topic_id)
);
create index if not exists question_topics_topic_idx on public.question_topics (topic_id);

alter table public.topics          enable row level security;
alter table public.lesson_topics   enable row level security;
alter table public.question_topics enable row level security;

-- Keep things tidy: at most 40 topics per course, at most 3 topics per lesson or question,
-- and a tag can only join things of the same course.
create or replace function public.topics_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.name := btrim(new.name);
  if tg_op = 'INSERT' and (select count(*) from public.topics t where t.course_id = new.course_id) >= 40 then
    raise exception 'A course can have at most 40 topics';
  end if;
  if tg_op = 'UPDATE' and new.course_id <> old.course_id then raise exception 'A topic cannot move to another course'; end if;
  return new;
end $$;
drop trigger if exists trg_topics_guard on public.topics;
create trigger trg_topics_guard before insert or update on public.topics for each row execute function public.topics_guard();

create or replace function public.lesson_topics_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare lc uuid; tc uuid;
begin
  select l.course_id into lc from public.lessons l where l.id = new.lesson_id;
  select t.course_id into tc from public.topics t where t.id = new.topic_id;
  if lc is null or tc is null then raise exception 'Lesson or topic not found'; end if;
  if lc <> tc then raise exception 'The topic must belong to the same course as the lesson'; end if;
  if (select count(*) from public.lesson_topics x where x.lesson_id = new.lesson_id) >= 3 then
    raise exception 'A lesson can have at most 3 topics';
  end if;
  new.course_id := lc; return new;
end $$;
drop trigger if exists trg_lesson_topics_guard on public.lesson_topics;
create trigger trg_lesson_topics_guard before insert on public.lesson_topics for each row execute function public.lesson_topics_guard();

create or replace function public.question_topics_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare qc uuid; tc uuid;
begin
  select z.course_id into qc from public.quiz_questions q join public.quizzes z on z.id = q.quiz_id where q.id = new.question_id;
  select t.course_id into tc from public.topics t where t.id = new.topic_id;
  if qc is null or tc is null then raise exception 'Question or topic not found'; end if;
  if qc <> tc then raise exception 'The topic must belong to the same course as the question'; end if;
  if (select count(*) from public.question_topics x where x.question_id = new.question_id) >= 3 then
    raise exception 'A question can have at most 3 topics';
  end if;
  new.course_id := qc; return new;
end $$;
drop trigger if exists trg_question_topics_guard on public.question_topics;
create trigger trg_question_topics_guard before insert on public.question_topics for each row execute function public.question_topics_guard();

-- ---------- row level security ----------------------------------------
drop policy if exists topics_select on public.topics;
drop policy if exists topics_write  on public.topics;
create policy topics_select on public.topics for select to authenticated using (public.can_view_course(course_id));
create policy topics_write  on public.topics for all    to authenticated using (public.is_teacher_of(course_id)) with check (public.is_teacher_of(course_id));

-- students may see which topics a lesson covers, but only for lessons they can open (this follows the unlock rules)
drop policy if exists lesson_topics_select on public.lesson_topics;
drop policy if exists lesson_topics_write  on public.lesson_topics;
create policy lesson_topics_select on public.lesson_topics for select to authenticated using (
  public.is_teacher_of(course_id) or (public.is_enrolled(course_id) and exists (select 1 from public.lessons l where l.id = lesson_id)));
create policy lesson_topics_write on public.lesson_topics for all to authenticated
  using (public.is_teacher_of(course_id)) with check (public.is_teacher_of(course_id));

-- which question belongs to which topic is for staff only
drop policy if exists question_topics_all on public.question_topics;
create policy question_topics_all on public.question_topics for all to authenticated
  using (public.is_teacher_of(course_id)) with check (public.is_teacher_of(course_id));

revoke all on public.topics, public.lesson_topics, public.question_topics from anon;
grant select, insert, update, delete on public.topics, public.lesson_topics, public.question_topics to authenticated;

-- ---------- mastery -----------------------------------------------------
-- Strength per topic comes from the student's LATEST graded attempt at each quiz (so improving on a retake shows).
-- Questions still waiting for manual marking are left out.  strong >= 80, ok 60-79, weak < 60, untested = no answers yet.
create or replace function public.mastery_level(p numeric) returns text
language sql immutable as $$ select case when p is null then 'untested' when p >= 80 then 'strong' when p >= 60 then 'ok' else 'weak' end $$;

-- One row per (student, topic) with the numbers behind it. Internal: only called by the functions below.
create or replace function public.mastery_rows(p_course uuid, p_student uuid) returns table(
  topic_id uuid, questions int, points_got numeric, points_max numeric, percent numeric)
language sql stable security definer set search_path = public as $$
  with latest as (
    select distinct on (a.quiz_id) a.id as attempt_id
    from public.quiz_attempts a join public.quizzes z on z.id = a.quiz_id
    where a.student_id = p_student and a.course_id = p_course and a.status = 'graded' and z.is_published
    order by a.quiz_id, a.submitted_at desc nulls last, a.started_at desc)
  select t.id, coalesce(x.n, 0)::int, coalesce(x.got, 0), coalesce(x.mx, 0),
         case when coalesce(x.mx, 0) > 0 then round(100 * x.got / x.mx, 1) end
  from public.topics t
  left join (
    select qt.topic_id, count(*) as n, sum(r.points_awarded) as got, sum(qq.points) as mx
    from latest l
    join public.quiz_responses r on r.attempt_id = l.attempt_id and r.is_correct is not null
    join public.quiz_questions qq on qq.id = r.question_id
    join public.question_topics qt on qt.question_id = qq.id
    group by qt.topic_id) x on x.topic_id = t.id
  where t.course_id = p_course
$$;
revoke execute on function public.mastery_rows(uuid, uuid) from public, anon, authenticated;

-- A student's own map. p_course = null means every course they are enrolled in.
create or replace function public.my_mastery(p_course uuid default null) returns table(
  course_id uuid, course_title text, topic_id uuid, topic text,
  lessons_total int, lessons_done int, questions int, points_got numeric, points_max numeric,
  percent numeric, level text, lessons jsonb)
language plpgsql stable security definer set search_path = public as $$
begin
  if public.app_role() is distinct from 'student' then raise exception 'Not allowed'; end if;
  if p_course is not null and not public.is_enrolled(p_course) then raise exception 'Not allowed'; end if;
  return query
  select c.id, c.title, t.id, t.name,
    (select count(*) from public.lesson_topics lt join public.lessons l on l.id = lt.lesson_id where lt.topic_id = t.id and l.is_published)::int,
    (select count(*) from public.lesson_topics lt join public.lessons l on l.id = lt.lesson_id
       join public.lesson_progress lp on lp.lesson_id = l.id and lp.student_id = auth.uid() and lp.completed
      where lt.topic_id = t.id and l.is_published)::int,
    m.questions, m.points_got, m.points_max, m.percent, public.mastery_level(m.percent),
    coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'title', l.title,
              'completed', coalesce(lp.completed, false), 'locked', not public.lesson_unlocked(l.id)) order by md.position, l.position)
       from public.lesson_topics lt join public.lessons l on l.id = lt.lesson_id join public.modules md on md.id = l.module_id
       left join public.lesson_progress lp on lp.lesson_id = l.id and lp.student_id = auth.uid()
      where lt.topic_id = t.id and l.is_published), '[]'::jsonb)
  from public.enrollments e
  join public.courses c on c.id = e.course_id and c.status = 'published'
  join public.topics t on t.course_id = c.id
  cross join lateral public.mastery_rows(c.id, auth.uid()) m
  where e.student_id = auth.uid() and e.status <> 'dropped' and m.topic_id = t.id
    and (p_course is null or c.id = p_course)
  order by c.title, t.name;
end $$;

-- Class view for staff: how the whole class is doing per topic.
create or replace function public.class_mastery(p_course uuid) returns table(
  topic_id uuid, topic text, lessons_total int, questions_tagged int, students_tested int, enrolled int,
  avg_percent numeric, weak_students int)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_teacher_of(p_course) then raise exception 'Not allowed'; end if;
  return query
  with studs as (
    select e.student_id as sid from public.enrollments e join public.profiles p on p.id = e.student_id
    where e.course_id = p_course and e.status <> 'dropped' and p.status = 'active'),
  per as (
    select s.sid, m.topic_id, m.percent from studs s cross join lateral public.mastery_rows(p_course, s.sid) m)
  select t.id, t.name,
    (select count(*) from public.lesson_topics lt join public.lessons l on l.id = lt.lesson_id where lt.topic_id = t.id and l.is_published)::int,
    (select count(*) from public.question_topics qt where qt.topic_id = t.id)::int,
    (count(per.percent))::int, (select count(*) from studs)::int,
    round(avg(per.percent), 1),
    (count(*) filter (where per.percent < 60))::int
  from public.topics t left join per on per.topic_id = t.id
  where t.course_id = p_course
  group by t.id, t.name
  order by t.name;
end $$;

-- Who is finding one topic hard (staff only).
create or replace function public.topic_students(p_course uuid, p_topic uuid) returns table(
  student_id uuid, full_name text, email text, percent numeric, level text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_teacher_of(p_course) then raise exception 'Not allowed'; end if;
  if not exists (select 1 from public.topics t where t.id = p_topic and t.course_id = p_course) then raise exception 'Topic not found'; end if;
  return query
  select p.id, coalesce(nullif(p.full_name, ''), p.email), p.email, m.percent, public.mastery_level(m.percent)
  from public.enrollments e join public.profiles p on p.id = e.student_id
  cross join lateral public.mastery_rows(p_course, p.id) m
  where e.course_id = p_course and e.status <> 'dropped' and p.status = 'active' and m.topic_id = p_topic
  order by m.percent asc nulls last, p.full_name;
end $$;

revoke execute on function public.my_mastery(uuid), public.class_mastery(uuid), public.topic_students(uuid, uuid) from public, anon;
grant execute on function public.my_mastery(uuid), public.class_mastery(uuid), public.topic_students(uuid, uuid) to authenticated;
revoke execute on function public.mastery_level(numeric) from public, anon;
grant execute on function public.mastery_level(numeric) to authenticated;
