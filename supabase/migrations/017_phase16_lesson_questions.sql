-- =====================================================================
-- Rinova Learn  |  017_phase16_lesson_questions.sql   (Phase 16: questions on a lesson, pinned to a moment of the video)
-- A student asks a question at 04:32 of a video; classmates see it at that moment and the teacher's answer
-- appears under it for everyone. Teachers get one queue of unanswered questions.
-- Who can read or post follows the lesson itself: if a student cannot open a lesson (not enrolled, draft,
-- locked by an unlock rule), they cannot see or post its questions. Safe to run more than once.
-- =====================================================================

create table if not exists public.lesson_questions (
  id          uuid primary key default gen_random_uuid(),
  lesson_id   uuid not null references public.lessons(id) on delete cascade,
  course_id   uuid not null references public.courses(id) on delete cascade,      -- set by trigger
  author_id   uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  parent_id   uuid references public.lesson_questions(id) on delete cascade,      -- null = a question, set = a reply
  at_seconds  int check (at_seconds between 0 and 86400),                         -- moment of the video (questions only)
  body        text not null check (char_length(btrim(body)) between 1 and 1000),
  is_pinned   boolean not null default false,                                     -- staff: keep this on top
  is_resolved boolean not null default false,                                     -- answered
  created_at  timestamptz not null default now()
);
create index if not exists lesson_questions_lesson_idx on public.lesson_questions (lesson_id, created_at);
create index if not exists lesson_questions_parent_idx on public.lesson_questions (parent_id);
create index if not exists lesson_questions_open_idx   on public.lesson_questions (course_id, is_resolved) where parent_id is null;
alter table public.lesson_questions enable row level security;

-- ---------- rules on every new row --------------------------------------
create or replace function public.lesson_questions_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare lc uuid; par public.lesson_questions%rowtype; staff boolean;
begin
  if tg_op = 'INSERT' then
    select l.course_id into lc from public.lessons l where l.id = new.lesson_id;
    if lc is null then raise exception 'Lesson not found'; end if;
    new.course_id := lc; new.body := btrim(new.body);
    staff := public.is_teacher_of(lc);
    new.is_pinned := false; new.is_resolved := false;
    if new.parent_id is null then
      if new.at_seconds is not null and new.at_seconds < 0 then raise exception 'Invalid time'; end if;
    else
      select * into par from public.lesson_questions q where q.id = new.parent_id;
      if par.id is null or par.lesson_id <> new.lesson_id then raise exception 'The question you are replying to was not found'; end if;
      if par.parent_id is not null then raise exception 'You can only reply to a question, not to a reply'; end if;
      new.at_seconds := null;
    end if;
    if not staff and (select count(*) from public.lesson_questions q where q.author_id = new.author_id and q.created_at > now() - interval '1 hour') >= 20 then
      raise exception 'You are posting too fast. Please wait a little.';
    end if;
    return new;
  end if;
  -- updates: only the pin and answered flags may change, and only on questions
  if new.id <> old.id or new.lesson_id <> old.lesson_id or new.course_id <> old.course_id or new.author_id <> old.author_id
     or new.parent_id is distinct from old.parent_id or new.at_seconds is distinct from old.at_seconds
     or new.body <> old.body or new.created_at <> old.created_at then
    raise exception 'Only the pinned and answered marks can be changed. Delete and ask again to change the text.';
  end if;
  if old.parent_id is not null and (new.is_pinned <> old.is_pinned or new.is_resolved <> old.is_resolved) then
    raise exception 'Replies cannot be pinned or marked answered';
  end if;
  if new.is_pinned <> old.is_pinned and not public.is_teacher_of(old.course_id) then raise exception 'Only teachers can pin a question'; end if;
  return new;
end $$;
drop trigger if exists trg_lesson_questions_guard on public.lesson_questions;
create trigger trg_lesson_questions_guard before insert or update on public.lesson_questions for each row execute function public.lesson_questions_guard();

-- ---------- notifications and auto "answered" ----------------------------
create or replace function public.lesson_questions_after() returns trigger
language plpgsql security definer set search_path = public as $$
declare par public.lesson_questions%rowtype; ltitle text; who uuid[];
begin
  select l.title into ltitle from public.lessons l where l.id = new.lesson_id;
  if new.parent_id is not null then
    select * into par from public.lesson_questions q where q.id = new.parent_id;
    perform public.notify_users(array[par.author_id], 'lesson_reply', 'New reply to your question', left(new.body, 140), 'lesson?id=' || new.lesson_id);
    if public.is_teacher_of(new.course_id) and not par.is_resolved then
      update public.lesson_questions set is_resolved = true where id = par.id;     -- a teacher's reply marks it answered
    end if;
  elsif not public.is_teacher_of(new.course_id) then
    select array_agg(ct.teacher_id) into who from public.course_teachers ct where ct.course_id = new.course_id;
    perform public.notify_users(who, 'lesson_question', 'New question on ' || coalesce(ltitle, 'a lesson'), left(new.body, 140), 'lesson?id=' || new.lesson_id);
  end if;
  return null;
