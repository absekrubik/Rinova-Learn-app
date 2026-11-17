-- =====================================================================
-- Rinova Learn  |  019_phase18_live_joins.sql   (Phase 18: "Joined" status for live classes)
-- When someone presses Join, the class page records it, shows them "Joined", and lets them rejoin if they close the
-- meeting tab. Teachers and admins see who has joined (names and times). Writes only go through record_join(),
-- which checks the class window (15 minutes before the start until 1 hour after the end) and that the caller belongs
-- in the class: an enrolled student, a teacher of the course, or an admin. Safe to run more than once.
-- =====================================================================

create table if not exists public.live_joins (
  live_class_id   uuid not null references public.live_classes(id) on delete cascade,
  user_id         uuid not null references public.profiles(id) on delete cascade,
  course_id       uuid not null references public.courses(id) on delete cascade,
  first_joined_at timestamptz not null default now(),
  last_joined_at  timestamptz not null default now(),
  join_count      int not null default 1,
  primary key (live_class_id, user_id)
);
alter table public.live_joins enable row level security;
drop policy if exists joins_select on public.live_joins;
-- people see only their own row; staff read the list through live_joined()
create policy joins_select on public.live_joins for select to authenticated using (user_id = auth.uid() and public.is_active_user());
revoke all on public.live_joins from anon, authenticated;
grant select on public.live_joins to authenticated;       -- no direct insert/update/delete: use record_join()

drop function if exists public.record_join(uuid, text);      -- so re-running the whole set in order works (020 recreates it)
create or replace function public.record_join(p_class uuid) returns table(first_joined_at timestamptz, last_joined_at timestamptz, join_count int)
language plpgsql security definer set search_path = public as $$
declare cc uuid; uid uuid := auth.uid();
begin
  if uid is null or not public.is_active_user() then raise exception 'Not allowed'; end if;
  select c.course_id into cc from public.live_classes c where c.id = p_class;
  if cc is null then raise exception 'Class not found'; end if;
  if not (public.is_admin() or public.is_teacher_of(cc) or public.is_enrolled(cc)) then raise exception 'Not allowed'; end if;
  if not public.live_class_open(p_class) then raise exception 'This class is not open right now'; end if;
  return query
  insert into public.live_joins as j (live_class_id, user_id, course_id) values (p_class, uid, cc)
  on conflict (live_class_id, user_id) do update set last_joined_at = now(), join_count = j.join_count + 1
  returning j.first_joined_at, j.last_joined_at, j.join_count;
end $$;
revoke execute on function public.record_join(uuid) from public, anon;
grant execute on function public.record_join(uuid) to authenticated;

-- Who has joined: staff only. Names and times, never emails.
drop function if exists public.live_joined(uuid);
create or replace function public.live_joined(p_class uuid) returns table(user_id uuid, full_name text, is_staff boolean, first_joined_at timestamptz, last_joined_at timestamptz, join_count int, enrolled int)
language plpgsql stable security definer set search_path = public as $$
declare cc uuid;
begin
  select c.course_id into cc from public.live_classes c where c.id = p_class;
  if cc is null or not (public.is_admin() or public.is_teacher_of(cc)) then raise exception 'Not allowed'; end if;
  return query
  select j.user_id, coalesce(nullif(btrim(p.full_name), ''), 'Student'), coalesce(p.role in ('teacher', 'admin'), false),
         j.first_joined_at, j.last_joined_at, j.join_count,
         (select count(*) from public.enrollments e where e.course_id = cc and e.status <> 'dropped')::int
  from public.live_joins j left join public.profiles p on p.id = j.user_id
  where j.live_class_id = p_class
  order by j.first_joined_at;
end $$;
revoke execute on function public.live_joined(uuid) from public, anon;
grant execute on function public.live_joined(uuid) to authenticated;
