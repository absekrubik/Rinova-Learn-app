-- =====================================================================
-- Rinova Learn  |  018_phase17_live_pulse.sql   (Phase 17: live "I'm lost" pulse and quick polls)
-- During a live class students tap "Got it" or "I'm lost" and the teacher sees how the class is doing.
-- Teachers can also run a quick poll. Both are ANONYMOUS to teachers and classmates: the teacher only gets
-- counts, never names. Students can only send while the class is on (15 minutes before the start until 1 hour
-- after the end, the same window as joining) and only for classes of courses they are enrolled in.
-- Safe to run more than once.
-- =====================================================================

-- The window in which a class is "on". Used by the checks below.
create or replace function public.live_class_open(p_class uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select c.status <> 'cancelled'
                     and now() >= c.starts_at - interval '15 minutes' and now() <= c.ends_at + interval '1 hour'
                   from public.live_classes c where c.id = p_class), false)
$$;
revoke execute on function public.live_class_open(uuid) from public, anon;
grant execute on function public.live_class_open(uuid) to authenticated;

-- ---------- pulse ----------------------------------------------------------
create table if not exists public.live_pulse (
  live_class_id uuid not null references public.live_classes(id) on delete cascade,
  student_id    uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  course_id     uuid not null references public.courses(id) on delete cascade,      -- set by trigger
  state         text not null check (state in ('got_it', 'lost')),
  updated_at    timestamptz not null default now(),
  primary key (live_class_id, student_id)
);
alter table public.live_pulse enable row level security;

create or replace function public.live_pulse_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare cc uuid;
begin
  select c.course_id into cc from public.live_classes c where c.id = new.live_class_id;
  if cc is null then raise exception 'Class not found'; end if;
  if not public.live_class_open(new.live_class_id) then raise exception 'This class is not open right now'; end if;
  new.course_id := cc; new.updated_at := now();
  if tg_op = 'UPDATE' and (new.live_class_id <> old.live_class_id or new.student_id <> old.student_id) then raise exception 'Not allowed'; end if;
  return new;
end $$;
drop trigger if exists trg_live_pulse_guard on public.live_pulse;
create trigger trg_live_pulse_guard before insert or update on public.live_pulse for each row execute function public.live_pulse_guard();

drop policy if exists pulse_select on public.live_pulse;
drop policy if exists pulse_insert on public.live_pulse;
drop policy if exists pulse_update on public.live_pulse;
drop policy if exists pulse_delete on public.live_pulse;
-- a student sees only their own row; staff read counts through pulse_summary(), never names
create policy pulse_select on public.live_pulse for select to authenticated using (student_id = auth.uid() and public.is_active_user());
create policy pulse_insert on public.live_pulse for insert to authenticated with check (student_id = auth.uid() and public.is_enrolled(course_id));
create policy pulse_update on public.live_pulse for update to authenticated using (student_id = auth.uid()) with check (student_id = auth.uid() and public.is_enrolled(course_id));
create policy pulse_delete on public.live_pulse for delete to authenticated using (student_id = auth.uid());
revoke all on public.live_pulse from anon;
grant select, insert, update, delete on public.live_pulse to authenticated;

-- Counts for the teacher. A tap counts for 5 minutes, then fades (students tap again if they still feel the same).
create or replace function public.pulse_summary(p_class uuid) returns table(got_it int, lost int, enrolled int)
language plpgsql stable security definer set search_path = public as $$
declare cc uuid;
begin
  select c.course_id into cc from public.live_classes c where c.id = p_class;
  if cc is null or not public.is_teacher_of(cc) then raise exception 'Not allowed'; end if;
  return query
  select (count(*) filter (where p.state = 'got_it' and p.updated_at > now() - interval '5 minutes'))::int,
         (count(*) filter (where p.state = 'lost'   and p.updated_at > now() - interval '5 minutes'))::int,
         (select count(*) from public.enrollments e where e.course_id = cc and e.status <> 'dropped')::int
  from public.live_pulse p where p.live_class_id = p_class;
end $$;

-- ---------- quick polls ----------------------------------------------------
create table if not exists public.live_polls (
  id            uuid primary key default gen_random_uuid(),
  live_class_id uuid not null references public.live_classes(id) on delete cascade,
  course_id     uuid not null references public.courses(id) on delete cascade,      -- set by trigger
  question      text not null check (char_length(btrim(question)) between 1 and 200),
  options       text[] not null check (array_length(options, 1) between 2 and 6),
  status        text not null default 'open' check (status in ('open', 'closed')),
  created_by    uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at    timestamptz not null default now()
);
create index if not exists live_polls_class_idx on public.live_polls (live_class_id, created_at desc);
alter table public.live_polls enable row level security;