end $$;
drop trigger if exists trg_lesson_questions_after on public.lesson_questions;
create trigger trg_lesson_questions_after after insert on public.lesson_questions for each row execute function public.lesson_questions_after();

-- ---------- row level security --------------------------------------------
-- "exists (select ... from lessons)" runs under the caller's own lesson rules, so it follows publishing and unlock rules.
drop policy if exists lq_select on public.lesson_questions;
drop policy if exists lq_insert on public.lesson_questions;
drop policy if exists lq_update on public.lesson_questions;
drop policy if exists lq_delete on public.lesson_questions;
create policy lq_select on public.lesson_questions for select to authenticated using (
  public.is_active_user() and exists (select 1 from public.lessons l where l.id = lesson_id));
create policy lq_insert on public.lesson_questions for insert to authenticated with check (
  author_id = auth.uid() and public.is_active_user() and exists (select 1 from public.lessons l where l.id = lesson_id));
create policy lq_update on public.lesson_questions for update to authenticated
  using (public.is_teacher_of(course_id) or (author_id = auth.uid() and parent_id is null))
  with check (public.is_teacher_of(course_id) or (author_id = auth.uid() and parent_id is null));
create policy lq_delete on public.lesson_questions for delete to authenticated using (
  public.is_teacher_of(course_id) or author_id = auth.uid());
revoke all on public.lesson_questions from anon;
grant select, insert, update, delete on public.lesson_questions to authenticated;

-- ---------- reading a thread (adds author names, which students cannot read from profiles) ----------
create or replace function public.lesson_thread(p_lesson uuid) returns table(
  id uuid, parent_id uuid, at_seconds int, body text, is_pinned boolean, is_resolved boolean, created_at timestamptz,
  author_id uuid, author_name text, author_is_staff boolean, mine boolean)
language plpgsql stable security definer set search_path = public as $$
declare lc uuid; pub boolean;
begin
  select l.course_id, l.is_published into lc, pub from public.lessons l where l.id = p_lesson;
  if lc is null then raise exception 'Not allowed'; end if;
  if not (public.is_teacher_of(lc) or (public.is_enrolled(lc) and pub and public.lesson_unlocked(p_lesson))) then raise exception 'Not allowed'; end if;
  return query
  select q.id, q.parent_id, q.at_seconds, q.body, q.is_pinned, q.is_resolved, q.created_at, q.author_id,
         coalesce(nullif(btrim(p.full_name), ''), 'Student'), coalesce(p.role in ('teacher', 'admin'), false), q.author_id = auth.uid()
  from public.lesson_questions q left join public.profiles p on p.id = q.author_id
  where q.lesson_id = p_lesson
  order by q.created_at;
end $$;

-- The teacher's queue: questions nobody has answered yet, oldest first.
create or replace function public.open_questions(p_course uuid default null) returns table(
  id uuid, lesson_id uuid, lesson_title text, course_id uuid, course_title text, at_seconds int, body text,
  author_name text, created_at timestamptz, is_pinned boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.is_admin() or public.app_role() = 'teacher') then raise exception 'Not allowed'; end if;
  if p_course is not null and not public.is_teacher_of(p_course) then raise exception 'Not allowed'; end if;
  return query
  select q.id, q.lesson_id, l.title, q.course_id, c.title, q.at_seconds, q.body,
         coalesce(nullif(btrim(p.full_name), ''), p.email), q.created_at, q.is_pinned
  from public.lesson_questions q
  join public.lessons l on l.id = q.lesson_id join public.courses c on c.id = q.course_id
  left join public.profiles p on p.id = q.author_id
  where q.parent_id is null and not q.is_resolved and public.is_teacher_of(q.course_id)
    and (p_course is null or q.course_id = p_course)
  order by q.is_pinned desc, q.created_at
  limit 200;
end $$;

revoke execute on function public.lesson_thread(uuid), public.open_questions(uuid) from public, anon;
grant execute on function public.lesson_thread(uuid), public.open_questions(uuid) to authenticated;
