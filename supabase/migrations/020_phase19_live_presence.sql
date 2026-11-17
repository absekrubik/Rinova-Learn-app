-- =====================================================================
-- Rinova Learn  |  020_phase19_live_presence.sql   (Phase 19: who is in the class, who left, and when)
-- Every press of Join starts a "visit". While the class page is open it sends a small heartbeat, and when the
-- meeting tab closes (or the person presses "I've left") the visit gets a leave time. A visit with no heartbeat
-- for 2 minutes counts as ended at its last heartbeat, so closing the browser or losing the connection is
-- still recorded. Staff see each person's visits (joined, left, joined again...) and totals.
-- Run after 019. Safe to run more than once.
-- =====================================================================

create table if not exists public.live_sessions (
  id            uuid primary key default gen_random_uuid(),
  live_class_id uuid not null references public.live_classes(id) on delete cascade,
  user_id       uuid not null references public.profiles(id) on delete cascade,
  course_id     uuid not null references public.courses(id) on delete cascade,
  joined_at     timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  left_at       timestamptz,
  via           text not null default 'tab' check (via in ('tab', 'app'))
);
create index if not exists live_sessions_class_user_idx on public.live_sessions (live_class_id, user_id, joined_at);
alter table public.live_sessions enable row level security;
drop policy if exists sessions_select on public.live_sessions;
create policy sessions_select on public.live_sessions for select to authenticated using (user_id = auth.uid() and public.is_active_user());
revoke all on public.live_sessions from anon, authenticated;
grant select on public.live_sessions to authenticated;      -- writes only through the functions below

-- No heartbeat for this long = the person is gone.
create or replace function public.live_presence_grace() returns interval language sql immutable as $$ select interval '2 minutes' $$;

-- Pressing Join: starts a new visit (any visit still open for this person is closed first) and counts the join.
drop function if exists public.record_join(uuid);
create or replace function public.record_join(p_class uuid, p_via text default 'tab') returns table(first_joined_at timestamptz, last_joined_at timestamptz, join_count int)
language plpgsql security definer set search_path = public as $$
declare cc uuid; uid uuid := auth.uid(); via text := case when p_via = 'app' then 'app' else 'tab' end;
begin
  if uid is null or not public.is_active_user() then raise exception 'Not allowed'; end if;
  select c.course_id into cc from public.live_classes c where c.id = p_class;
  if cc is null then raise exception 'Class not found'; end if;
  if not (public.is_admin() or public.is_teacher_of(cc) or public.is_enrolled(cc)) then raise exception 'Not allowed'; end if;
  if not public.live_class_open(p_class) then raise exception 'This class is not open right now'; end if;
  update public.live_sessions s set left_at = case when s.last_seen_at < now() - public.live_presence_grace() then s.last_seen_at else now() end
   where s.live_class_id = p_class and s.user_id = uid and s.left_at is null;
  insert into public.live_sessions (live_class_id, user_id, course_id, via) values (p_class, uid, cc, via);
  return query
  insert into public.live_joins as j (live_class_id, user_id, course_id) values (p_class, uid, cc)
  on conflict (live_class_id, user_id) do update set last_joined_at = now(), join_count = j.join_count + 1
  returning j.first_joined_at, j.last_joined_at, j.join_count;
end $$;
revoke execute on function public.record_join(uuid, text) from public, anon;
grant execute on function public.record_join(uuid, text) to authenticated;

-- Sent every 30 seconds by the open class page: "this person is still here".
create or replace function public.live_heartbeat(p_class uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.is_active_user() then raise exception 'Not allowed'; end if;
  update public.live_sessions set last_seen_at = now() where live_class_id = p_class and user_id = auth.uid() and left_at is null;
end $$;
revoke execute on function public.live_heartbeat(uuid) from public, anon;
grant execute on function public.live_heartbeat(uuid) to authenticated;

-- The meeting tab closed, or the person pressed "I've left".
create or replace function public.record_leave(p_class uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.is_active_user() then raise exception 'Not allowed'; end if;
  update public.live_sessions set left_at = now() where live_class_id = p_class and user_id = auth.uid() and left_at is null;
end $$;
revoke execute on function public.record_leave(uuid) from public, anon;
grant execute on function public.record_leave(uuid) to authenticated;

-- My own status for this class, used by the class page.
create or replace function public.my_live_status(p_class uuid) returns table(in_class boolean, first_joined_at timestamptz, last_joined_at timestamptz, join_count int, visit_joined_at timestamptz, left_at timestamptz, via text)
language sql stable security definer set search_path = public as $$
  with v as (
    select s.joined_at, s.via,
           (s.left_at is null and s.last_seen_at >= now() - public.live_presence_grace()) as live_now,
           coalesce(s.left_at, case when s.last_seen_at < now() - public.live_presence_grace() then s.last_seen_at end) as ended
      from public.live_sessions s where s.live_class_id = p_class and s.user_id = auth.uid()
     order by s.joined_at desc limit 1)
  select v.live_now, j.first_joined_at, j.last_joined_at, j.join_count, v.joined_at, v.ended, v.via
    from v join public.live_joins j on j.live_class_id = p_class and j.user_id = auth.uid()
$$;
revoke execute on function public.my_live_status(uuid) from public, anon;
grant execute on function public.my_live_status(uuid) to authenticated;

-- Staff: everyone who joined, whether they are in the class now, each visit, and the total time. Names and times only.
drop function if exists public.live_joined(uuid);
create or replace function public.live_joined(p_class uuid) returns table(
  user_id uuid, full_name text, is_staff boolean, first_joined_at timestamptz, last_joined_at timestamptz, join_count int, enrolled int,
  in_class boolean, last_left_at timestamptz, total_seconds int, visits jsonb)
language plpgsql stable security definer set search_path = public as $$
declare cc uuid;
begin
  select c.course_id into cc from public.live_classes c where c.id = p_class;
  if cc is null or not (public.is_admin() or public.is_teacher_of(cc)) then raise exception 'Not allowed'; end if;
  return query
  with s as (
    select x.user_id, x.joined_at,
           (x.left_at is null and x.last_seen_at >= now() - public.live_presence_grace()) as live_now,
           coalesce(x.left_at, case when x.last_seen_at < now() - public.live_presence_grace() then x.last_seen_at end) as ended
      from public.live_sessions x where x.live_class_id = p_class)
  select j.user_id, coalesce(nullif(btrim(p.full_name), ''), 'Student'), coalesce(p.role in ('teacher', 'admin'), false),
         j.first_joined_at, j.last_joined_at, j.join_count,
         (select count(*) from public.enrollments e where e.course_id = cc and e.status <> 'dropped')::int,
         coalesce((select bool_or(s.live_now) from s where s.user_id = j.user_id), false),
         (select max(s.ended) from s where s.user_id = j.user_id),
         coalesce((select sum(greatest(0, extract(epoch from (coalesce(s.ended, now()) - s.joined_at))))::int from s where s.user_id = j.user_id), 0),
         coalesce((select jsonb_agg(jsonb_build_object('joined_at', v.joined_at, 'left_at', v.ended) order by v.joined_at)
                     from (select * from s where s.user_id = j.user_id order by s.joined_at desc limit 20) v), '[]'::jsonb)
  from public.live_joins j left join public.profiles p on p.id = j.user_id
  where j.live_class_id = p_class
  order by j.first_joined_at;
end $$;
revoke execute on function public.live_joined(uuid) from public, anon;
grant execute on function public.live_joined(uuid) to authenticated;