create table if not exists public.live_poll_votes (
  poll_id    uuid not null references public.live_polls(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  course_id  uuid not null references public.courses(id) on delete cascade,          -- set by trigger
  option_idx int not null check (option_idx >= 0),
  voted_at   timestamptz not null default now(),
  primary key (poll_id, student_id)
);
alter table public.live_poll_votes enable row level security;

create or replace function public.live_polls_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare cc uuid; o text;
begin
  if tg_op = 'INSERT' then
    select c.course_id into cc from public.live_classes c where c.id = new.live_class_id;
    if cc is null then raise exception 'Class not found'; end if;
    new.course_id := cc; new.question := btrim(new.question); new.status := 'open';
    foreach o in array new.options loop
      if char_length(btrim(o)) not between 1 and 80 then raise exception 'Each answer must be 1 to 80 characters'; end if;
    end loop;
    new.options := array(select btrim(x) from unnest(new.options) x);
    if (select count(*) from public.live_polls p where p.live_class_id = new.live_class_id) >= 20 then raise exception 'A class can have at most 20 polls'; end if;
    return new;
  end if;
  -- once created, only open/closed can change (answers must not change under people's votes)
  if new.id <> old.id or new.live_class_id <> old.live_class_id or new.course_id <> old.course_id or new.question <> old.question
     or new.options <> old.options or new.created_at <> old.created_at then
    raise exception 'A poll cannot be edited. Close it and start a new one.';
  end if;
  return new;
end $$;
drop trigger if exists trg_live_polls_guard on public.live_polls;
create trigger trg_live_polls_guard before insert or update on public.live_polls for each row execute function public.live_polls_guard();

create or replace function public.live_poll_votes_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare pl public.live_polls%rowtype;
begin
  select * into pl from public.live_polls p where p.id = new.poll_id;
  if pl.id is null then raise exception 'Poll not found'; end if;
  if pl.status <> 'open' then raise exception 'This poll is closed'; end if;
  if not public.live_class_open(pl.live_class_id) then raise exception 'This class is not open right now'; end if;
  if new.option_idx >= array_length(pl.options, 1) then raise exception 'That answer does not exist'; end if;
  if tg_op = 'UPDATE' and (new.poll_id <> old.poll_id or new.student_id <> old.student_id) then raise exception 'Not allowed'; end if;
  new.course_id := pl.course_id; new.voted_at := now(); return new;
end $$;
drop trigger if exists trg_live_poll_votes_guard on public.live_poll_votes;
create trigger trg_live_poll_votes_guard before insert or update on public.live_poll_votes for each row execute function public.live_poll_votes_guard();

drop policy if exists polls_select on public.live_polls;
drop policy if exists polls_write  on public.live_polls;
create policy polls_select on public.live_polls for select to authenticated using (public.is_teacher_of(course_id) or public.is_enrolled(course_id));
create policy polls_write  on public.live_polls for all    to authenticated using (public.is_teacher_of(course_id)) with check (public.is_teacher_of(course_id));

drop policy if exists votes_select on public.live_poll_votes;
drop policy if exists votes_insert on public.live_poll_votes;
drop policy if exists votes_update on public.live_poll_votes;
create policy votes_select on public.live_poll_votes for select to authenticated using (student_id = auth.uid() and public.is_active_user());   -- nobody sees other votes
create policy votes_insert on public.live_poll_votes for insert to authenticated with check (student_id = auth.uid() and public.is_enrolled(course_id));
create policy votes_update on public.live_poll_votes for update to authenticated using (student_id = auth.uid()) with check (student_id = auth.uid() and public.is_enrolled(course_id));
revoke all on public.live_polls, public.live_poll_votes from anon;
grant select, insert, update, delete on public.live_polls to authenticated;
grant select, insert, update on public.live_poll_votes to authenticated;

-- Totals per answer. Staff always; a student once they have voted or the poll is closed.
create or replace function public.poll_results(p_poll uuid) returns table(option_idx int, label text, votes int, total int)
language plpgsql stable security definer set search_path = public as $$
declare pl public.live_polls%rowtype; allowed boolean;
begin
  select * into pl from public.live_polls p where p.id = p_poll;
  if pl.id is null then raise exception 'Not allowed'; end if;
  allowed := public.is_teacher_of(pl.course_id)
    or (public.is_enrolled(pl.course_id) and (pl.status = 'closed' or exists (select 1 from public.live_poll_votes v where v.poll_id = p_poll and v.student_id = auth.uid())));
  if not allowed then raise exception 'Not allowed'; end if;
  return query
  select (g - 1)::int, pl.options[g],
         (select count(*) from public.live_poll_votes v where v.poll_id = p_poll and v.option_idx = g - 1)::int,
         (select count(*) from public.live_poll_votes v where v.poll_id = p_poll)::int
  from generate_subscripts(pl.options, 1) g
  order by g;
end $$;

revoke execute on function public.pulse_summary(uuid), public.poll_results(uuid) from public, anon;
grant execute on function public.pulse_summary(uuid), public.poll_results(uuid) to authenticated;
